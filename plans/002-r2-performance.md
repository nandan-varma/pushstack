# Plan 002: R2 Performance and Storage Correctness

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, reply with the report format from the
> dispatch prompt. Do NOT update plans/README.md — the reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat 05a7783..HEAD -- src/lib/r2.ts src/server/git-r2-backend.ts src/server/git-repo-storage.ts src/server/repositories.ts`
> If any of these files changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf, bug
- **Planned at**: commit `05a7783`, 2026-06-27

## Why this matters

Seven issues in the R2 storage layer, ranging from unnecessary API calls to a silent data leak:

1. **S3Client re-created on every R2 call** — AWS SDK recommends reusing the client; creating one per call wastes connection pool setup.
2. **`stat()` makes 2 R2 calls instead of 1** — `fileExistsInR2` (HeadObject) followed by `downloadFromR2` (GetObject). Dropping the existence check and relying on the download's 404 error halves the call count; isomorphic-git calls `stat()` on every object access.
3. **`rmdir()` deletes R2 objects sequentially** — `bulkDeleteFromR2` exists but isn't used here.
4. **`readdir()` hard-coded at 1000 objects** — silently truncates repos with > 1000 git objects, causing incomplete clones.
5. **Path-stripping regex duplicated 6×** in `R2Backend` — maintenance hazard.
6. **`writeRemoteFilesToDisk` downloads R2 files sequentially** — every cold-start hydration pays O(n) round-trips to R2.
7. **`deleteRepository` never cleans up R2 data** — deleted repos accumulate in R2 indefinitely (storage cost + data retention violation).

## Current state

### `src/lib/r2.ts`

Role: R2 client factory and config helpers.

**PERF-06 — new S3Client on every call (lines 11–30):**
```ts
export function getR2Client() {
    const endpoint = process.env.R2_ENDPOINT;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

    if (!endpoint || !accessKeyId || !secretAccessKey) {
        throw new Error("R2 credentials not configured. Check your environment variables.");
    }

    return new S3Client({
        region: "auto",
        endpoint,
        credentials: { accessKeyId, secretAccessKey },
    });
}
```
No caching of the returned client; every call to `getR2Client()` in r2-operations.ts creates a new `S3Client` instance.

### `src/server/git-r2-backend.ts`

Role: isomorphic-git `fs` plugin that stores git objects in R2.

**PERF-02 — stat() double call (lines 244–265):**
```ts
async stat(filepath: string): Promise<any> {
    // ...
    try {
        const exists = await fileExistsInR2(r2Key);   // call 1 (HeadObject)
        if (!exists) {
            throw new GitObjectNotFoundError(`Object not found: ${relativePath}`);
        }
        const result = await downloadFromR2(r2Key);   // call 2 (GetObject)
        return { type: "file", mode: 0o100644, size: result.size || 0, ... };
    } catch (error: any) {
        // directory fallback
    }
}
```

**PERF-04 — rmdir sequential deletes (lines 222–230):**
```ts
async rmdir(filepath: string): Promise<void> {
    // ...
    const files = await listR2Files(r2Prefix, 1000);
    for (const file of files) {
        await deleteFromR2(file.key);   // sequential, one at a time
    }
    invalidateCache(`${ownerKey}/${repoName}/${prefix}`);
}
```

**PERF-05 — readdir 1000-file limit (line 180):**
```ts
const files = await listR2Files(r2Prefix, 1000);
```

**PERF-07 — path regex duplicated 6× (lines 79, 122, 152, 170, 215, 238):**
```ts
const relativePath = filepath.replace(
    /^\/?repos\/[^/]+\/[^/]+\/git\/?/,
    "",
);
```
This exact regex appears in `readFile`, `writeFile`, `unlink`, `readdir`, `rmdir`, `stat` — six methods.

The file currently imports: `deleteFromR2, downloadFromR2, fileExistsInR2, listR2Files, uploadToR2` from `#/lib/r2-operations`. Note that `listAllR2Files` and `bulkDeleteFromR2` are NOT currently imported here but exist in `r2-operations.ts`.

### `src/server/git-repo-storage.ts`

Role: hydrates repos from R2 to local disk and syncs back. `ensureRepositoryHydrated` and `syncRepositoryToR2` live here.

