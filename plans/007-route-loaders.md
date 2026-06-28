# Plan 007: Add SSR route loaders to eliminate client-side waterfalls

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to
> the next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> ```
> git diff --stat 6574f3e..HEAD -- \
>   src/routes/repo.\$owner.\$name.index.tsx \
>   src/routes/repo/\$owner.\$name.commits.tsx \
>   src/routes/repo/\$owner.\$name.issues.tsx \
>   src/routes/repo/\$owner.\$name.issues.\$id.tsx \
>   src/routes/repo/\$owner.\$name.pulls.tsx \
>   src/routes/repo/\$owner.\$name.pulls.\$id.tsx
> ```
> Compare "Current state" excerpts against live code for any changed file
> before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (benefits from 008 when it lands)
- **Category**: perf
- **Planned at**: commit `6574f3e`, 2026-06-27

## Why this matters

Without a `loader`, TanStack Start renders the route shell on the server,
then the component mounts on the client and fires its queries. Every repo
sub-page currently does:

1. Wait for parent `repositoryByName` (comes back via parent loader — already
   fixed in `repo.$owner.$name.tsx`)
2. Only then fire branches + files / commits / issues / PRs
3. Render loading skeleton, await responses, re-render

That is a full client round-trip waterfall after initial HTML. Adding a
`loader` to each child route makes the server prefetch the data before
streaming HTML; the client component mounts with data already in cache →
zero spinner on navigation.

The pattern is already established: `repo.$owner.$name.blob.$branch.$.tsx`
(file viewer) does exactly this — it is the reference implementation.

## Current state

### Pattern to follow (already working correctly)

`src/routes/repo/$owner.$name.blob.$branch.$.tsx` lines 19–35:
```tsx
export const Route = createFileRoute("/repo/$owner/$name/blob/$branch/$")({
  loader: async ({ params, context: { queryClient } }) => {
    const repo = await queryClient.ensureQueryData(
      repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
    );
    if (repo) {
      await queryClient.ensureQueryData(
        repositoryFileQueryOptions({
          repoId: repo.id,
          branchName: params.branch,
          path: params._splat || "",
        }),
      );
    }
  },
  component: FileBlobPage,
});
```

Key points:
- `queryClient.ensureQueryData` deduplicates: if the parent loader already
  fetched `repositoryByName`, this returns the cached value without a second
  request.
- The `if (repo)` guard avoids crashing when the repo doesn't exist.
- Parallel prefetch of multiple resources uses `Promise.all`.

### Files that need loaders

#### `src/routes/repo.$owner.$name.index.tsx` (Code tab)

Current route definition (lines 12–14) — no loader:
```tsx
export const Route = createFileRoute("/repo/$owner/$name/")({
  component: RepositoryIndexPage,
});
```

Needs to prefetch: `repositoryByName`, `repositoryBranches`, `repositoryFiles`
(root path, default branch). Default branch is on `repo.defaultBranch || "main"`.

Query options to import: `repositoryBranchesQueryOptions`, `repositoryFilesQueryOptions`
(already imported by the component below).

#### `src/routes/repo/$owner.$name.commits.tsx` (Commits tab)

Current route definition (lines 12–17) — no loader:
```tsx
export const Route = createFileRoute("/repo/$owner/$name/commits")({
  component: CommitsPage,
  validateSearch: (search: Record<string, unknown>) => ({
    branch: (search.branch as string) || "main",
  }),
});
```

Needs to prefetch: `repositoryByName`, `repositoryBranches`, `repositoryCommits`
(for the branch from search params, or "main" if absent). The `search.branch`
param is available as `params` in the loader via `loaderDeps` — see Step 2 for
the correct TanStack Router pattern for search-param-dependent loaders.

Query options to import: `repositoryBranchesQueryOptions`,
`repositoryCommitsQueryOptions` (already imported by the component).

#### `src/routes/repo/$owner.$name.issues.tsx` (Issues tab)

Current route definition (lines 26–28) — no loader:
```tsx
export const Route = createFileRoute("/repo/$owner/$name/issues")({
  component: IssuesPage,
});
```

Needs to prefetch: `repositoryByName`, `repositoryIssues` (status "open", the default filter).

Query options to import: `repositoryIssuesQueryOptions` (already imported).

#### `src/routes/repo/$owner.$name.issues.$id.tsx` (Issue detail)

Current route definition (line 19) — no loader:
```tsx
export const Route = createFileRoute("/repo/$owner/$name/issues/$id")({
  component: IssueDetailPage,
});
```

Needs to prefetch: `repositoryByName`, `issue(issueId)`, `issueComments(issueId)`.

Query options to import: `issueQueryOptions`, `issueCommentsQueryOptions`
(already imported by the component).

#### `src/routes/repo/$owner.$name.pulls.tsx` (Pull Requests tab)

Current route definition (lines 27–29) — no loader:
```tsx
export const Route = createFileRoute("/repo/$owner/$name/pulls")({
  component: PullRequestsPage,
});
```

Needs to prefetch: `repositoryByName`, `repositoryBranches` (for the create-PR
branch selector), `repositoryPullRequests` (status "open").

