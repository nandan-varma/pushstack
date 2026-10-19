---
title: "Security"
description: "The rules that must hold: access control, hostile content, names and refs, auth, limits, secrets."
---

# Security

This document is the security model: the invariants that must hold, and why each
one is shaped the way it is. It is written to be read before you change an auth
path, a storage key, or anything that renders user content.

The model in one paragraph: **access control is computed in exactly one place**;
**content is attacker-controlled and must be made inert**; **names and refs are
storage paths, so they are validated and then re-checked**; and **the only two
ways in are a browser session and a scoped token**. How these rules came to exist
— including the vulnerabilities that produced several of them — is in
[security-history.md](/docs/internals/security-history).

## Access control

See [authentication.md](/docs/internals/authentication) for the full model. The one rule
worth repeating here: `repo-access.ts` is the **only** place that computes
whether a user can read/write/moderate a repository. Any new handler that
touches repository data must call through it (`requireReadAccess`,
`requireWriteAccess`, `getRepoWithReadAccess`, etc.) rather than re-deriving
the answer — a hand-rolled check is a place a future edit can silently get the
logic wrong (e.g. forgetting the "public + anonymous = readable" case, or the
distinction between a write collaborator and the owner for owner-only
actions).

## Attacker-controlled content

Issue bodies, pull request bodies, comments and READMEs are written by anyone
with write access and rendered for everyone who views them, so every href and
src in that content is attacker-controlled. `MarkdownRenderer` renders it, and
two predicates decide whether a URL may become a real attribute:

- `isSafeHref` / `isSafeImageSrc` allow a value with **no scheme** (a relative
  reference) and an explicit scheme only if it is `http:`, `https:` or
  `mailto:` — plus `data:image/…` for images, since an `<img src="data:…">`
  cannot execute script the way an `<a href="data:text/html,…">` navigation can.
  Everything else is rejected by construction rather than by blocklist.
- Any value containing a **C0 control or a space** is rejected outright, before
  the scheme is even considered. The browser's URL parser removes ASCII tab and
  newline characters anywhere in its input and strips leading C0 controls and
  spaces *before* it reads a scheme, so `java\tscript:alert(1)` and
  `\u0001javascript:alert(1)` are live `javascript:` URLs even though neither
  starts with `javascript:`. A check on the literal prefix is therefore not a
  check on what the browser will do, and this is the reason the rule is shaped
  this way. A markdown destination cannot carry a raw control character or space
  in the first place — the markdown parser percent-encodes them — so nothing
  legitimate is lost.

