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

`getBranchHead` is the odd one out: it's not read by any page directly, only
polled by `repositoryBranchHeadQueryOptions` to detect a push landing while a
repo page is open (see [performance.md](./performance.md)'s "cache freshness
signaling"). Deliberately a single ref resolve (`getBranchHeadSha` in
`git-branch-ops.ts`) — not `getBranches` or `getCommits`, both of which do
meaningfully more work than comparing one SHA warrants when called every 20s
from every open tab.

### `issues.ts` / `pull-requests.ts` / `comments.ts`
Split by resource (previously one combined `issues.ts`). Each owns its own
schema validation, access checks, and activity logging:
- `issues.ts` — create/list/get/update issues, plus `getIssueNumbers` (used to
  resolve `#123` references in markdown to links — see
  `remark-autolink-references.ts`).
- `pull-requests.ts` — same shape for PRs, plus `mergePullRequest`, which
  delegates the actual merge to `git-merge-iso.ts` and only updates PR status
  in Postgres after the git-level merge succeeds.
- `comments.ts` — comments attached to either an issue or a PR (exactly one
  of `issueId`/`pullRequestId` is set); update/delete are gated by "author, or
  a write/moderate collaborator" respectively.

### `search.ts` — cross-entity search and activity feeds
`searchRepositories`/`searchIssues`/`searchUsers` (each gated per-result by
`canReadRepo` where applicable), plus the three activity-feed queries
(`getUserActivity`, `getRepositoryActivity`, `getGlobalActivity`) that back the
dashboard and repo activity views. The activity queries push their visibility
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