Query options to import: `repositoryBranchesQueryOptions`,
`repositoryPullRequestsQueryOptions` (already imported).

#### `src/routes/repo/$owner.$name.pulls.$id.tsx` (PR detail)

Current route definition (line 25) — no loader:
```tsx
export const Route = createFileRoute("/repo/$owner/$name/pulls/$id")({
  component: PullRequestDetailPage,
});
```

Needs to prefetch: `repositoryByName`, `pullRequest(prId)`,
`pullRequestComments(prId)`.

Query options to import: `pullRequestQueryOptions`, `pullRequestCommentsQueryOptions`
(already imported by the component).

### Router context

`src/router.tsx` passes `queryClient` via `context: createAppContext()`.
Every `loader` function receives `{ context: { queryClient }, params, ... }`.
This is already used in the parent route and the blob route — same pattern here.

## Commands you will need

| Purpose   | Command       | Expected on success        |
|-----------|---------------|----------------------------|
| Typecheck | `pnpm check`  | exit 0, no errors          |
| Build     | `pnpm build`  | exit 0                     |

## Scope

**In scope** (the only files you should modify):
- `src/routes/repo.$owner.$name.index.tsx`
- `src/routes/repo/$owner.$name.commits.tsx`
- `src/routes/repo/$owner.$name.issues.tsx`
- `src/routes/repo/$owner.$name.issues.$id.tsx`
- `src/routes/repo/$owner.$name.pulls.tsx`
- `src/routes/repo/$owner.$name.pulls.$id.tsx`

**Out of scope** (do NOT touch):
- `src/routes/repo.$owner.$name.tsx` — parent route already has a loader.
- `src/routes/repo/$owner.$name.blob.$branch.$.tsx` — already has a loader.
- `src/lib/query-options.ts` — query options are imported, not modified here.
- Any server-side file in `src/server/`.
- `src/routeTree.gen.ts` — auto-generated, never edit by hand.

## Git workflow

