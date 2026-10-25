---
title: "Authentication and access control"
description: "Better Auth sessions, git-over-HTTPS tokens and the single RepositoryAccess computation."
---

Two separate authentication surfaces exist in this app, plus one unified
access-control model that both funnel into.

1. **Web session auth** — Better Auth, cookie-based, for the browser UI.
2. **Git-over-HTTPS auth** — personal access tokens over Basic Auth for `git
   clone`/`fetch`/`push`.
3. **`RepositoryAccess`** — the single computation (`apps/web/src/server/repo-access.ts`)
   both funnel into.

## Web session auth (Better Auth)

Configured in `apps/web/src/lib/auth.ts`:

- Email/password auth, with **required email verification** — a user can't
  log in until they've clicked the verification link (sent via Resend, see
  `apps/web/src/lib/email.ts`).
- Sessions last 7 days (`expiresIn`), refreshed if used within the last day
  (`updateAge`), with a 5-minute cookie cache to avoid re-validating on every
  request.
- Password reset and email verification both send through Resend, wired into
  Better Auth's `sendResetPassword`/`sendVerificationEmail` hooks.
- The `username` plugin adds a username (3–30 chars, `STORAGE_NAME_RE`).
  It's required at sign-up and can never change: it appears in repo URLs and
  is the first segment of every storage key (see
  [git-storage.md](/docs/internals/git-storage)). `databaseHooks` enforce both.
- Cookies: secure, `pushstack`-prefixed, not shared cross-subdomain.

**`BETTER_AUTH_SECRET` must never reach the browser bundle.** `apps/web/src/lib/auth.ts`
throws at import time if it's unset, which means importing it anywhere that
gets bundled client-side crashes the app in the browser instead of the server.
This is why `apps/web/src/lib/auth-session.ts`'s `getSession` server function uses a
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

`apps/web/src/server/session.ts` wraps this into the two functions almost everything
else in `apps/web/src/server/` calls:

- `getCurrentUserOptional()` — returns the session user, or `null`.
- `getCurrentUser()` — same, but throws `"Unauthorized"` if there's no session.
  Use this in any handler that requires a logged-in user; use the optional
  variant for anything that has a meaningful anonymous/public behavior (repo
  reads, issue lists, etc.).

## Git-over-HTTPS auth (`git-auth.ts`)