**PERF-08 — sequential hydration downloads (lines 123–141):**
```ts
async function writeRemoteFilesToDisk(
    repoPath: string,
    remoteFiles: Awaited<ReturnType<typeof listAllR2Files>>,
    sourcePrefix: string,
) {
    await fs.rm(repoPath, { recursive: true, force: true });
    await fs.mkdir(repoPath, { recursive: true });

    for (const file of remoteFiles) {     // ← sequential loop
        const relativePath = file.key.slice(sourcePrefix.length);
        const destination = path.join(repoPath, relativePath);
        const parent = path.dirname(destination);

        await fs.mkdir(parent, { recursive: true });

        const { content } = await downloadFromR2(file.key);  // ← one at a time
        await fs.writeFile(destination, content);
    }
}
```

Current imports include `bulkDeleteFromR2, bulkUploadToR2, downloadFromR2, listAllR2Files` from `#/lib/r2-operations`.

**RES-01 — no deleteRepositoryFromR2 function exists.** When `deleteRepository` in `repositories.ts` is called, it calls `deleteRepo(ownerKey, repo.name)` which only removes local filesystem. No R2 cleanup. R2 objects accumulate forever.

### `src/server/repositories.ts`

Role: server functions for repo CRUD operations.

**RES-01 — missing R2 cleanup in deleteRepository (lines 346–376):**
```ts
export const deleteRepository = createServerFn({ method: "POST" })
    // ...
    .handler(async ({ data }) => {
        // ... auth checks, fetch repo ...

        // Delete git repository from filesystem
        await deleteRepo(ownerKey, repo.name);
        for (const legacyOwnerKey of legacyOwnerKeys) {
            if (legacyOwnerKey !== ownerKey) {
                await deleteRepo(legacyOwnerKey, repo.name).catch(() => undefined);
            }
        }

        // ← NO R2 CLEANUP HERE

        // Delete from database (cascades to related tables)
        await db.delete(repositories).where(eq(repositories.id, data.id));

        return { success: true };
    });
```

**CODEQ-03 — commented-out backup code (lines 357–362):**
```ts
// Optionally backup before deleting (TODO: implement with isomorphic-git)
// try {
//   await backupRepositoryToR2(ownerId, repo.name);
// } catch (error) {
//   console.error('Failed to backup repository before deletion:', error);
// }
```

