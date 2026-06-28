# Plan 003: Dependency Cleanup and Dead Code Removal

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, reply with the report format from the
> dispatch prompt. Do NOT update plans/README.md — the reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat 05a7783..HEAD -- package.json src/server/git-http-iso.ts src/server/git-transaction.ts`
> If any of these files changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt, deps, dx
- **Planned at**: commit `05a7783`, 2026-06-27

## Why this matters

Six mechanical improvements with no logic risk:

1. **vitest < 3.2.6** has a critical advisory (arbitrary file read via vitest UI server). Upgrade to ≥ 3.2.6.
2. **12 `@tanstack/*` packages pinned to `"latest"`** — `pnpm install` on different days or CI agents may pull different versions, making builds non-reproducible. Pin to the versions actually installed.
3. **4 unused deps** (`@monaco-editor/react`, `diff`, `node-git-server`, `@types/nodegit`) — zero imports anywhere in `src/`; confirmed by grep. Removing them shrinks `node_modules` and eliminates the false impression they're in use.
4. **`git-http-iso.ts`** is a 218-line file of stub functions that are never imported; all real git HTTP handling is in `git-http-backend.ts`. Delete it.
5. **`activeTransactions` Map and its `setInterval`** in `git-transaction.ts` — the Map is defined, a cleanup interval sweeps it every 10 minutes, but the Map is never written to. The interval is dead.
6. **No `typecheck` script** — `pnpm check` runs biome (lint/format) but not TypeScript. Adding `"typecheck": "tsc --noEmit"` gives a single command to catch type errors.

## Current state

### `package.json` — deps and scripts

**DEPS-01**: `"vitest": "^3.0.5"` in devDependencies. pnpm audit reports CRITICAL advisory for vitest < 3.2.6.

**DEPS-02**: In dependencies block, these 12 packages are set to `"latest"`:
```json
"@tanstack/react-devtools": "latest",
"@tanstack/react-form": "latest",
"@tanstack/react-query": "latest",
"@tanstack/react-query-devtools": "latest",
"@tanstack/react-router": "latest",
"@tanstack/react-router-devtools": "latest",
"@tanstack/react-router-ssr-query": "latest",
"@tanstack/react-start": "latest",
"@tanstack/react-store": "latest",
"@tanstack/store": "latest",
"@tanstack/devtools-event-client": "latest",
"@tanstack/devtools-vite": "latest"
```

**DEPS-03**: These packages appear in package.json but have zero imports in `src/`:
- `"@monaco-editor/react": "^4.7.0"` (in dependencies)
- `"diff": "^8.0.3"` (in dependencies)
- `"node-git-server": "^1.0.0"` (in dependencies)
- `"@types/nodegit": "^0.28.11"` (in devDependencies)

**DX-01**: The `"scripts"` block contains `"lint"`, `"check"`, `"test"`, `"build"` etc., but no `"typecheck"` entry.

### `src/server/git-http-iso.ts`

Role: intended isomorphic-git HTTP backend (never completed). Has 5 exported functions with stub bodies:
```ts
export async function handleGitUploadPack(...) {
    throw new Error("handleGitUploadPack not fully implemented yet");
}
// ...etc
```
**Confirmed zero imports** — `grep -r "git-http-iso" src/` returns no matches.

### `src/server/git-transaction.ts` (lines 234–251)

Role: GitTransaction class and withTransaction helper (used by other modules).

**ARCH-02 — dead Map and setInterval at lines 234–251:**
```ts
// ponytail: plain Map instead of TransactionRegistry class
const activeTransactions = new Map<string, { txn: GitTransaction; createdAt: number }>();

if (typeof setInterval !== "undefined") {
    setInterval(async () => {
        const threshold = Date.now() - 3600000;
        for (const [id, entry] of activeTransactions.entries()) {
            if (entry.createdAt < threshold) {
                activeTransactions.delete(id);
                if (!entry.txn.isCommitted() && !entry.txn.isRolledBack()) {
                    await entry.txn.rollback().catch((e) =>
                        console.error(`Failed to rollback abandoned transaction ${id}:`, e),
                    );
                }
            }
        }
    }, 600000);
}
```
`activeTransactions` is declared here and referenced only in this block. `withTransaction` (above this block) creates transactions locally and never registers them. The cleanup interval runs every 10 minutes doing nothing.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install deps | `pnpm install` | exit 0 |
| Lint | `pnpm check` | exit 0 |
| Tests | `pnpm test` | exit 0 |
| Typecheck | `pnpm typecheck` | exit 0 (after DX-01 is done) |

## Scope

**In scope**:
- `package.json`
- `pnpm-lock.yaml` (auto-updated by `pnpm install`)
- `src/server/git-http-iso.ts` (delete)
- `src/server/git-transaction.ts` (delete dead block)

**Out of scope** (do NOT touch):
- Any other source file
- `src/server/git-transaction.ts` lines above 234 (the GitTransaction class and withTransaction function are used; only delete the dead Map block at lines 234–251)

## Git workflow

- Branch: `advisor/003-cleanup-and-deps`
- Commit per step: `chore: upgrade vitest to 3.2.6`, `chore: pin @tanstack versions`, etc.
- Do NOT push or open a PR.

## Steps

### Step 1: Confirm which packages are actually unused

Run each grep before removing anything:

```bash
grep -r "@monaco-editor" src/          # expect: no output
grep -r "from ['\"]diff['\"]" src/     # expect: no output  
grep -r "node-git-server" src/         # expect: no output
grep -r "nodegit" src/                 # expect: no output
grep -r "git-http-iso" src/            # expect: no output
```

If any grep returns matches, STOP and report which package is actually used.

### Step 2: Remove unused dependencies

In `package.json`, remove these entries entirely:
- `"@monaco-editor/react": "^4.7.0"` from `dependencies`
- `"diff": "^8.0.3"` from `dependencies`
- `"node-git-server": "^1.0.0"` from `dependencies`
- `"@types/nodegit": "^0.28.11"` from `devDependencies`

**Verify**: `grep -E "@monaco-editor|\"diff\"|node-git-server|@types/nodegit" package.json` → no matches

### Step 3: Upgrade vitest

In `package.json`, change:
```json
"vitest": "^3.0.5"
```
to:
```json
"vitest": "^3.2.6"
```

**Verify**: `grep "vitest" package.json` → shows `^3.2.6`

### Step 4: Pin @tanstack packages to current installed versions

Run `pnpm list --depth=0 2>/dev/null | grep "@tanstack"` to see the currently installed versions.

For each of the 12 packages listed in "Current state", replace `"latest"` with `"^<currently-installed-version>"`. For example if `@tanstack/react-router` is installed at `1.132.0`, write `"^1.132.0"`. Use the major+minor version as the floor.

Note: `@tanstack/router-plugin` is already pinned to `"^1.132.0"` — use that as a reference point for the router-related packages.

**Verify**: `grep '"latest"' package.json` → no matches

### Step 5: Add typecheck script

In `package.json`, in the `"scripts"` block, add:
```json
"typecheck": "tsc --noEmit"
```

**Verify**: `grep "typecheck" package.json` → shows the new entry

### Step 6: Install and verify

```bash
pnpm install
```

**Verify**: `pnpm install` exits 0 and the lockfile is updated.

Then: `pnpm test` → all tests pass

Then: `pnpm check` → exit 0

Then: `pnpm typecheck` → if it exits non-zero, report the type errors in NOTES but do NOT fix them (they're pre-existing — fixing them is out of scope).

### Step 7: Delete git-http-iso.ts

```bash
rm src/server/git-http-iso.ts
```

**Verify**: `ls src/server/git-http-iso.ts 2>&1` → `No such file or directory`

Run: `pnpm check` → exit 0 (biome won't error on a deleted file)

### Step 8: Delete dead Map and setInterval in git-transaction.ts

In `src/server/git-transaction.ts`, delete the block from the `// ponytail: plain Map...` comment through the closing `}` of the `if (typeof setInterval ...` block (lines 234–251 approximately). This is the very end of the file.

After deletion, the file should end with the closing `}` of `withTransaction`.

**Verify**: `grep "activeTransactions\|setInterval" src/server/git-transaction.ts` → no matches

**Verify**: `pnpm check` → exit 0

### Step 9: Final check

**Verify**: `pnpm test` → all tests pass (same results as before step 1)

## Test plan

No new tests. These are deletions and version bumps. The full test suite running without new failures is the verification.

## Done criteria

- [ ] `grep '"latest"' package.json` → no matches
- [ ] `grep "vitest" package.json` shows `^3.2.6` or higher
- [ ] `grep -E "@monaco-editor|\"diff\"|node-git-server|@types/nodegit" package.json` → no matches
- [ ] `grep "typecheck" package.json` → 1 match
- [ ] `ls src/server/git-http-iso.ts` → file does not exist
- [ ] `grep "activeTransactions\|setInterval" src/server/git-transaction.ts` → no matches
- [ ] `pnpm check` exits 0
- [ ] `pnpm test` exits 0
- [ ] Only in-scope files modified (`git diff --name-only`)

## STOP conditions

- Any of the Step 1 greps return matches (a "unused" package is actually imported).
- `pnpm install` fails after version changes.
- `pnpm test` has new failures that weren't present before this plan.
- `pnpm typecheck` fails with errors in files that are in scope of this plan (i.e., errors the executor introduced). Pre-existing errors in other files are not a STOP condition — report them in NOTES.
- Lines 234–251 in `git-transaction.ts` don't match the excerpt (the `activeTransactions` Map pattern).

## Maintenance notes

- After pinning @tanstack versions, update them together intentionally (e.g., `pnpm up "@tanstack/*"`) to avoid version skew between the router, query, and store packages.
- `pnpm typecheck` may reveal pre-existing type errors on first run. Those should be tracked separately — they are not regressions introduced by this plan.