A git client can't hold a browser session, so `authorizeGitRequest(request,
repo, needsWrite)` authenticates every git request on its own, with
**personal access tokens only**:

- The token (`pst_…`) goes in the Basic-auth password or username slot.
  It's hashed with SHA-256 and looked up by hash; the raw token is never
  stored. Plain SHA-256 is right for high-entropy random tokens.
- No passwords: a password over git can't be scoped or revoked on its own,
  and verifying one per request would need its own rate limiter.
- No cookies: a cookie-authenticated git endpoint is a CSRF target.
- No credentials → anonymous: reads of public repos succeed; anything else
  gets `401` with `WWW-Authenticate`, so the client prompts.
- Bad or expired token → `401`. A valid token without the needed scope
  (`repo:read` / `repo:write`, write implies read) or role → `403`.

Credentials are never logged.

## Device flow (`gh auth login`)

`gh auth login` without `--with-token` runs GitHub's OAuth device flow, which
issues a personal access token, so the result is one more `pst_` token with
the same storage, revocation and scopes as any other:

1. `POST /login/device/code` (`routes/login.device.code.ts`) takes `client_id`
   and a GitHub `scope` (space or comma separated) and returns `device_code`,
   `user_code` (`XXXX-XXXX`, consonants only), `verification_uri`
   (`<origin>/login/device`), `expires_in` (900) and `interval` (5). The
   device code is stored only as its SHA-256 (`device_codes.device_code_hash`).
2. The user enters the user code on `/login/device` (`routes/login.device.tsx`)
   while signed in, reads the scopes it asks for, and approves or denies. The
   decision is one conditional `UPDATE` on a pending, unexpired row.
3. `POST /login/oauth/access_token` (`routes/login.oauth.access_token.ts`) is
   the poll. Its outcomes are GitHub's codes, carried as a 200 response with an
   `error` field: `authorization_pending`, `slow_down` (the interval grows by 5
   seconds and the new value is returned), `expired_token`, `access_denied`,
   plus `incorrect_device_code` (unknown or already used),
   `incorrect_client_credentials` (the client id does not match the code) and
   `unsupported_grant_type`. Approval turns into a token exactly once: the poll
   that flips `consumed_at` inserts the token; any other poll gets
   `incorrect_device_code`.

Scopes map by name (`tokenScopesFromGitHub` in `lib/device-flow.ts`):
`repo` becomes `repo:write`; other GitHub names are dropped because nothing here
grants them. The token response echoes `repo` in `scope`, and the REST API's
`X-OAuth-Scopes` header is the same name as for any token.

Responses are form-encoded unless the client sends `Accept: application/json`,
which gh does. Codes older than their 900 seconds are deleted when the next
code is created, so unauthenticated starts cannot grow the table.

Limits (`rate-limit.ts`, the same counters as `/api/v3`, knobs in `config.ts`):

- Starts (`/login/device/code`) are counted per client IP before the body is
  read (`RATE_LIMIT_DEVICE_CODE`, 50 per window). Over the limit: `429` with
  `Retry-After`.
- Every user code typed on the approval page (a lookup or a decision) is
  counted per signed-in user and per client IP (`RATE_LIMIT_DEVICE_USER_CODE_USER`,
  20; `RATE_LIMIT_DEVICE_USER_CODE_IP`, 60). Over either limit the call answers
  `429` with `Retry-After`. The approval page's server functions are plain
  text, not GitHub's API error body. This bucket fails **closed**: if the
  counter cannot be read, the attempt is refused with a 60 second retry, since
  brute force is the threat and the page needs the database anyway. Starts
  (above) fail **open** instead, because a start guesses nothing.
- Polls are gated by one conditional `UPDATE` (a poll is admitted only when the
  previous one is at least `interval` old). A too-soon poll is `slow_down`, and
  its interval step is computed in SQL from the stored interval, so concurrent
  polls each count.
- Bodies on the device endpoints are capped at `MAX_DEVICE_REQUEST_BYTES`
  (`lib/limits.ts`), declared or streamed; larger bodies get `413`.

## OAuth apps and the authorization-code flow

A user registers an app at `/settings/developers` (`routes/settings_.developers.tsx`,
`server/oauth-apps.ts`). The app gets a `client_id` (`Iv1.` plus 16 hex) and a
40-hex client secret. The secret is shown once; `oauth_apps.client_secret_hash`
keeps only its SHA-256, and the app's one `callback_url` is the only redirect a
flow may use. Callback URLs are absolute `https` URLs (`http` for loopback
hosts only), with no fragment and no credentials (`isValidCallbackUrl`).

1. The app sends the user to `GET /login/oauth/authorize?client_id&redirect_uri
   &scope&state` (`routes/login.oauth.authorize.tsx`). A signed-out user goes to
   `/login?redirect=…`, and login follows only a path on this site
   (`safeInternalPath`). `redirect_uri` must equal the registered callback
   exactly. An unknown client, or any other URI, is an error page, and the user
   is never redirected there.
2. The user approves or cancels. The decision is a server function POST that
   must carry the site's own `Origin` (`isSameOriginRequest`), so a cross-site
   page cannot submit it. The request is checked again on the server, and the
   redirect is built from the registered callback (`authorizationRedirect`),
   with `code` (approve) or `error=access_denied` (cancel) and `state` echoed.
3. `POST /login/oauth/access_token` with `grant_type=authorization_code`,
   `client_id`, `client_secret`, `code` and `redirect_uri` (optional, but when
   sent it must match) exchanges the code. The secret is compared in constant
   time against its hash, the code's client and URI are checked, and then the
   code is consumed by one conditional `UPDATE`, so a replay or a concurrent
   second exchange gets `bad_verification_code`. Codes live 600 seconds and
   store only their SHA-256 (`oauth_codes`). A wrong secret or URI does not
   spend the code. Each exchange is counted per client IP
   (`RATE_LIMIT_OAUTH_TOKEN_IP`, 300) and per client id
   (`RATE_LIMIT_OAUTH_TOKEN_CLIENT`, 1000), before the secret is compared.
   Over either limit, or when the counter cannot be read, the response is `429`
   with `Retry-After` (fail closed). Expired codes are swept when a new one is
   issued. Success is a `pst_` token with `oauth_app_id` set, scopes as
   for any token, and the GitHub-style `scope` echo.

Tokens an app holds are not listed with personal access tokens. They appear at
`/settings/applications` (`routes/settings_.applications.tsx`) with their scopes
and date, and revoking an app deletes them. Deleting an app cascades to its
tokens and codes. PKCE is not required.

**Not yet**: the device flow still accepts any non-empty `client_id`, because
`gh` sends a fixed id that is not a registered app. Whether that id must be
registered is an open question on #215.

## `RepositoryAccess` — the single access-control computation

Every repository has:

- a **visibility**: `public` or `private`
- an **owner** (the creating user)
- zero or more **collaborators**, each with a role: `read`, `write`, or `admin`

`apps/web/src/server/repo-access.ts` collapses all of that into one `RepositoryAccess`
object per `(repoId, userId)` pair:

```ts
interface RepositoryAccess {
  repository: ...;
  role: "anonymous" | "read" | "write" | "admin" | "owner";
  canRead: boolean;
  canWrite: boolean;
  canModerate: boolean;
  canMergePullRequest: boolean;
}
```

`buildAccess` picks the role (owner, else the collaborator role, else
anonymous) and reads its flags from one `PERMISSIONS` table; anonymous can
read only public repositories.

**This is the only place in the codebase that should ever compute this.**
Every server function that touches a repository calls through one of:

- `getRepositoryAccess(repoId, userId)` — the general case.
- `getAccessForRepository(repository, userId)` — when the caller already has
  the repository row in hand (e.g. from `db.query.issues.findFirst({ with: {
  repository: true } })`) — skips a redundant repo-row fetch.
- `canReadRepo` / `canWriteRepo` / `canModerateRepo` / `canMergePullRequest` —
  boolean convenience wrappers.
- `requireWriteAccess(repoId, userId)` — throws instead of returning.
- `readWithAccess(label, repoId, fn)` — the read-handler shape: perf
  context, optional session, read check (a private repo answers like a
  missing one), then `fn(repo)`.
- `writeWithAccess(repoId, fn(repo, user))` — the same for writes,
  requiring a session and write access.
- `requireOwner(repoId, userId, message)` — owner-only actions (rename,
  delete, collaborators, repack).

### Why there's a short-TTL cache in front of this

A single tree-page load fans out to `getBranches`/`getTreePageData`/`getLastCommits`/`getCommits`
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
