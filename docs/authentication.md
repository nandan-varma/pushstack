# Authentication & Access Control

Two separate authentication surfaces exist in this app, plus one unified
access-control model that both funnel into.

1. **Web session auth** — Better Auth, cookie-based, for the browser UI.
2. **Git-over-HTTP auth** — Basic Auth (PAT or username/password) for `git
   clone`/`fetch`/`push`, since a git client can't do cookie-based sessions.
3. **`RepositoryAccess`** — the single computation (`src/server/repo-access.ts`)
   that both of the above ultimately check against to decide what a given user
   can actually do with a given repository.

## Web session auth (Better Auth)

Configured in `src/lib/auth.ts`:

- Email/password auth, with **required email verification** — a user can't
  log in until they've clicked the verification link (sent via Resend, see
  `src/lib/email.ts`).
- Sessions last 7 days (`expiresIn`), refreshed if used within the last day
  (`updateAge`), with a 5-minute cookie cache to avoid re-validating on every
  request.
- Password reset and email verification both send through Resend, wired into
  Better Auth's `sendResetPassword`/`sendVerificationEmail` hooks.
- `username` plugin adds a username field (3–30 chars) alongside email —
  usernames are what shows up in repo URLs and storage keys (see
  [git-storage.md](./git-storage.md)'s `getStorageOwnerKey`).
- Cookies: secure, `pushstack`-prefixed, not shared cross-subdomain.

**`BETTER_AUTH_SECRET` must never reach the browser bundle.** `src/lib/auth.ts`
throws at import time if it's unset, which means importing it anywhere that
gets bundled client-side crashes the app in the browser instead of the server.
This is why `src/lib/auth-session.ts`'s `getSession` server function uses a
**dynamic** `import("@/lib/auth")` inside the handler body rather than a
top-level import: TanStack Start's client-side RPC stub for a server function
keeps the module's top-level imports (it can't prove they're side-effect-free
to drop, even though the handler body itself gets swapped out client-side), so
a static top-level import of `lib/auth.ts` would still evaluate it in the
browser and throw. If you ever need the real `auth` instance inside a
`createServerFn` handler, follow this same dynamic-import pattern rather than
importing it at module scope.

`getSession()` also single-flights concurrent calls for the same request
cookie (`inFlight` map in `auth-session.ts`) — a single page load commonly
fires several server functions in parallel that each independently ask "who's
logged in," and without this each one would separately hit Better Auth's own
session validation for the identical cookie.

`src/server/session.ts` wraps this into the two functions almost everything
else in `src/server/` calls:

- `getCurrentUserOptional()` — returns the session user, or `null`.
- `getCurrentUser()` — same, but throws `"Unauthorized"` if there's no session.
  Use this in any handler that requires a logged-in user; use the optional
  variant for anything that has a meaningful anonymous/public behavior (repo
  reads, issue lists, etc.).

## Git-over-HTTPS auth (`git-auth.ts`)

A `git clone`/`push` request can't participate in a browser session, so every
git HTTP request is authenticated independently via `authenticateGitRequest`,
which tries, in order:

1. **Better Auth session cookie** — if the request has a `cookie` header at
   all (a real git CLI request never does, so this is skipped entirely for
   CLI traffic, avoiding a wasted session-validation call).
2. **Personal Access Token** — HTTP Basic Auth where the password (or,
   for compatibility, the username) starts with `ghp_`. The token is hashed
   with SHA-256 and looked up by that hash (`tokens.tokenHash`) — the raw
   token is never stored. Plain SHA-256 (no bcrypt/argon2) is intentional and
   correct here: PATs are high-entropy random strings, not
   low-entropy human passwords, so they aren't vulnerable to the rainbow-table
   attacks password hashing guards against.
3. **Username/password** — falls back to verifying against the `account`
   table's stored credential hash via Better Auth's own `verifyPassword`.

Token scopes (`repo:read`/`repo:write`, or none = unrestricted) are checked
against the requested operation via `hasRequiredTokenScope` — a token scoped
to `repo:write` implicitly satisfies a `repo:read` requirement.

None of these three paths ever log the credential itself — only generic
"auth failed" messages, so nothing sensitive ends up in server logs.

## `RepositoryAccess` — the single access-control computation

Every repository has:

- a **visibility**: `public` or `private`
- an **owner** (the creating user)
- zero or more **collaborators**, each with a role: `read`, `write`, or `admin`

`src/server/repo-access.ts` collapses all of that into one `RepositoryAccess`
object per `(repoId, userId)` pair:

```ts
interface RepositoryAccess {
  repository: ...;
  collaboratorRole: "read" | "write" | "admin" | null;
  role: "anonymous" | "read" | "write" | "admin" | "owner";
  canRead: boolean;
  canWrite: boolean;
  canModerate: boolean;
  canMergePullRequest: boolean;
}
```

Resolution order (`buildAccess`): public + anonymous → read-only; private +
anonymous → no access; owner → full access; then falls through to the
collaborator role (`admin`/`write`/`read` collaborators get progressively
fewer permissions); anything else falls back to "can read only if public."

**This is the only place in the codebase that should ever compute this.**
Every server function that touches a repository calls through one of:

- `getRepositoryAccess(repoId, userId)` — the general case.
- `getAccessForRepository(repository, userId)` — when the caller already has
  the repository row in hand (e.g. from `db.query.issues.findFirst({ with: {
  repository: true } })`) — skips a redundant repo-row fetch.
- `canReadRepo` / `canWriteRepo` / `canModerateRepo` / `canMergePullRequest` —
  boolean convenience wrappers.
- `requireReadAccess(repoId, userId)` / `requireWriteAccess(repoId, userId)` —
  throw instead of returning a boolean; use these instead of hand-rolling a
  fetch-then-check block in a new handler.
- `getRepoWithReadAccess` / `getRepoWithWriteAccess` — fetch-and-check in one
  call, returning the repository row on success.

**These are all broader-than-owner checks** — any write collaborator passes
`requireWriteAccess`. Owner-only actions (deleting a repo, managing
collaborators) still need an explicit `repo.ownerId !== user.id` check on top;
there's no single helper for "owner only" because so few actions need it.

### Why there's a short-TTL cache in front of this

A single tree-page load fans out to `getBranches`/`listFiles`/`getLastCommits`/`getCommits`
in parallel, and each of them independently needs to answer "does this user
have access to this repo" — same `(repoId, userId)`, computed redundantly 3-4x
concurrently, on top of whatever `getRepositoryByName` already resolved just
before them. `repo-access.ts` caches the resolved `RepositoryAccess` for 4
seconds and coalesces concurrent in-flight resolutions for the same key, so
that whole burst shares one DB round trip instead of each firing its own. The
TTL is intentionally short — this is a performance cache, not a correctness
cache. A revoked collaborator or a visibility flip should take effect within a
few seconds, not linger for a request's lifetime the way the long-lived git
object cache does.
