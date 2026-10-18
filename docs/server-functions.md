# Server Functions

Every module in `src/server/` that isn't purely internal git plumbing exposes
its public surface as `createServerFn` calls — TanStack Start's mechanism for
defining a function that runs server-side but is called from client/route
code like a normal async function (the framework's Vite plugin turns the call
into an RPC under the hood). This doc catalogs those modules by resource.

## Conventions every module follows

- **Validation**: every `createServerFn` has a `.validator(...)` with a Zod
  schema — never trust `data` is already the right shape.
- **Access through `repo-access.ts`'s helpers**: read handlers use
  `readWithAccess(label, repoId, fn)` (perf context + optional session + read
  check), writes `writeWithAccess(repoId, fn(repo, user))`, owner-only actions
  `requireOwner`. A handler that already loaded the repo through a relation
  calls `getAccessForRepository`. See [authentication.md](./authentication.md).
- **Activity**: mutations that belong in the feed call
  `recordActivity(userId, repoId, event)` with a typed `ActivityEvent`.
- **Public fields only**: any user row leaving the server goes through
  `repositories.ts`'s `publicUserFields` (id, username, name, image) — never
  email.
- **Missing is `notFound()`**: a missing row, or a private one the caller
  can't read, is a 404, never a 500 or a 403 that leaks existence.
- **perf instrumentation on read paths**: `readWithAccess` opens the
  `perfContext`; wrap meaningfully-awaited sub-steps in `perfStep` (see
  [performance.md](./performance.md)).

## Modules by resource

### `repositories.ts` — repos, stars, collaborators
`createRepository`, `getUserRepositories`, `getRepositoryByName`,
`updateRepository` (rename moves storage under the lock), `deleteRepository`,
`repackRepository`, `toggleStar`, `getCollaborators`,
`addCollaboratorByUsername` (an upsert), `removeCollaborator`. Plain helpers
for other server modules: `findRepositoryByName` (cached) and
`claimNextIssueOrPrNumber`. Repo names must match `STORAGE_NAME_RE` — see
[security.md](./security.md).

### `files.ts` — files, branches, commits
Reads (`getFile`, `listFiles`, `getTreePageData`, `getLastCommits`,
`getFileHistory` with `depth: "banner" | "full"`, `getBranches`,
`getCommits`, `getCommit`, `getCommitDiff`, `getBranchDiff`) go through
`git-read.ts`; writes (`uploadFile`, `deleteFile`, `createBranch`,
`deleteBranch`) through `git-write.ts`, each recording a commit activity
where one was made.

Branch fields on write paths use `safeBranchNameSchema`; read paths use
`safeRefNameSchema`, which also accepts a full commit SHA (the blob page's
permalink). `commitSha` fields use `safeCommitShaSchema`, file paths
`safeRepoPathSchema` (relative, no `..`, no `.git/`, no NUL). Several
isomorphic-git calls (`git.commit`, `git.deleteBranch`) don't validate ref
names, so these schemas are what stops a path traversal from the web UI — see
[security.md](./security.md).

`getCommits` with `limit: 1` is both the tree page's latest-commit display
and, with a `refetchInterval`, the poll that notices a push while a repo page
is open (see [performance.md](./performance.md)'s "cache freshness
signaling").

### `issues.ts` / `pull-requests.ts` / `comments.ts`
- `issues.ts` — `createIssue`, `getIssues`, `getIssueNumbers` (for `#123`
  autolinking, `remark-autolink-references.ts`), `getIssueByNumber`,
  `updateIssue` (author or a write collaborator).
- `pull-requests.ts` — `createPullRequest` (both branches must exist and
  differ), `getPullRequests`, `getPullRequestNumbers`,
  `getPullRequestByNumber`, `updatePullRequest`, `mergePullRequest`.
  Merging runs `git-write.ts`'s `mergeBranches`, then records the merge only
  `WHERE status = 'open'` (a concurrent merge loses cleanly) and closes the
  issues the body names ("Closes #4").
- `comments.ts` — `createComment` on exactly one thread (`issueId` or
  `pullRequestId`, a zod union) and `getComments`.

### `search.ts`, `users.ts` — search, feeds, profiles
`searchRepositories` and `searchUsers` (LIKE wildcards in the query are
escaped), `getUserActivity`, and `getUserProfile`. All anonymous-readable:
they return only what a visitor could reach through public-repo URLs.
`getUserActivity` with no `userId` means "mine" and requires a session. The
visibility filter is in the SQL, not applied after `limit`.

### `tokens.ts` — personal access tokens
`listTokens`, `createToken` (the token is returned once), `revokeToken`.

### `repo-access.ts`, `session.ts` — see [authentication.md](./authentication.md)

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
