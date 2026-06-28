# Plan 006: Bump staleTime for git data queries

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to
> the next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 6574f3e..HEAD -- src/lib/query-options.ts`
> If that file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as
> a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `6574f3e`, 2026-06-27

## Why this matters

Branches and file trees only change when someone pushes to the repo. Fetching
them every 30 seconds burns latency and R2 reads for no benefit. Bumping their
`staleTime` to 5 minutes means every tab-switch and back-navigation returns
instantly from React Query's cache. Commits are also immutable once written —
same reasoning applies.

## Current state

File: `src/lib/query-options.ts`

Relevant constants (lines 62–64):
```ts
const SESSION_STALE_TIME = 60_000;
const DEFAULT_STALE_TIME = 30_000;
const LONG_LIVED_STALE_TIME = 5 * 60_000;
```

`repositoryBranchesQueryOptions` (lines 112–118) uses `DEFAULT_STALE_TIME`:
```ts
export function repositoryBranchesQueryOptions(repoId: number) {
  return queryOptions({
    queryKey: queryKeys.repoBranches(repoId),
    queryFn: () => getBranches({ data: { repoId } }),
    staleTime: DEFAULT_STALE_TIME,
  });
}
```

`repositoryFilesQueryOptions` (lines 120–134) uses `DEFAULT_STALE_TIME`:
```ts
export function repositoryFilesQueryOptions({ repoId, branchName, path = "" }) {
  return queryOptions({
    queryKey: queryKeys.repoFiles(repoId, branchName, path),
    queryFn: () => listFiles({ data: { repoId, branchName, path } }),
    staleTime: DEFAULT_STALE_TIME,
  });
}
```

`repositoryCommitsQueryOptions` (lines 152–168) uses `DEFAULT_STALE_TIME`:
```ts
export function repositoryCommitsQueryOptions({ repoId, branchName, limit = 50, skip = 0 }) {
  return queryOptions({
    queryKey: queryKeys.repoCommits(repoId, branchName, limit, skip),
    queryFn: () => getCommits({ data: { repoId, branchName, limit, skip } }),
    staleTime: DEFAULT_STALE_TIME,
  });
}
```

`repositoryFileQueryOptions` (lines 136–149) already uses `DEFAULT_STALE_TIME` too — bump this one as well (file content only changes on push):
```ts
export function repositoryFileQueryOptions({ repoId, branchName, path }) {
  return queryOptions({
    queryKey: queryKeys.repoFile(repoId, branchName, path),
    queryFn: () => getFile({ data: { repoId, branchName, path } }),
    staleTime: DEFAULT_STALE_TIME,
  });
}
```

`repositoryCommitQueryOptions` and `repositoryCommitDiffQueryOptions` already use `LONG_LIVED_STALE_TIME` — leave them alone.

## Commands you will need

| Purpose   | Command         | Expected on success    |
|-----------|-----------------|------------------------|
| Typecheck | `pnpm check`    | exit 0, no errors      |
| Dev build | `pnpm build`    | exit 0                 |

## Scope

**In scope** (the only file you should modify):
- `src/lib/query-options.ts`

**Out of scope** (do NOT touch):
- Any component or route file — they consume these query options and need no change.
- `src/server/` — server-side logic is unaffected.

## Git workflow

- Branch: `advisor/006-staletime-bumps`
- Single commit; message style matching repo (`git log --oneline -5` shows plain imperative messages)
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Change staleTime on four query option functions

In `src/lib/query-options.ts`, change `staleTime: DEFAULT_STALE_TIME` to
`staleTime: LONG_LIVED_STALE_TIME` in these four functions:

1. `repositoryBranchesQueryOptions` (line ~116)
2. `repositoryFilesQueryOptions` (line ~131)
3. `repositoryFileQueryOptions` (line ~147)
4. `repositoryCommitsQueryOptions` (line ~165)

Do not touch any other `staleTime` assignment — `repositoryByNameQueryOptions`,
`userRepositoriesQueryOptions`, `authSessionQueryOptions`, `repositoryIssuesQueryOptions`,
`issueQueryOptions`, `repositoryPullRequestsQueryOptions`, `pullRequestQueryOptions`, and
comment/issue-comments options should all stay on `DEFAULT_STALE_TIME`.

**Verify**: `grep -n "LONG_LIVED_STALE_TIME\|DEFAULT_STALE_TIME" src/lib/query-options.ts`

Expected: `LONG_LIVED_STALE_TIME` appears on lines for `repoBranches`, `repoFiles`,
`repoFile`, `repoCommits`, and the two existing commit-detail functions. `DEFAULT_STALE_TIME`
appears only on session, repo-by-name, user-repos, issues, PRs, comments.

### Step 2: Typecheck

**Verify**: `pnpm check` → exits 0 with no errors or warnings about the changed lines.

## Test plan

No new tests required — this is a constant swap with no logic change. The
existing React Query behaviour (stale-while-revalidate) is not modified, only
the threshold at which data is considered stale.

Manual smoke test: navigate to a repo page, switch tabs, come back — branches
and file list should appear instantly from cache (no spinner).

## Done criteria

- [ ] `pnpm check` exits 0
- [ ] `grep -n "staleTime: DEFAULT_STALE_TIME" src/lib/query-options.ts` returns only lines for non-git-data options (session, byName, userRepos, issues, PRs, comments, issueComments, prComments)
- [ ] `grep -n "staleTime: LONG_LIVED_STALE_TIME" src/lib/query-options.ts` returns 6 lines (branches, files, file, commits, commitDetail, commitDiff)
- [ ] No files outside the in-scope list are modified (`git diff --name-only`)
- [ ] `plans/README.md` status row updated to DONE

## STOP conditions

- The code at the locations in "Current state" doesn't match the excerpts (codebase has drifted).
- `pnpm check` reports type errors after the change.
- You find a third staleTime constant that was not mentioned — stop and report which function uses it.

## Maintenance notes

- If issues or PR data becomes real-time (e.g. webhooks), those options may also need `LONG_LIVED_STALE_TIME` or a `refetchInterval`.
- When Plan 008 (DB tree cache) lands, the effective cache for branches/files will be backed by Postgres, making the 5-minute client stale time even more conservative — consider raising it to `gcTime` (30 min) then, but that's a follow-up.
