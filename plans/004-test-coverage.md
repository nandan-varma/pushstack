# Plan 004: Test Coverage — R2 Backend and Repository CRUD

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, reply with the report format from the
> dispatch prompt. Do NOT update plans/README.md — the reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat 05a7783..HEAD -- src/server/git-r2-backend.ts src/server/__tests__/repositories.integration.test.ts`
> If any of these files changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (tests are new files; they don't depend on 001/002 being merged first)
- **Category**: tests
- **Planned at**: commit `05a7783`, 2026-06-27

## Why this matters

`R2Backend` and `R2RefBackend` in `git-r2-backend.ts` are the production git storage layer — every git object read and written in production flows through these classes. They currently have **zero test coverage**. Bugs in cache invalidation, ref CAS logic, or error mapping will corrupt repositories silently.

`repositories.integration.test.ts` exists but contains placeholder assertions (`expect(true).toBe(true)`) — it passes without verifying anything. `createRepository` and `deleteRepository` are the most critical server functions in the app and should have real characterization tests.

## Current state

### `src/server/git-r2-backend.ts`

The `R2Backend` class exports: `readFile`, `writeFile`, `unlink`, `readdir`, `mkdir`, `rmdir`, `stat`, `lstat`, `readlink`, `symlink`, `chmod`.

The `R2RefBackend` class exports: `readRef`, `writeRef`, `deleteRef`, `listRefs`.

Dependencies imported:
```ts
import { deleteFromR2, downloadFromR2, fileExistsInR2, listR2Files, uploadToR2 } from "#/lib/r2-operations";
import { deleteCache, getCache, invalidateCache, setCache } from "./git-cache";
import { GitObjectNotFoundError, GitRefNotFoundError } from "./git-errors";
import { getRepoGitStoragePrefix, getRepoGitStorageRoot } from "./git-storage-naming";
```

Key behaviors to test:
- `readFile`: cache miss → calls `downloadFromR2`, caches result; cache hit → returns cached value without R2 call
- `writeFile`: calls `uploadToR2`, invalidates cache via `deleteCache`
- `writeRef` with `expectedValue`: reads current, compares, writes if matches; throws conflict if mismatch
- Error mapping: `NoSuchKey` from R2 → `GitObjectNotFoundError`

### `src/server/__tests__/repositories.integration.test.ts`

Current state: placeholder tests like:
```ts
it("should create repository", async () => {
    expect(true).toBe(true);
});
```

### `src/test/setup.ts`

The vitest setup file — read it to understand what's globally set up (jsdom, matchers, etc.).

### Existing test patterns to follow

Read `src/server/__tests__/git-storage-naming.test.ts` to understand the test file structure and import patterns for server-side modules.

Read `src/server/__tests__/git-errors.test.ts` to understand how git-errors are tested.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Run specific test | `pnpm test -- src/server/__tests__/git-r2-backend.test.ts` | all pass |
| Run repositories tests | `pnpm test -- src/server/__tests__/repositories.integration.test.ts` | all pass |
| All tests | `pnpm test` | exit 0 |
| Lint | `pnpm check` | exit 0 |

## Scope

**In scope** (the only files you should create or modify):
- `src/server/__tests__/git-r2-backend.test.ts` (create new)
- `src/server/__tests__/repositories.integration.test.ts` (modify existing placeholder)

**Out of scope** (do NOT touch):
- `src/server/git-r2-backend.ts` — only writing tests for it, not changing it
- `src/server/repositories.ts` — only writing tests for it, not changing it
- Any other source file

## Git workflow

- Branch: `advisor/004-test-coverage`
- Commit: `test: add R2 backend unit tests and fix placeholder repository tests`
- Do NOT push or open a PR.

## Steps

### Step 1: Read existing test patterns

Before writing any tests, read:
- `src/server/__tests__/git-storage-naming.test.ts` (structure, imports)
- `src/server/__tests__/git-errors.test.ts` (how errors are tested)
- `src/test/setup.ts` (global setup)

This ensures the new tests match the repo's conventions.

### Step 2: Create git-r2-backend.test.ts

Create `src/server/__tests__/git-r2-backend.test.ts`.

Mock the three module dependencies. Use vitest's `vi.mock()`. The mocks must be set up before any imports that trigger the module (use factory functions):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock r2-operations
vi.mock("#/lib/r2-operations", () => ({
    downloadFromR2: vi.fn(),
    uploadToR2: vi.fn(),
    deleteFromR2: vi.fn(),
    listR2Files: vi.fn(),
    listAllR2Files: vi.fn(),
    bulkDeleteFromR2: vi.fn(),
    fileExistsInR2: vi.fn(),
}));

// Mock git-cache
vi.mock("../git-cache", () => ({
    getCache: vi.fn(),
    setCache: vi.fn(),
    deleteCache: vi.fn(),
    invalidateCache: vi.fn(),
}));

import { R2Backend, R2RefBackend } from "../git-r2-backend";
import * as r2ops from "#/lib/r2-operations";
import * as cache from "../git-cache";
```

