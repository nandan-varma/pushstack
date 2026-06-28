# Plan 005: DB Performance and CI Pipeline

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, reply with the report format from the
> dispatch prompt. Do NOT update plans/README.md — the reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat 05a7783..HEAD -- src/server/repo-access.ts src/server/repositories.ts src/db/github-schema.ts`
> If any of these files changed since this plan was written, compare the "Current state" excerpts before proceeding.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: 002 (002 modifies repositories.ts; this plan also modifies it — run 002 first and re-check this plan's excerpts against the current file before proceeding)
- **Category**: perf, dx
- **Planned at**: commit `05a7783`, 2026-06-27

## Why this matters

Two improvements:

**PERF-01 — N+1 DB queries in permission checks.** Every call to `canReadRepo` or `canWriteRepo` fetches the full repository row from the database. Callers — `getRepository`, `getRepositoryByName`, `toggleStar`, and many functions in `files.ts` — then immediately fetch the same row again. `getRepository` runs 3–4 queries (repo via canReadRepo → repo again directly → star count → user starred) where 2 would suffice. Fix: make `getRepositoryAccess` return the repo it already fetched, so callers can use it.

**DX-03 — No CI pipeline.** There is no `.github/workflows/` directory. PRs and pushes to `main` run no automated checks. This plan adds a GitHub Actions workflow that runs lint, typecheck, and unit tests on every PR.

**ARCH-03 — Composite DB index.** `repositoryCollaborators` has individual indexes on `repoId` and `userId` but the access check queries `AND(repoId = ?, userId = ?)`. A composite index serves this pattern directly.

## Current state

### `src/server/repo-access.ts`

**Full current signature of `getRepositoryAccess` (lines 45–140):**
```ts
export async function getRepositoryAccess(
    repoId: number,
    userId?: string | null,
): Promise<RepositoryAccess | null> {
    const repository = await db.query.repositories.findFirst({  // ← DB fetch #1
        where: eq(repositories.id, repoId),
    });
    // ... uses repository, may also call getCollaboratorRole (another query) ...
    return { repository, collaboratorRole, role, canRead, canWrite, ... };
}
```

`canReadRepo` and `canWriteRepo` call `getRepositoryAccess` and discard `repository`:
```ts
export async function canReadRepo(repoId: number, userId?: string | null) {
    const access = await getRepositoryAccess(repoId, userId);
    return access?.canRead ?? false;
}
```

### `src/server/repositories.ts` (after plan 002 lands)

`getRepository` serverFn:
```ts
// line ~192
if (!(await canReadRepo(data.id, currentUser?.id))) {  // ← DB fetch (repo + maybe collab)
    throw new Error("Access denied");
}

const repo = await db.query.repositories.findFirst({    // ← DB fetch again!
    where: eq(repositories.id, data.id),
    with: { owner: true },
});
```

`getRepositoryByName` serverFn:
```ts
const owner = await db.query.user.findFirst(...);       // DB fetch 1
const repo = await db.query.repositories.findFirst(...); // DB fetch 2
if (!(await canReadRepo(repo.id, currentUser?.id))) {   // DB fetch 3 (same repo!)
    throw new Error("Access denied");
}
```

### `src/db/github-schema.ts` — repositoryCollaborators table

Current indexes:
```ts
repoIdx: index("collab_repo_idx").on(table.repoId),
userIdx: index("collab_user_idx").on(table.userId),
```
Missing: composite `(repoId, userId)` index for the AND query in `getCollaboratorRole`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Lint | `pnpm check` | exit 0 |
| Tests | `pnpm test` | exit 0 |
| DB schema push (user runs this manually) | `pnpm db:push` | exit 0 |

Note: The executor should NOT run `pnpm db:push` — it requires live database credentials. Create the schema change only; note in the report that the user must run `pnpm db:push` to apply it.

## Scope

**In scope**:
- `src/server/repo-access.ts`
- `src/server/repositories.ts`
- `src/db/github-schema.ts`
- `.github/workflows/ci.yml` (create)

**Out of scope** (do NOT touch even though they use canReadRepo):
- `src/server/files.ts` — has 13 calls to can*Repo; updating all of them is a follow-on task, not this plan
- `src/server/issues.ts` — same reason
- Any test file

## Git workflow

- Branch: `advisor/005-db-performance-and-ci`
- Commits: separate commits for the N+1 fix and the CI pipeline
- Do NOT push or open a PR.

## Steps

### Step 1: Add `repository` to RepositoryAccess return and update getRepositoryAccess

In `src/server/repo-access.ts`, the `RepositoryAccess` interface currently includes `repository` (it's already there — the full type is `{ repository: typeof repositories.$inferSelect; collaboratorRole: ...; role: ...; canRead: boolean; canWrite: boolean; ... }`). Confirm this by reading the file.

The `getRepositoryAccess` function already fetches and returns `repository`. The callers (`canReadRepo`, `canWriteRepo`, etc.) just discard it.

No interface change needed. Move to Step 2.

**Verify**: `grep "repository:" src/server/repo-access.ts` → shows `repository` in the RepositoryAccess interface

### Step 2: Fix N+1 in getRepository serverFn

In `src/server/repositories.ts`, find `getRepository` (the serverFn with `id: z.number()`).

**Current pattern (to replace):**
```ts
if (!(await canReadRepo(data.id, currentUser?.id))) {
    throw new Error("Access denied");
}