- Branch: `advisor/007-route-loaders`
- One commit per route file, or a single commit for all six — either is fine.
- Message style: plain imperative (e.g. `add loader to repo index route`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Code tab — `repo.$owner.$name.index.tsx`

The component already imports `repositoryBranchesQueryOptions` and
`repositoryFilesQueryOptions` (lines 7–11). Add `loader` to the route:

```tsx
export const Route = createFileRoute("/repo/$owner/$name/")({
  loader: async ({ params, context: { queryClient } }) => {
    const repo = await queryClient.ensureQueryData(
      repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
    );
    if (repo) {
      const branch = repo.defaultBranch || "main";
      await Promise.all([
        queryClient.ensureQueryData(repositoryBranchesQueryOptions(repo.id)),
        queryClient.ensureQueryData(
          repositoryFilesQueryOptions({ repoId: repo.id, branchName: branch }),
        ),
      ]);
    }
  },
  component: RepositoryIndexPage,
});
```

No import changes needed — `repositoryByNameQueryOptions` is already imported
(line 9), and the branch/file options are also already imported.

**Verify**: `pnpm check` → exits 0.

### Step 2: Commits tab — `repo/$owner.$name.commits.tsx`

The commits page reads `branch` from search params. TanStack Router makes
search params available in the loader via `loaderDeps`:

```tsx
export const Route = createFileRoute("/repo/$owner/$name/commits")({
  validateSearch: (search: Record<string, unknown>) => ({
    branch: (search.branch as string) || "main",
  }),
  loaderDeps: ({ search }) => ({ branch: search.branch }),
  loader: async ({ params, deps, context: { queryClient } }) => {
    const repo = await queryClient.ensureQueryData(
      repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
    );
    if (repo) {
      await Promise.all([
        queryClient.ensureQueryData(repositoryBranchesQueryOptions(repo.id)),
        queryClient.ensureQueryData(
          repositoryCommitsQueryOptions({
            repoId: repo.id,
            branchName: deps.branch,
          }),
        ),
      ]);
    }
  },
  component: CommitsPage,
});
```

`repositoryByNameQueryOptions`, `repositoryBranchesQueryOptions`, and
`repositoryCommitsQueryOptions` are already imported (lines 8–11).

**Verify**: `pnpm check` → exits 0.

### Step 3: Issues tab — `repo/$owner.$name.issues.tsx`

```tsx
export const Route = createFileRoute("/repo/$owner/$name/issues")({
  loader: async ({ params, context: { queryClient } }) => {
    const repo = await queryClient.ensureQueryData(
      repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
    );
    if (repo) {
      await queryClient.ensureQueryData(
        repositoryIssuesQueryOptions({ repoId: repo.id, status: "open" }),
      );
    }
  },
  component: IssuesPage,
});
```

`repositoryByNameQueryOptions` and `repositoryIssuesQueryOptions` are already
imported.

**Verify**: `pnpm check` → exits 0.

### Step 4: Issue detail — `repo/$owner.$name.issues.$id.tsx`

The `$id` param is a string from the URL; the component already converts it to
a number via `Number(id)`. Do the same in the loader:

```tsx
export const Route = createFileRoute("/repo/$owner/$name/issues/$id")({
  loader: async ({ params, context: { queryClient } }) => {
    const repo = await queryClient.ensureQueryData(
      repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
    );
    const issueId = Number(params.id);
    if (repo && Number.isFinite(issueId)) {
      await Promise.all([
        queryClient.ensureQueryData(issueQueryOptions(issueId)),
        queryClient.ensureQueryData(issueCommentsQueryOptions(issueId)),
      ]);
    }
  },
  component: IssueDetailPage,
});
```

Check which query options the component imports at the top of the file;
ensure `issueQueryOptions` and `issueCommentsQueryOptions` are in that import.
Add them if missing.

**Verify**: `pnpm check` → exits 0.

### Step 5: Pull Requests tab — `repo/$owner.$name.pulls.tsx`

```tsx
export const Route = createFileRoute("/repo/$owner/$name/pulls")({
  loader: async ({ params, context: { queryClient } }) => {
    const repo = await queryClient.ensureQueryData(
      repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
    );
    if (repo) {
      await Promise.all([
        queryClient.ensureQueryData(repositoryBranchesQueryOptions(repo.id)),
        queryClient.ensureQueryData(
          repositoryPullRequestsQueryOptions({ repoId: repo.id, status: "open" }),
        ),
      ]);
    }
  },
  component: PullRequestsPage,
});
```

`repositoryByNameQueryOptions`, `repositoryBranchesQueryOptions`, and
`repositoryPullRequestsQueryOptions` are already imported.

**Verify**: `pnpm check` → exits 0.

### Step 6: PR detail — `repo/$owner.$name.pulls.$id.tsx`

```tsx
export const Route = createFileRoute("/repo/$owner/$name/pulls/$id")({
  loader: async ({ params, context: { queryClient } }) => {
    const repo = await queryClient.ensureQueryData(
      repositoryByNameQueryOptions({ owner: params.owner, name: params.name }),
    );
    const prId = Number(params.id);
    if (repo && Number.isFinite(prId)) {
      await Promise.all([
        queryClient.ensureQueryData(pullRequestQueryOptions(prId)),
        queryClient.ensureQueryData(pullRequestCommentsQueryOptions(prId)),
      ]);
    }
  },
  component: PullRequestDetailPage,
});
```

Check imports at the top of the file; add `pullRequestQueryOptions` and
`pullRequestCommentsQueryOptions` from `@/lib/query-options` if missing.

**Verify**: `pnpm check` → exits 0.

### Step 7: Full typecheck and build

**Verify**: `pnpm check` → exits 0
**Verify**: `pnpm build` → exits 0

## Test plan

No automated test can verify SSR prefetch timing without a full E2E harness.
Manual verification:

1. Start dev server: `pnpm dev`
2. Navigate to a repo's Code tab — file list should appear without a loading
   skeleton (data arrives with the HTML).
3. Navigate to Commits, Issues, PRs — same: no spinner on first load.
4. Navigate between tabs — data is cached, no re-fetch visible in Network tab.
5. Navigate to an issue detail page — issue body and comments appear instantly.

## Done criteria

- [ ] `pnpm check` exits 0
- [ ] `pnpm build` exits 0
- [ ] All six route files have a `loader` property in their `createFileRoute(...)` call
- [ ] `grep -n "loader:" src/routes/repo.\$owner.\$name.index.tsx` returns a match
- [ ] `grep -n "loader:" src/routes/repo/\$owner.\$name.commits.tsx` returns a match
- [ ] `grep -n "loader:" src/routes/repo/\$owner.\$name.issues.tsx` returns a match
- [ ] `grep -n "loader:" src/routes/repo/\$owner.\$name.issues.\$id.tsx` returns a match
- [ ] `grep -n "loader:" src/routes/repo/\$owner.\$name.pulls.tsx` returns a match
- [ ] `grep -n "loader:" src/routes/repo/\$owner.\$name.pulls.\$id.tsx` returns a match
- [ ] No files outside the in-scope list are modified (`git diff --name-only`)
- [ ] `plans/README.md` status row updated to DONE

## STOP conditions

- The code at the locations in "Current state" doesn't match the excerpts (codebase has drifted).
- `pnpm check` produces a type error after adding a loader (report the error message).
- A route's component does not import the query options you expect — check and
  add the import, but if the query option function doesn't exist in
  `src/lib/query-options.ts`, STOP and report.
- `loaderDeps` produces a TypeScript error — report the exact message; the
  TanStack Router version in use may have a different API.

## Maintenance notes

- When new sub-routes are added under `/repo/$owner/$name/`, add a `loader`
  from day one — the pattern is established here.
- If Plan 008 (DB tree cache) lands, the `ensureQueryData` calls in these
  loaders will hit the DB-backed cache rather than R2/git for branches and
  files. No changes to loaders are needed for that.
- The `loaderDeps` pattern used in the commits route must also be used for any
  future route whose loader depends on search params — omitting it means the
  loader won't re-run when the search param changes.
