# Plan 001: Security Hardening

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, reply with the report format from the
> dispatch prompt. Do NOT update plans/README.md — the reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat 05a7783..HEAD -- src/server/git-auth.ts src/server/git-errors.ts src/lib/git-url-parser.ts`
> If any of these files changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `05a7783`, 2026-06-27

## Why this matters

Five security issues in the git auth and error-handling path. Three are in `git-auth.ts`: a global auth-disable bypass that grants full access to all repos if an env var is set, a Basic Auth parser that silently truncates passwords containing colons (breaking legitimate auth for users with colon-containing passwords), and 13 lines of orphaned dead code referencing unimported symbols. `git-errors.ts` returns raw `error.message` in 500 responses, which can leak DB connection strings or internal paths to clients. `git-url-parser.ts` exposes an `isValidGitPath` function but never calls it, letting malformed owner/repo strings reach the database and storage layers.

## Current state

### `src/server/git-auth.ts`

Role: HTTP Basic Auth + session auth + per-request git authorization.

**SEC-02 — auth bypass (lines 40–41 and 232–253):**
```ts
// lines 40-41
function isGitAuthDisabled(): boolean {
    return process.env.GIT_DISABLE_AUTH === "true";
}

// lines 232-253 (inside authenticateGitRequest)
if (isGitAuthDisabled()) {
    const credentials = parseBasicAuth(request.headers.get("authorization"));
    const username = credentials?.username || owner || "git-test-user";
    return {
        userId: repo.ownerId,
        username,
        user: { id: repo.ownerId, username, email: `${username}@local.test`, name: username },
        repo: { id: repo.id, ownerId: repo.ownerId, name: repo.name, visibility: repo.visibility as "public" | "private" },
        canRead: true,
        canWrite: true,
    };
}
```
If `GIT_DISABLE_AUTH=true`, every request gets canRead+canWrite on every repo, no authentication needed.

**SEC-01 — password truncation (line 84):**
```ts
const [username, password] = credentials.split(":");
```
`"user:pass:word".split(":")` → `["user", "pass", "word"]`. Destructuring takes only first two elements; the rest of the password is silently dropped.

**COR-01 — dead code block (lines 196–208):**
```ts
/**

    // Check if user is collaborator with write access
    const collab = await db.query.repositoryCollaborators.findFirst({
        where: and(
            eq(repositoryCollaborators.repoId, repoId),
            eq(repositoryCollaborators.userId, userId),
        ),
    });

    // Check role (assuming 'write' or 'admin' role)
    return collab?.role === "write" || collab?.role === "admin";
}
```
Orphaned block between `authenticateToken` and `authenticateGitRequest`. `repositoryCollaborators` and `and` are not imported in this file.

### `src/server/git-errors.ts`

Role: custom error classes + HTTP response formatter.

**ERR-01 — error.message leak (lines 188–196):**
```ts
if (error instanceof Error) {
    return {
        status: 500,
        body: {
            error: "InternalServerError",
            message: error.message,   // ← leaks DB strings, stack info, internal paths
            retryable: true,
        },
    };
}
```

### `src/lib/git-url-parser.ts`

Role: parses git smart HTTP URLs into `{ owner, repo, service, isInfoRefs }`.

**VAL-01 — isValidGitPath exists but is never called (lines 36–40 vs 77–81):**
```ts
// What happens (no validation):
const owner = parts[0];           // line 36
const repoWithExt = parts[1];     // line 37
const repo = repoWithExt.replace(/\.git$/, "");  // line 40

// What exists but is unused (lines 77-81):
export function isValidGitPath(path: string): boolean {
    const parts = path.split("/").filter(Boolean);
    return parts.length >= 2 && parts.every((p) => /^[a-zA-Z0-9_-]+$/.test(p));
}
```

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Lint | `pnpm check` | exit 0 |
| Tests | `pnpm test -- src/server/__tests__/git-auth-helpers.test.ts` | all pass |
| All tests | `pnpm test` | exit 0 (or same count pass/fail as before this plan) |

Note: `pnpm typecheck` does not yet exist as a script. Skip it.

## Scope

**In scope** (the only files you should modify):
- `src/server/git-auth.ts`
- `src/server/git-errors.ts`
- `src/lib/git-url-parser.ts`

**Out of scope** (do NOT touch, even though they look related):
- `src/server/repo-access.ts` — permission logic is correct; a separate plan handles N+1
- `src/server/repositories.ts` — separate plan
- Any test file — tests that check auth behavior pass today; don't change them

## Git workflow

- Branch: `advisor/001-security-hardening`
- Commit per step; messages like: `fix: remove GIT_DISABLE_AUTH production bypass`
- Do NOT push or open a PR.

## Steps

### Step 1: Remove GIT_DISABLE_AUTH bypass

In `src/server/git-auth.ts`, delete the `isGitAuthDisabled` function (lines 40–41) and the `if (isGitAuthDisabled())` block (lines 232–253).

The function and its caller are adjacent to `parseBasicAuth` and `authenticateGitRequest` respectively. After deletion, `authenticateGitRequest` should proceed directly to `const user = await authenticateUser(request);` (no bypass block).

**Verify**: `grep -n "GIT_DISABLE_AUTH\|isGitAuthDisabled" src/server/git-auth.ts` → no output

### Step 2: Fix Basic Auth password parsing

In `src/server/git-auth.ts`, replace the destructuring in `parseBasicAuth`:

Old (line 84):
```ts
const [username, password] = credentials.split(":");
```

New:
```ts
const colonIdx = credentials.indexOf(":");
if (colonIdx === -1) return null;
const username = credentials.slice(0, colonIdx);
const password = credentials.slice(colonIdx + 1);
```

**Verify**: `pnpm check` → exit 0

### Step 3: Delete orphaned dead code block

In `src/server/git-auth.ts`, delete lines 196–208 (the block starting with `/**` and ending with the lone `}`). These lines are between the closing `}` of `authenticateToken` and the JSDoc comment for `authenticateGitRequest`.

After deletion there should be a blank line between `authenticateToken`'s closing `}` and the `/**` JSDoc for `authenticateGitRequest`.

**Verify**: `pnpm check` → exit 0

### Step 4: Remove error.message leak

In `src/server/git-errors.ts`, change the `message` field in the generic `Error` handler:

Old (line 191):
```ts
message: error.message,
```

New:
```ts
message: "An internal error occurred",
```

Leave the `UnknownError` branch below it unchanged.

**Verify**: `grep "error\.message" src/server/git-errors.ts` → no matches

### Step 5: Add URL validation in parseGitUrl

In `src/lib/git-url-parser.ts`, after extracting `owner` and `repo` (lines 36–40), add validation:

```ts
// After: const repo = repoWithExt.replace(/\.git$/, "");
// Add:
if (!/^[a-zA-Z0-9_-]+$/.test(owner) || !/^[a-zA-Z0-9_-]+$/.test(repo)) {
    return null;
}
```

This inlines the regex from the existing `isValidGitPath` at the parse boundary.

**Verify**: `pnpm check` → exit 0

### Step 6: Run full tests

**Verify**: `pnpm test -- src/server/__tests__/git-auth-helpers.test.ts` → passes

## Test plan

- No new tests are required for these changes. Existing `git-auth-helpers.test.ts` exercises `createAuthChallenge` and `getMaxGitRequestBytes`; the auth bypass removal and password parser fix don't have dedicated tests in that file but are covered by the integration tests.
- If `pnpm test` shows newly failing tests unrelated to these files, report them in NOTES but do not fix them — they were pre-existing failures.

## Done criteria

- [ ] `grep "GIT_DISABLE_AUTH\|isGitAuthDisabled" src/server/git-auth.ts` → no output
- [ ] `grep "error\.message" src/server/git-errors.ts` → no output
- [ ] `pnpm check` exits 0
- [ ] `pnpm test -- src/server/__tests__/git-auth-helpers.test.ts` passes
- [ ] Only files in the in-scope list were modified (`git diff --name-only`)

## STOP conditions

- The code at the locations in "Current state" doesn't match the excerpts (drift).
- Any step's `pnpm check` fails and you can't resolve it without touching out-of-scope files.
- You find that any test file references `GIT_DISABLE_AUTH` — report which file.
- The dead code block at lines 196–208 has a closing `*/` that you cannot identify — report the exact line range.

## Maintenance notes

- If integration tests are added that need to bypass auth, use a test-specific mock (e.g. mock `authenticateUser` to return a fixed user) rather than re-adding an env-var bypass.
- If the `isValidGitPath` export is no longer needed by external callers after this plan, it can be deleted in a follow-up; leave it for now.
