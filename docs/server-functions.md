# Server Functions

Every module in `src/server/` that isn't purely internal git plumbing exposes
its public surface as `createServerFn` calls — TanStack Start's mechanism for
defining a function that runs server-side but is called from client/route
code like a normal async function (the framework's Vite plugin turns the call
into an RPC under the hood). This doc catalogs those modules by resource.

## Conventions every module follows

- **Validation**: every `createServerFn` has a `.validator((data: unknown) =>
  schema.parse(data))` using Zod — never trust `data` is already the right
  shape.
- **Access check before the query**: read handlers call
  `getCurrentUserOptional()` then `requireReadAccess`/`canReadRepo`; write
  handlers call `getCurrentUser()` then `requireWriteAccess`. See
  [authentication.md](./authentication.md) for the full model.
- **Reuse an already-fetched repo row** instead of re-fetching: if a handler's
  query already pulled in `{ with: { repository: true } }`, it calls
  `getAccessForRepository(repo, userId)` rather than `canReadRepo(repoId,
  userId)`, which would otherwise redundantly re-fetch the same row.
- **Activity logging**: mutations that should show up in the activity feed
  (`issues.ts`'s status changes, `pull-requests.ts`'s open/merge, `files.ts`'s
  commits) insert a row into `activities` as part of the same handler.
- **perf instrumentation on read paths**: newer/updated read handlers wrap
  their body in `perfContext(label, fn)` and each meaningfully-awaited
  sub-step in `perfStep(label, fn)` — see [performance.md](./performance.md).
  Follow this pattern when adding a new server function on a user-facing read
  path.

## Modules by resource

### `repositories.ts` — repo CRUD, stars, collaborators
Create/read/update/delete repositories, star/unstar, add/remove collaborators.
Repo names are validated against a strict charset (`repoNameSchema`) — see
[security.md](./security.md) for why this matters beyond cosmetics. Storage
initialization/deletion delegates to `git-manager-iso.ts`/`git-repo-storage.ts`;
access checks delegate to `repo-access.ts`.

### `files.ts` — file/branch/commit operations exposed to routes
The bridge between routes and the git layer: create/edit/delete a file (via
`git-commit-write.ts`), list/read files and trees (`git-tree-ops.ts`,
`git-history-ops.ts`), branch create/delete (`git-branch-ops.ts`), commit
history and diffs (`git-diff-iso.ts`). Every handler here follows the
"resolve repo + access, then do the git operation" shape; several are wrapped
in `perfContext`/`perfStep` since this file backs the tree/blob/commit pages —
the hottest read paths in the app.

Every branch-name-shaped field (`branchName`, `fromBranch`, `sourceBranch`/
`targetBranch`) is validated with `safeBranchNameSchema`
(`git-ref-name.ts`), not a bare `z.string()` — several of the isomorphic-git
calls these values eventually reach (`git.commit`, `git.merge`,
`git.deleteBranch`) don't validate ref names internally, so an unrestricted
branch name here was a path-traversal vector reachable straight from the web
UI (delete branch, PR merge) — see [security.md](./security.md). Read-only
handlers whose `branchName` also has to accept a pinned commit SHA
(`getFile`, `listFiles`, `getLastCommits`, `getFileHistory`, `getCommits` —
the blob page's Permalink view passes a SHA here, not just a branch) use
`safeRefNameSchema` instead, which accepts either shape without weakening the
traversal check. `commitSha` fields (`getCommit`, `getCommitDiff`) use
`safeCommitShaSchema`.

`safeRepoPathSchema` plays the same role for file `path` fields — must be
relative, no `..` segments, no `.git/` prefix, no null bytes.

`getCommits` (called with `limit: 1` via `repositoryLatestCommitQueryOptions`
in `query-options.ts`) does double duty: it's both the tree page's "latest
commit" display *and*, via an extra `refetchInterval` the client hook adds on
top of that same query, the poll that detects a push landing while a repo
page is open (see [performance.md](./performance.md)'s "cache freshness
signaling"). There's deliberately no separate minimal "just the SHA"
endpoint — a depth-1 commit-log walk is already as cheap as a bare ref
resolve, so splitting it into two endpoints would only add a second query to
keep in sync for no perf benefit.

### `issues.ts` / `pull-requests.ts` / `comments.ts`
Split by resource (previously one combined `issues.ts`). Each owns its own
schema validation, access checks, and activity logging:
- `issues.ts` — create/list/get/update issues, plus `getIssueNumbers` (used to
  resolve `#123` references in markdown to links — see
  `remark-autolink-references.ts`).
- `pull-requests.ts` — same shape for PRs, plus `mergePullRequest`, which
  delegates the actual merge to `git-merge-iso.ts` and only updates PR status
  in Postgres after the git-level merge succeeds. `createPullRequest`'s
  `sourceBranchName`/`targetBranchName` go through `safeBranchNameSchema` —
  a PR's branch names are stored once and reused, unvalidated at read time,
  by every later merge attempt, so rejecting a bad one has to happen at
  creation (see [security.md](./security.md)).
- `comments.ts` — comments attached to either an issue or a PR (exactly one
  of `issueId`/`pullRequestId` is set); update/delete are gated by "author, or
  a write/moderate collaborator" respectively.

### `search.ts` — cross-entity search and activity feeds
`searchRepositories`/`searchIssues`/`searchUsers` (each gated per-result by
`canReadRepo` where applicable), plus the three activity-feed queries
(`getUserActivity`, `getRepositoryActivity`, `getGlobalActivity`) that back the
dashboard and repo activity views. All of these except `getUserActivity` use
`getCurrentUserOptional()` rather than `getCurrentUser()` — they only ever
return data an anonymous visitor could already reach via a direct public-repo
URL, so none of them should hard-require login (see
[authentication.md](./authentication.md)'s "public + anonymous = read-only"
model). `getUserActivity` is the exception: with no `userId` given it defaults
to the caller's own activity, which only makes sense for a signed-in user.
The activity queries push their visibility
filter (public-repos-only for a non-owner's feed) *into* the SQL query rather
than filtering in JS after `limit` — filtering after the fact could return
fewer rows than requested even when plenty of qualifying activity exists
further back in the table.

### `repo-access.ts` — see [authentication.md](./authentication.md)

### `session.ts` — see [authentication.md](./authentication.md)

## Client side: `query-options.ts`

Every server function that reads data has a matching `xQueryOptions(...)`
factory in `src/lib/query-options.ts`, and every query key is sourced from the
`queryKeys` object there — **never inline a query key string at a call site**,
since that breaks TanStack Query's cache invalidation (a mutation that
invalidates `queryKeys.repository(id)` needs every read of that same data to
have used the exact same key). Route loaders call `queryClient.ensureQueryData(xQueryOptions(...))`
to populate the cache during SSR; components then `useQuery(xQueryOptions(...))`
and get the already-fetched data with no extra round trip on first render.

Stale times are deliberately tiered (see [performance.md](./performance.md)) —
match the tier of whatever you're adding to how often that data actually
changes, rather than defaulting to the shortest one out of caution.