Write tests for the following cases. The R2 path format is `repos/{ownerKey}/{repoName}/git/{relativePath}`, so use e.g. `repos/alice/myrepo/git/HEAD` as filepaths in tests.

**R2Backend.readFile:**
```
describe("R2Backend.readFile", () => {
    it("returns cached value on cache hit without calling R2")
    it("fetches from R2 on cache miss and caches the result")
    it("throws GitObjectNotFoundError when R2 returns 404")
    it("returns string when encoding is utf8")
})
```

**R2Backend.writeFile:**
```
describe("R2Backend.writeFile", () => {
    it("uploads to R2 and invalidates cache")
    it("sets content-type text/plain for refs/ paths")
    it("sets content-type text/plain for HEAD file")
    it("sets content-type application/octet-stream for objects/ paths")
})
```

**R2RefBackend.writeRef (CAS logic):**
```
describe("R2RefBackend.writeRef", () => {
    it("writes ref without expectedValue check when expectedValue is undefined")
    it("throws conflict error when current ref does not match expectedValue")
    it("writes successfully when current ref matches expectedValue")
})
```

For each test, set up the mock return values using `vi.mocked(r2ops.downloadFromR2).mockResolvedValue(...)` etc.

For the 404 case, mock `downloadFromR2` to throw an object with `name: "NoSuchKey"`.

**Verify**: `pnpm test -- src/server/__tests__/git-r2-backend.test.ts` → all tests pass

### Step 3: Fix placeholder repository integration tests

Read `src/server/__tests__/repositories.integration.test.ts` fully before editing. Understand what's already imported and what test infrastructure is in place.

Replace placeholder test bodies with real assertions. Focus on:

1. **`createRepository` happy path** — mock `db`, `getCurrentUser`, `initBareRepo`, `createCommit`, `syncRepositoryToR2` at minimum. Assert that:
   - The returned object has `name`, `ownerId`, `visibility` matching the input
   - `db.insert` was called for the repository record
   - `db.insert` was called for the activity log

2. **`createRepository` duplicate name rejection** — mock `db.query.repositories.findFirst` to return an existing repo. Assert that the function throws with a message containing "already exists".

3. **`deleteRepository` authorization check** — mock the repo owner to be a different user than the current user. Assert that the function throws with a message about ownership.

Follow the import pattern from `git-storage-naming.test.ts`. Use `vi.mock` for all external dependencies (db, git operations, R2 operations).

**Verify**: `pnpm test -- src/server/__tests__/repositories.integration.test.ts` → all tests pass (no `true === true` assertions remain)

### Step 4: Run full suite

**Verify**: `pnpm test` → exit 0, total test count is higher than before (new tests added)

**Verify**: `pnpm check` → exit 0

## Test plan

This plan IS the test plan. The new files are the deliverable.

**Minimum bar for the R2 backend tests:**
- At least 8 test cases covering the scenarios in Step 2
- Each test asserts on actual behavior (mock calls, return values, thrown errors) — not just `expect(true).toBe(true)`
- The 404 → `GitObjectNotFoundError` mapping must be tested
- The CAS conflict in `writeRef` must be tested

**Minimum bar for the repository tests:**
- All existing `it(...)` blocks have real assertions
- createRepository happy path asserts on the return value structure
- Duplicate name case asserts on the thrown error

## Done criteria

- [ ] `ls src/server/__tests__/git-r2-backend.test.ts` → file exists
- [ ] `pnpm test -- src/server/__tests__/git-r2-backend.test.ts` → ≥ 8 tests pass
- [ ] `pnpm test -- src/server/__tests__/repositories.integration.test.ts` → all pass, no `true === true` assertions (check with `grep "true.*true\|toBe(true)" src/server/__tests__/repositories.integration.test.ts`)
- [ ] `pnpm test` exits 0
- [ ] `pnpm check` exits 0
- [ ] Only in-scope files created/modified

## STOP conditions

- `src/server/__tests__/repositories.integration.test.ts` has complex setup that makes the test strategy unclear — report what you found and ask for guidance.
- `vi.mock("#/lib/r2-operations", ...)` fails because the path alias `#/` is not resolved in the test environment — report the error.
- Any test you write cannot be made to pass without modifying source files — report what the test reveals.

## Maintenance notes

- These tests mock R2 and don't test actual S3/R2 API compatibility. If R2 API shape changes (e.g., error format changes), the mocks may pass while production breaks. A real integration test against a local MinIO or R2 dev bucket would be the upgrade path.
- When `git-r2-backend.ts` is changed by another plan (e.g., the R2 performance plan changes `stat()` behavior), these tests may need updating — the `fileExistsInR2` mock may become unused.