const repo = await db.query.repositories.findFirst({
    where: eq(repositories.id, data.id),
    with: { owner: true },
});

if (!repo) {
    throw new Error("Repository not found");
}
```

**Replacement (fetch access which includes repo, then use it):**
```ts
const access = await getRepositoryAccess(data.id, currentUser?.id);

if (!access) {
    throw new Error("Repository not found");
}

if (!access.canRead) {
    throw new Error("Access denied");
}

// access.repository doesn't include `owner` — fetch with owner only now
const repo = await db.query.repositories.findFirst({
    where: eq(repositories.id, data.id),
    with: { owner: true },
});

if (!repo) {
    throw new Error("Repository not found");
}
```

Note: `getRepositoryAccess` fetches without `owner` join; we still need one query with `with: { owner: true }` for the return value. This reduces the pattern from 3–4 queries to 2 (access check + with-owner fetch). The star queries below the repo fetch stay as-is.

Add `getRepositoryAccess` to the import from `./repo-access` at the top of repositories.ts.

**Verify**: `pnpm check` → exit 0

### Step 3: Fix N+1 in getRepositoryByName serverFn

In `src/server/repositories.ts`, find `getRepositoryByName`.

**Current pattern:**
```ts
const owner = await db.query.user.findFirst({ where: eq(user.username, data.owner) });
if (!owner) throw new Error("Owner not found");

const repo = await db.query.repositories.findFirst({
    where: and(eq(repositories.ownerId, owner.id), eq(repositories.name, data.name)),
    with: { owner: true },
});
if (!repo) throw new Error("Repository not found");

if (!(await canReadRepo(repo.id, currentUser?.id))) {
    throw new Error("Access denied");
}

return repo;
```

**Replacement (call getRepositoryAccess after fetching repo, skip the separate canReadRepo):**
```ts
const owner = await db.query.user.findFirst({ where: eq(user.username, data.owner) });
if (!owner) throw new Error("Owner not found");

const repo = await db.query.repositories.findFirst({
    where: and(eq(repositories.ownerId, owner.id), eq(repositories.name, data.name)),
    with: { owner: true },
});
if (!repo) throw new Error("Repository not found");

const access = await getRepositoryAccess(repo.id, currentUser?.id);
if (!access?.canRead) {
    throw new Error("Access denied");
}

return repo;
```

This removes the third redundant repo fetch (canReadRepo → getRepositoryAccess → findFirst was the third trip to the DB).

**Verify**: `pnpm check` → exit 0

### Step 4: Add composite index to repositoryCollaborators

In `src/db/github-schema.ts`, find the `repositoryCollaborators` table definition. In its index block, add a composite index:

```ts
repoUserIdx: index("collab_repo_user_idx").on(table.repoId, table.userId),
```

Keep the existing `repoIdx` and `userIdx` — they serve other query patterns. This is an addition, not a replacement.

**Verify**: `grep "collab_repo_user_idx" src/db/github-schema.ts` → 1 match

**Verify**: `pnpm check` → exit 0

Note in the report: "User must run `pnpm db:push` to apply the new index to the database."

### Step 5: Create CI workflow

Create `.github/workflows/ci.yml` with this content:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm check

  typecheck:
    name: Typecheck
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck

  test:
    name: Unit Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
```

Note: The `typecheck` job requires that plan 003 (which adds the `typecheck` script) has been applied first. If plan 003 has not been applied, the `typecheck` job will fail in CI because the script doesn't exist yet. In that case, omit the `typecheck` job and note it in the report.

**Verify**: `ls .github/workflows/ci.yml` → file exists

**Verify**: `pnpm check` → exit 0 (biome ignores yml files; this step just confirms no other files were accidentally changed)

### Step 6: Run full tests

**Verify**: `pnpm test` → exit 0

## Test plan

No new tests. This plan improves existing code paths. The test suite passing is verification.

## Done criteria

- [ ] `grep "getRepositoryAccess" src/server/repositories.ts` → at least 2 matches (import + 2 call sites)
- [ ] `grep "canReadRepo" src/server/repositories.ts` count decreased (the direct canReadRepo calls in getRepository and getRepositoryByName are removed)
- [ ] `grep "collab_repo_user_idx" src/db/github-schema.ts` → 1 match
- [ ] `ls .github/workflows/ci.yml` → exists
- [ ] `pnpm check` exits 0
- [ ] `pnpm test` exits 0
- [ ] Only in-scope files modified

## STOP conditions

- `getRepositoryAccess` is already imported in repositories.ts but the import is different than expected — reconcile before adding a duplicate import.
- After removing a `canReadRepo` call, the replacement `access?.canRead` check does NOT have equivalent behavior to the original — report the discrepancy.
- `repositoryCollaborators` table in `github-schema.ts` already has a composite `(repoId, userId)` index under a different name — skip the index step and report.
- Plan 002 modified repositories.ts in ways that conflict with the code excerpts in Step 2–3 — report the conflict.

## Maintenance notes

- `files.ts` and `issues.ts` still have ~15 remaining `canReadRepo`/`canWriteRepo` calls that could be optimized in a follow-on plan using the same pattern.
- After `pnpm db:push`, the new index will be applied. On a table with many collaborators, index creation may take a moment but is non-blocking in Postgres for a new index (`CREATE INDEX CONCURRENTLY` is what Drizzle uses).
- The CI workflow pins `pnpm` at version 9 and Node at 22. Adjust these to match whatever versions are in use in the project's `.nvmrc` or `engines` field if present.