If you touch that component: any new place that renders a user-controlled
href/src as a real attribute goes through those same two functions, and any new
*source* of an href (JSON, a prop, an API field) must be judged knowing it has
not been through a markdown parser. The payloads above were inert for years only
because of that percent-encoding, which is not this app's control —
`MarkdownRenderer.render.test.tsx` asserts the outcome through the browser's own
URL parser instead of trusting it. [The full story](/docs/internals/security-history#stored-xss-in-markdown-rendering).

## Relative links resolve against the file that contains them

`buildComponents` resolves a relative target against the containing document —
`./diagram.png` written in `docs/README.md` names `docs/diagram.png`, the same
as on any git host — via `src/lib/repo-path.ts`. That module also refuses a
target that climbs above the repository root, so a `../../../../etc/passwd`
image renders as nothing rather than as a request for a path no repository
contains. `rawFileUrl` (`src/lib/file-view.ts`) builds the raw-content URL with
per-segment `encodeURIComponent`, and it is the only URL builder for repo bytes
— the previous `/api/repos/{owner}/{name}/blob/…` shape matched no route, so
every relative image in every README 404'd.

## The Content-Security-Policy is per-request (nonce)

`src/server/csp.ts` runs as a global request middleware: it generates a nonce,
hands it to the router through the middleware context (read back in
`src/router.tsx` as `ssr.nonce`), and writes the header. TanStack Router stamps
that nonce on every script and style it renders, React's streamed renderer uses
it for the bootstrap scripts, and both come from the same middleware call as the
header, so the document and the policy cannot disagree.

This replaced `script-src 'self' 'unsafe-inline'`. With `'unsafe-inline'` an
injected inline script or event handler still runs, which made the policy — the
last line of defence behind `isSafeHref` — decorative against exactly the attack
it exists to stop. Three deliberate consequences:

- **The theme script is allowed by hash, not by nonce.** `src/lib/theme.ts` is
  a build-time constant and the policy carries its SHA-256, computed from that
  same constant, so the two cannot drift. A hash also needs nothing from the
  client render, where a per-request nonce does not exist.
- **`style-src` keeps `'unsafe-inline'` and carries no nonce.** Shiki's
  highlighted output puts theme colours in inline `style` *attributes*, which no
  nonce can cover, and in browsers that implement "a nonce makes
  `'unsafe-inline'` ineffective" adding one here would blank out every
  highlighted code block. Inline styles cannot execute script, so the concession
  stays confined to CSS.
- **A development build sends the policy report-only.** Vite's client and the
  TanStack devtools inject inline scripts with no nonce; enforcing the policy in
dev would break the dev server rather than secure it. Report-only keeps the two
  policies in step and surfaces violations during development instead of at
  deploy time.

`form-action 'self'` is set because it has no fallback to `default-src` —
without it a submitted form can post anywhere. `img-src` allows any `https:`
origin on purpose: READMEs reference remote images, and an image is a content
decision rather than a script-execution one.

## Names are single safe segments

A repository's storage prefix is `repos/{ownerKey}/{repoName}`, and `gitFs`
resolves `..` in the paths it maps onto keys — so a name, a ref or a path that
can contain a separator or a `..` is a cross-tenant read or write, not a
cosmetic problem. Three layers keep that from happening, and all three are
load-bearing:

1. **Input validation.** `STORAGE_NAME_RE` (`/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/`)
   is the one rule for repository names and usernames. Every branch-name-shaped
   field uses `safeBranchNameSchema` (writes) or `safeRefNameSchema` (reads), and
   every repo-relative path uses `safeRepoPathSchema`.
2. **Point of use.** `git-write.ts` re-validates a branch name immediately before
   calling isomorphic-git, and `git-fs-s3/http`'s `applyRefUpdates` validates
   every ref-update command from a push, because `git.commit`, `git.merge`,
   `git.deleteBranch`, `git.resolveRef` and `git.deleteRef` do **not** validate
   ref names themselves.
3. **Key construction fails closed.** `git-storage-naming.ts` checks each segment
   against the same pattern when it builds a key and throws rather than
   sanitizing, so a caller that skipped validation cannot reintroduce the bug by
   omission.

Route handlers that read a ref or path straight off the URL are the exception to
"server functions already validate" — `/api/raw/…` runs `isSafeRefName` and
`isSafeRepoPath` itself. [Why the ref rules exist](/docs/internals/security-history#path-traversal-via-git-branchref-names).

## Usernames are immutable (storage keys derive from them)

A repository's storage prefix is `repos/{ownerKey}/{repoName}`, and `ownerKey`
is the owner's username. Better Auth's username plugin lets `update-user` change
the username, which would orphan every repository the user owns — and let
whoever later claims the old username inherit that storage under matching
repository names, a cross-tenant read. `src/lib/auth.ts` refuses `username`,
`displayUsername` and `email` changes in `databaseHooks.user.update.before`
(`auth-immutable-fields.test.ts` runs it against real Better Auth). Allowing
renames would first need storage keyed by user id, plus a migration.

`email` is on that list so the invariant is a line in this app rather than a
property of whichever Better Auth flow happens to be enabled — `/update-user`
rejects an email field itself, and `/change-email` is off because
`user.changeEmail.enabled` is unset, but neither of those is the app's own
check.

## Git auth takes tokens only

The git endpoint accepts personal access tokens and nothing else. It once
also took account passwords (bypassing Better Auth's own rate limiter, so it
needed its own DB-backed lockout) and session cookies (a CSRF target for a
state-changing endpoint). A token is scoped, revocable and high-entropy, so
neither a rate limiter nor CSRF protection is needed. See
[authentication.md](/docs/internals/authentication).

## Personal Access Tokens

PATs are stored as a SHA-256 hash (`tokens.tokenHash`), never in plaintext.
This is the correct approach specifically because PATs are high-entropy random
strings — unlike password hashing (which needs a slow, salted algorithm like
bcrypt/argon2 to resist brute-forcing low-entropy human passwords), a fast
hash is fine for a token that's already unguessable. See
[authentication.md](/docs/internals/authentication).

## Rate limiting is shared (Postgres), not per-instance

Better Auth's limiter keeps its counters in a module-level `Map` by default
(`options.rateLimit.storage` resolves to `"memory"` when nothing else is
configured). On Vercel that is one `Map` per warm instance, so the configured
`20 requests / 60 s` (`src/lib/auth.ts`) is really 20 × however many instances
are serving, and an attacker spreading requests across instances sees a ceiling
far above what the configuration claims.

`src/server/rate-limit.ts` supplies Better Auth's `rateLimit.customStorage` with
counters in the `rate_limits` table, so the window is shared. One statement does
the whole decision — Postgres starts a new window or advances the current one,
and reports whether the caller is inside the limit — so two concurrent requests
cannot both read "under the limit": the check *is* the write. The elapsed-time
and retry arithmetic happens in SQL too, so one clock decides and no driver date
parsing is involved. `rate-limit.test.ts` runs the real SQL against pglite and
asserts the auth config actually uses this storage, since quietly falling back
to the `Map` is the regression worth catching.

## Input bounds are explicit

Every string a caller controls that gets *persisted* — a commit message, an
issue/PR/comment body, an uploaded file — has an explicit maximum in
`src/lib/limits.ts`, applied by the server function's validator. Without them
the only bound was the platform's request-body size, which says nothing about
how much storage or how much rendering work one request may cause, and a commit
message is not rendered small. The upload bound is shared with the browser, so
what the UI warns about and what the server accepts cannot drift.

The raw-content endpoint bounds what it will serve: it reads the object's size
from its pack entry and refuses anything over `MAX_RAW_BYTES` (50 MB) with a
`413` **without reading it**, because it streams from memory. That is the same
size as the git push body cap, so anything one push could have introduced is
still downloadable; a larger object can only exist by growing through
successive deltas, and `git clone` is the way to get it.

List endpoints also bound `skip` (`MAX_LIST_SKIP`). A commit page's history walk
reads `limit + skip` commits, so `skip` was the input that made a public
repository's entire history walkable — and cacheable — from one anonymous
request. `git-read.ts` clamps the walk again at the call into the git layer
(`MAX_HISTORY_WALK`) so a future caller that skipped the validator cannot
reintroduce it.

Lookup fields that only address an existing row (`owner`, `repoId`, an already
picked `username`) are *not* bounded for this reason: a few kilobytes in a SQL
parameter neither persists nor grows, and tightening them would turn a 404 into
a validation error. Usernames that are looked up by name use the same shape the
username plugin enforces at sign-up, so a value that cannot name a user fails
validation instead of becoming a query that can only miss.

## Revoking access takes effect immediately

The access cache (`repo-access.ts`) and the repository-by-name cache
(`repositories.ts`) exist to collapse a page load's parallel reads onto one
lookup each, which means a mutation that changes who may do what would otherwise
stay invisible for that cache's TTL. `invalidateRepositoryAccess(repoId)` is
called by every such mutation — visibility change, collaborator added or
removed, repository deleted — and `evictRepoByName` by renames and deletes, so
the new answer is live at once rather than up to a few seconds later.

## Request body limits on the git endpoint

`upload-pack` is reachable anonymously on public repositories, so its request
body is attacker-controlled. `GIT_HTTP_MAX_BODY_BYTES` (default 50 MB) is
enforced while the body streams in (`readGitRequestBody`), not just from a
`Content-Length` header a chunked request never sends.

## Secrets

`BETTER_AUTH_SECRET` must never be reachable from client-bundled code — see
[authentication.md](/docs/internals/authentication)'s note on `auth-session.ts`'s dynamic
import. No credential (password, PAT, session cookie) is ever passed to
`console.log`/`console.error` anywhere in the auth paths — only generic
"auth failed" messages are logged.

## Dependencies

Both `pnpm audit` and `pnpm audit --prod` report zero known vulnerabilities.
There are no dependency overrides or ignored advisories. Upgrade or remove the
package responsible for a vulnerable transitive dependency instead of forcing
an unsupported version into its graph.

pnpm 12 settings live in `pnpm-workspace.yaml`: build scripts require an
explicit `allowBuilds` entry, bundled agent skills are denied per package,
and automatic peer installation is disabled. Install the drivers and adapters
we actually use rather than every optional ORM peer.

The app uses Drizzle ORM and Kit 1.0.0-rc.4 together. Relational queries use
`defineRelations` and v2 filters; local schema pushes use
`drizzle-kit/api-postgres`. The old Kit dependency pulled in a vulnerable
esbuild release. Markdown styles and the shadcn Tailwind utilities live in the
app's CSS, so the shadcn CLI and typography plugin aren't installed runtime
or build dependencies. Add components with `pnpm dlx shadcn@latest add`.

When a new finding appears, inspect its dependency path with `pnpm why` and
`pnpm audit --json`, upgrade its owner, then run the full validation suite.
[Earlier incidents](/docs/internals/security-history#dependency-vulnerabilities) explain
why overrides and advisory exclusions were removed.
