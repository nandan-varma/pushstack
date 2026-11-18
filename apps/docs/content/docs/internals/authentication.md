---
title: "Authentication and access control"
description: "Better Auth sessions, git-over-HTTPS tokens and the single RepositoryAccess computation."
---

Three surfaces: Better Auth cookie sessions for the browser, personal access tokens over Basic Auth for git, and one `RepositoryAccess` computation in `apps/web/src/server/repo-access.ts` that both funnel into.

## Web sessions (Better Auth)

`apps/web/src/lib/auth.ts` configures email/password with required email verification, 7-day sessions, and a 5-minute cookie cache so parallel server functions do not each re-validate the session. Cookies are secure, `pushstack`-prefixed and not shared cross-subdomain. Mail goes through Resend.

The `username` plugin supplies the username that appears in repository URLs and is the first storage-key segment, so `databaseHooks` require it at sign-up and forbid changing it (see [security.md](/docs/internals/security)).

**`BETTER_AUTH_SECRET` must never reach the browser bundle.** `auth.ts` throws at import time if it is unset, so a client-bundled import crashes the app in the browser instead of the server. That is why `auth-session.ts`'s `getSession` uses a **dynamic** `import("@/lib/auth")` inside the handler: TanStack Start's client RPC stub keeps a server function's top-level imports, so a static one would still evaluate `auth.ts` in the browser. Follow the same pattern in any `createServerFn` that needs the real `auth` instance.

`getSession()` also single-flights calls for the same request cookie, because one page load fires several server functions that each ask who is logged in. `server/session.ts` wraps it as `getCurrentUserOptional()` (session user or `null`, for handlers with a meaningful anonymous behavior) and `getCurrentUser()` (throws `"Unauthorized"`, for handlers that need a user).

## Git over HTTPS

A git client cannot hold a browser session, so `authorizeGitRequest(request, repo, needsWrite)` authenticates each request on its own with personal access tokens only:

- The `pst_…` token goes in the Basic-auth password or username slot, is hashed with SHA-256 and looked up by hash; the raw token is never stored.
- No passwords (not scopeable or revocable on their own, and verifying one per request needs its own limiter) and no cookies (a CSRF target).
- No credentials means anonymous: public reads succeed, anything else gets `401` with `WWW-Authenticate` so the client prompts. A bad or expired token is `401`; a valid token missing the scope (`repo:read` / `repo:write`, write implies read) or role is `403`.

Credentials are never logged.

## Device flow (`gh auth login`)

`gh auth login` without `--with-token` runs GitHub's device flow and yields one more `pst_` token with the same storage, revocation and scopes. `POST /login/device/code` returns a device code (stored only as its SHA-256), a consonants-only user code, `verification_uri`, `expires_in` and `interval`; the user approves on `/login/device` while signed in; `POST /login/oauth/access_token` is the poll. Approval turns into a token exactly once: the poll that flips `consumed_at` inserts it, and any other poll gets `incorrect_device_code`. Poll outcomes are GitHub's codes carried as a 200 with an `error` field, and a too-soon poll is `slow_down`. Responses are form-encoded unless the client sends `Accept: application/json` (gh does). Expired codes are swept when the next code is created, so unauthenticated starts cannot grow the table.

Scopes map by name (`tokenScopesFromGitHub` in `lib/device-flow.ts`): `repo` becomes `repo:write`; other GitHub names are dropped because nothing here grants them, and the REST `X-OAuth-Scopes` header echoes the same name as for any token.

Limits use the `/api/v3` counters (`rate-limit.ts`, knobs in `config.ts`). Starts are counted per client IP before the body is read and fail **open**, because a start guesses nothing. User-code attempts are counted per signed-in user and per client IP and fail **closed** with a 60-second retry, since brute force is the threat and the page needs the database anyway. Polls are gated by one conditional `UPDATE` admitting a poll only when the previous one is at least `interval` old, with the interval step computed in SQL so concurrent polls each count. Device bodies are capped at `MAX_DEVICE_REQUEST_BYTES` declared or streamed.

## OAuth apps and the authorization code

An app registered at `/settings/developers` gets a `client_id` and a 40-hex secret shown once; only the secret's SHA-256 is kept. Its one `callback_url` is the only redirect a flow may use and must be an absolute `https` URL (`http` for loopback), with no fragment or credentials (`isValidCallbackUrl`).

1. `GET /login/oauth/authorize` requires `redirect_uri` to equal the registered callback exactly; an unknown client or any other URI is an error page and the user is never redirected there. A signed-out user goes to `/login?redirect=…`, which follows only a path on this site (`safeInternalPath`).
2. The approve/cancel decision is a server-function POST that must carry the site's own `Origin` (`isSameOriginRequest`), so a cross-site page cannot submit it. The redirect is built from the registered callback (`authorizationRedirect`) with `code` or `error=access_denied` and `state` echoed.
3. `POST /login/oauth/access_token` with `grant_type=authorization_code` compares the secret in constant time against its hash, checks the code's client and URI, then consumes the code with one conditional `UPDATE`, so a replay or concurrent exchange gets `bad_verification_code`. A wrong secret or URI does not spend the code. Codes live 600 seconds, store only their SHA-256, and are swept when a new one is issued. Each exchange is counted per IP and per client id before the secret is compared, and over the limit or on an unreadable counter the answer is `429` (fail closed). Success is a `pst_` token with `oauth_app_id` set.

App tokens are not listed with PATs; they appear at `/settings/applications` with scopes and date, revoking an app deletes them, and deleting an app cascades to its tokens and codes. PKCE is not required. The device flow accepts any non-empty `client_id` because `gh` sends a fixed id that is not a registered app.

## The single access computation

`repo-access.ts` collapses visibility (`public`/`private`), the owner, and collaborator roles (`read`/`write`/`admin`) into one `RepositoryAccess` per `(repoId, userId)`: `buildAccess` picks the role (owner, else collaborator role, else anonymous) and reads `canRead`/`canWrite`/`canModerate`/`canMergePullRequest` from one `PERMISSIONS` table; anonymous can read only public repositories. **This is the only place in the codebase that computes it.** Call through `getRepositoryAccess`, `getAccessForRepository` (when the row is already in hand), the `can…` wrappers, `requireWriteAccess`, `requireOwner`, or the handler shapes `readWithAccess(label, repoId, fn)` (a private repo answers like a missing one) and `writeWithAccess(repoId, fn)`.

The 4-second cache in front of it exists because one tree-page load fans out to several parallel server functions that all need the same `(repoId, userId)` answer; it coalesces in-flight resolutions so the burst shares one query. The TTL is short on purpose: this is a performance cache, not a correctness cache, and a revoked collaborator or visibility flip must land within seconds.