Current imports in repositories.ts include `syncRepositoryToR2` from `./git-repo-storage` but NOT `deleteRepositoryFromR2` (which doesn't exist yet).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Lint | `pnpm check` | exit 0 |
| Tests | `pnpm test` | exit 0 |
| Single test file | `pnpm test -- src/server/__tests__/git-storage-naming.test.ts` | all pass |

## Scope

**In scope**:
- `src/lib/r2.ts`
- `src/server/git-r2-backend.ts`
- `src/server/git-repo-storage.ts`
- `src/server/repositories.ts`

**Out of scope** (do NOT touch):
- `src/lib/r2-operations.ts` — the bulk functions already exist there; just import them
- `src/server/repo-access.ts` — separate plan handles N+1
- Any test file

## Git workflow

- Branch: `advisor/002-r2-performance`
- Commit per logical group (e.g., one commit for the S3Client singleton, one for the R2Backend methods, one for RES-01)
- Do NOT push or open a PR.

## Steps

### Step 1: S3Client singleton in r2.ts

In `src/lib/r2.ts`, add a module-level cache variable and return it from `getR2Client()`:

```ts
let _client: S3Client | null = null;

export function getR2Client(): S3Client {
    if (_client) return _client;

    const endpoint = process.env.R2_ENDPOINT;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

    if (!endpoint || !accessKeyId || !secretAccessKey) {
        throw new Error("R2 credentials not configured. Check your environment variables.");
    }

    _client = new S3Client({
        region: "auto",
        endpoint,
        credentials: { accessKeyId, secretAccessKey },
    });
    return _client;
}
```

**Verify**: `pnpm check` → exit 0

### Step 2: Extract stripGitDir helper and replace 6 regex occurrences in R2Backend

In `src/server/git-r2-backend.ts`, add this private helper just before the `R2Backend` class (after the `getR2Key` and `parseGitDir` functions):

```ts
function stripGitDir(filepath: string): string {
    return filepath.replace(/^\/?repos\/[^/]+\/[^/]+\/git\/?/, "");
}
```

Then replace the 6 occurrences of the inline regex. Each method currently has:
```ts
const relativePath = filepath.replace(
    /^\/?repos\/[^/]+\/[^/]+\/git\/?/,
    "",
);
```
Replace each with:
```ts
const relativePath = stripGitDir(filepath);
```

The six methods are: `readFile`, `writeFile`, `unlink`, `readdir`, `rmdir`, `stat`.

**Verify**: `grep -c "\/\^\\\\/\?repos" src/server/git-r2-backend.ts` → `0` (no remaining inline regex occurrences)

### Step 3: Fix stat() to use single R2 call

In `src/server/git-r2-backend.ts`, in the `stat` method, replace the double-call pattern:

Remove `fileExistsInR2` from the import list at the top of the file.

Replace the `stat` method body's try block. The current pattern is:
```ts
try {
    const exists = await fileExistsInR2(r2Key);
    if (!exists) {
        throw new GitObjectNotFoundError(`Object not found: ${relativePath}`);
    }
    const result = await downloadFromR2(r2Key);
    return { type: "file", mode: 0o100644, size: result.size || 0, ino: 0, mtimeMs: Date.now(), ctimeMs: Date.now(), uid: 1, gid: 1, dev: 1, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false };
} catch (error: any) {
    // Check if it's a directory by listing
    try {
        const files = await listR2Files(r2Key + "/", 1);
        if (files.length > 0) {
            return { type: "dir", mode: 0o040000, ... };
        }
    } catch {}
    throw new GitObjectNotFoundError(`Object not found: ${relativePath}`);
}
```

Replace with (remove the existence check, let download throw on 404):
```ts
try {
    const result = await downloadFromR2(r2Key);
    return {
        type: "file",
        mode: 0o100644,
        size: result.size || 0,
        ino: 0,
        mtimeMs: Date.now(),
        ctimeMs: Date.now(),
        uid: 1,
        gid: 1,
        dev: 1,
        isFile: () => true,
        isDirectory: () => false,
        isSymbolicLink: () => false,
    };
} catch (error: any) {
    if (error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404) {
        // Check if it's a directory by listing with prefix
        try {
            const files = await listR2Files(r2Key + "/", 1);
            if (files.length > 0) {
                return {
                    type: "dir",
                    mode: 0o040000,
                    size: 0,
                    ino: 0,
                    mtimeMs: Date.now(),
                    ctimeMs: Date.now(),
                    uid: 1,
                    gid: 1,
                    dev: 1,
                    isFile: () => false,
                    isDirectory: () => true,
                    isSymbolicLink: () => false,
                };
            }
        } catch {}
        throw new GitObjectNotFoundError(`Object not found: ${relativePath}`);
    }
    throw error;
}
```

**Verify**: `grep "fileExistsInR2" src/server/git-r2-backend.ts` → no matches

### Step 4: Fix readdir to use listAllR2Files

In `src/server/git-r2-backend.ts`, add `listAllR2Files` to the import from `#/lib/r2-operations`.

In the `readdir` method, replace:
```ts
const files = await listR2Files(r2Prefix, 1000);
```
with:
```ts
const files = await listAllR2Files(r2Prefix);
```

**Verify**: `pnpm check` → exit 0

### Step 5: Fix rmdir to use bulkDeleteFromR2

In `src/server/git-r2-backend.ts`, add `bulkDeleteFromR2` to the import from `#/lib/r2-operations`.

In the `rmdir` method, replace:
```ts
const files = await listR2Files(r2Prefix, 1000);
for (const file of files) {
    await deleteFromR2(file.key);
}
```
with:
```ts
const files = await listAllR2Files(r2Prefix);
if (files.length > 0) {
    await bulkDeleteFromR2(files.map((f) => f.key));
}
```

**Verify**: `pnpm check` → exit 0

### Step 6: Parallelize hydration downloads in git-repo-storage.ts

In `src/server/git-repo-storage.ts`, replace the sequential `writeRemoteFilesToDisk` function body with a batched-parallel approach (batch size 20 to avoid overwhelming R2 or Node's event loop):

```ts
async function writeRemoteFilesToDisk(
    repoPath: string,
    remoteFiles: Awaited<ReturnType<typeof listAllR2Files>>,
    sourcePrefix: string,
) {
    await fs.rm(repoPath, { recursive: true, force: true });
    await fs.mkdir(repoPath, { recursive: true });

    const BATCH_SIZE = 20;
    for (let i = 0; i < remoteFiles.length; i += BATCH_SIZE) {
        const batch = remoteFiles.slice(i, i + BATCH_SIZE);
        await Promise.all(
            batch.map(async (file) => {
                const relativePath = file.key.slice(sourcePrefix.length);
                const destination = path.join(repoPath, relativePath);
                await fs.mkdir(path.dirname(destination), { recursive: true });
                const { content } = await downloadFromR2(file.key);
                await fs.writeFile(destination, content);
            }),
        );
    }
}
```

**Verify**: `pnpm check` → exit 0

### Step 7: Add deleteRepositoryFromR2 to git-repo-storage.ts

In `src/server/git-repo-storage.ts`, add this new exported function after `syncRepositoryToR2`:

```ts
export async function deleteRepositoryFromR2(
    ownerKey: string,
    repoName: string,
    legacyOwnerKeys: string[] = [],
): Promise<void> {
    if (!isR2Configured()) {
        return;
    }

    const prefix = getRepoPrefix(ownerKey, repoName);
    const files = await listAllR2Files(prefix);
    if (files.length > 0) {
        await bulkDeleteFromR2(files.map((f) => f.key));
    }

    const legacyPrefixes = getLegacyGitPrefixes(legacyOwnerKeys, repoName);
    for (const legacyPrefix of legacyPrefixes) {
        const legacyFiles = await listAllR2Files(legacyPrefix);
        if (legacyFiles.length > 0) {
            await bulkDeleteFromR2(legacyFiles.map((f) => f.key));
        }
    }

    // Clear in-memory repo state so the key isn't served stale
    repoState.delete(getRepoKey(ownerKey, repoName));
}
```

**Verify**: `pnpm check` → exit 0

### Step 8: Call deleteRepositoryFromR2 in repositories.ts and remove dead comment

In `src/server/repositories.ts`:

1. Add `deleteRepositoryFromR2` to the import from `./git-repo-storage`:
```ts
import { deleteRepositoryFromR2, syncRepositoryToR2 } from "./git-repo-storage";
```

2. Delete the commented-out backup block (the `// Optionally backup...` comment and the 5 commented lines following it).

3. After the filesystem deletion loop, add the R2 cleanup call:
```ts
// Delete git repository from filesystem
await deleteRepo(ownerKey, repo.name);
for (const legacyOwnerKey of legacyOwnerKeys) {
    if (legacyOwnerKey !== ownerKey) {
        await deleteRepo(legacyOwnerKey, repo.name).catch(() => undefined);
    }
}

// Clean up R2 storage
await deleteRepositoryFromR2(ownerKey, repo.name, legacyOwnerKeys);

// Delete from database (cascades to related tables)
await db.delete(repositories).where(eq(repositories.id, data.id));
```

**Verify**: `grep "deleteRepositoryFromR2" src/server/repositories.ts` → 2 matches (import + call)

### Step 9: Run full tests

**Verify**: `pnpm test` → all tests pass (or same pass/fail count as before — report any new failures in NOTES)

## Test plan

No new tests are required for these changes — the fixes are behavioral improvements to existing APIs. The existing `git-storage-naming.test.ts` and `git-integration.test.ts` should still pass. If `pnpm test` fails on tests that passed before this plan, report them in NOTES.

## Done criteria

- [ ] `grep "fileExistsInR2" src/server/git-r2-backend.ts` → no matches
- [ ] `grep -c "listR2Files.*1000" src/server/git-r2-backend.ts` → 0 matches
- [ ] `grep "deleteRepositoryFromR2" src/server/repositories.ts` → 2 lines (import + call)
- [ ] `grep "deleteRepositoryFromR2" src/server/git-repo-storage.ts` → at least 1 line (definition)
- [ ] `grep "Optionally backup" src/server/repositories.ts` → no matches
- [ ] `pnpm check` exits 0
- [ ] `pnpm test` exits 0 (or same failures as before)
- [ ] Only in-scope files modified (`git diff --name-only`)

## STOP conditions

- Code at the locations in "Current state" doesn't match the excerpts (drift — file was changed since plan was written).
- `bulkDeleteFromR2` or `listAllR2Files` don't exist in `src/lib/r2-operations.ts` — check with `grep "export.*bulkDeleteFromR2\|export.*listAllR2Files" src/lib/r2-operations.ts`.
- `getLegacyGitPrefixes` is not exported from `src/server/git-storage-naming.ts` — check and report.
- `repoState` is not accessible from the scope where `deleteRepositoryFromR2` is added — check its declaration location and report.
- A step's `pnpm check` fails and can't be resolved within the in-scope files.

## Maintenance notes

- The S3Client singleton in r2.ts is module-scoped. In serverless environments where the module reloads per cold start this is effectively per-request. On long-running servers it's a true singleton.
- `BATCH_SIZE = 20` in `writeRemoteFilesToDisk` is a conservative choice. If hydration speed becomes a bottleneck for large repos, increase this; if R2 rate-limits occur, decrease it.
- `deleteRepositoryFromR2` is fire-and-let-it-fail in the error sense — it runs after filesystem deletion. If R2 cleanup fails (network error), the DB record is still deleted. A future improvement could record pending R2 cleanup in a DB table.
