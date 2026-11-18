---
title: "Security"
description: "The rules that must hold: access control, hostile content, names and refs, auth, limits, secrets."
---

The invariants that must hold, each with the reason it is shaped that way. Read it before changing an auth path, a storage key, or anything that renders user content. How these rules came to exist is in [security-history.md](/docs/internals/security-history).

## Access control

`repo-access.ts` is the **only** place that decides whether a user can read, write or moderate a repository. A new handler calls through it (`requireReadAccess`, `requireWriteAccess`, `getRepoWithReadAccess`, …) instead of re-deriving the answer: a hand-rolled check is where a later edit silently drops the "public + anonymous = readable" case or the owner-only distinction.

## Branch protection is enforced in the request path

A rule's reviews, code owners, status checks and ref ancestry are rows and git reads that already exist, so branch protection is evaluated synchronously at push (`vetPush`) and at merge (`mergeBlockedReason`), never by a worker: a refused push or merge leaves no ref moved. Readers and enforcers share `branch-protection-store.ts`, so the rule a `gh pr view` reports is the rule that refused the merge.

## Fork visibility

A fork is an independent repository — own storage, own visibility, own access list — so nothing about its parent may leak through it.

- Visibility is copied once at fork time; neither side follows later changes.
- Listings, `forks_count`, and the `parent`/`source` links use the viewer's own read rule (`readableForViewer`). An unreadable repository is a `404` or an omitted field, never an empty list or a bare name. `source` follows `fork_of_id` to a bounded depth, then is omitted.
- Deleting a parent nulls `fork_of_id` and keeps `is_fork`, so the fork stays readable with no `parent`; deleting a fork leaves the parent alone.
- A fork's git data is a copy of the parent's whole prefix, unreachable objects included, so a read path serving a fork honours the fork's visibility.

## Attacker-controlled content

Issue and PR bodies, comments and READMEs are attacker-controlled wherever they are rendered. `MarkdownRenderer` gates every href/src through `isSafeHref` / `isSafeImageSrc`: no scheme (a relative reference) is allowed, and an explicit scheme only if it is `http:`, `https:` or `mailto:` — plus `data:image/…` for images, since an `<img src="data:…">` cannot execute script the way an `<a href="data:text/html,…">` navigation can. An allowlist by construction, never a blocklist.

Any value containing a **C0 control or a space** is rejected before the scheme is considered. The browser's URL parser strips those characters *before* it reads a scheme, so `java\tscript:` and `\u0001javascript:` are live `javascript:` URLs and a prefix test is not a test of what the browser will do. A markdown destination cannot carry them (the parser percent-encodes them), so nothing legitimate is lost — but that encoding is not this app's control, which is why `MarkdownRenderer.render.test.tsx` asserts the outcome through the browser's own URL parser.

Any new place that renders a user-controlled href/src as an attribute uses those two functions, and any new *source* of an href (JSON, a prop, an API field) has not been through a markdown parser. [The full story](/docs/internals/security-history#stored-xss-in-markdown-rendering).

## Webhook delivery is the one outbound fetch of a repo-config URL

A webhook URL is repository configuration, so `webhook-deliver.ts` is the only place that fetches one and the only place that needs SSRF defence. It is HTTPS only, resolves the host once, rejects every non-global address (loopback, private, link-local and the metadata IP included, IPv4-mapped IPv6 un-mapped first), and pins the socket to the address it checked with `https.request`'s `lookup` while `Host`/SNI stay the original host — a second DNS answer has no window to rebind. It follows no redirects, uses no proxy, holds each attempt to 10 s, reads at most 64 KiB of response, and signs the exact bytes it sends. The same function is the sole writer of delivery rows, so a blocked address is a recorded failure rather than an unlogged request.

## Relative links resolve against the containing file

A relative target resolves against the containing document (`./diagram.png` in `docs/README.md` names `docs/diagram.png`) and is refused if it climbs above the repository root, so a traversal renders as nothing rather than as a request for a path no repository contains. `rawFileUrl` (`src/lib/file-view.ts`) is the only builder for repo byte URLs and encodes per segment.

## The CSP is per-request (nonce)

`src/server/csp.ts` runs as global request middleware: it generates the nonce, writes the header, and hands the nonce to the router (`ssr.nonce`), so TanStack Router and React's streamed bootstrap scripts stamp the same value and the document cannot disagree with the policy. Scripts never get `'unsafe-inline'`: with it an injected inline script still runs and the last line of defence behind `isSafeHref` is decorative. Three consequences:

- **The theme script is allowed by hash, not nonce.** `src/lib/theme.ts` is a build-time constant and the policy carries its SHA-256 computed from that same constant, so the two cannot drift; a hash also needs nothing from a client render, where a per-request nonce does not exist.
- **`style-src` keeps `'unsafe-inline'` and no nonce.** Shiki puts theme colours in inline `style` attributes, which no nonce covers, and where a nonce disables `'unsafe-inline'` adding one would blank every highlighted block. Inline styles cannot execute script.
- **A development build sends the policy report-only**, because Vite and the TanStack devtools inject nonce-less inline scripts; enforcing it would break the dev server instead of securing it.

`form-action 'self'` is set because it does not fall back to `default-src`. `img-src` allows any `https:` origin on purpose: READMEs reference remote images, and an image is a content decision, not a script-execution one.

## Names are single safe segments

A storage prefix is `repos/{ownerKey}/{repoName}` and `gitFs` resolves `..` in the paths it maps onto keys, so a name, ref or path containing a separator or a `..` is a cross-tenant read or write. All three layers are load-bearing.

1. **Input validation.** `STORAGE_NAME_RE` is the one rule for repository names and usernames; branch-shaped fields use `safeBranchNameSchema` (writes) or `safeRefNameSchema` (reads); repo-relative paths use `safeRepoPathSchema`.
2. **Point of use.** `git-write.ts` re-validates a branch name immediately before calling isomorphic-git, and `applyRefUpdates` validates every push ref command, because `git.commit`, `git.merge`, `git.deleteBranch`, `git.resolveRef` and `git.deleteRef` do not validate ref names themselves.
3. **Key construction fails closed.** `git-storage-naming.ts` checks each segment against the same pattern and throws rather than sanitizing, so a caller that skipped validation cannot reintroduce the bug by omission.

Pull request heads (`refs/pull/<n>/head`) are stricter than branches and tags: only server code writes them, through `pullHeadRefName(n)`, and a push cannot name one. Route handlers that read a ref or path straight off the URL run the validators themselves — "server functions already validate" does not hold there. [Why the ref rules exist](/docs/internals/security-history#path-traversal-via-git-branchref-names).

## Usernames are immutable (storage keys derive from them)

`ownerKey` is the owner's username, so a rename would orphan every repository the user owns and let whoever claims the old name inherit that storage under matching repository names. `src/lib/auth.ts` refuses `username`, `displayUsername` and `email` changes in `databaseHooks.user.update.before`, so the invariant is a line in this app rather than a property of whichever Better Auth flow happens to be enabled. Renames would first need storage keyed by user id, plus a migration.

## Auth and tokens

The git endpoint takes personal access tokens only. Passwords (bypassing Better Auth's limiter, so needing a second one) and session cookies (a CSRF target for a state-changing endpoint) are both out; a token is scoped, revocable and high-entropy, so it needs neither. PATs, device-flow tokens and OAuth app tokens share one table and only a SHA-256 hash is stored, as with device codes, authorization codes and OAuth client secrets, each consumed once by a conditional update. A fast hash is correct here specifically because tokens are unguessable, unlike low-entropy passwords that need a slow salted algorithm. See [authentication.md](/docs/internals/authentication).

## Rate limiting is shared (Postgres), not per-instance

Better Auth's default limiter counts in a module-level `Map`, which on Vercel means one per warm instance: the configured limit is really that many times the configured number. `src/server/rate-limit.ts` supplies `rateLimit.customStorage` backed by the `rate_limits` table, and one statement makes the whole decision — it starts or advances the window and reports whether the caller is inside it — so the check *is* the write and two concurrent requests cannot both read "under the limit". A quiet fallback to the `Map` is the regression `rate-limit.test.ts` catches.

The same table meters `/api/v3` and git smart HTTP (`hitRateLimit`, keys prefixed `gh:`), never SSR pages. Identity is the authenticated user, else the client IP. Buckets: `core` reads, `core-write`, `git`, `git-write` (`RATE_LIMIT_*` in `config.ts`); over the limit is `403` with GitHub's `X-RateLimit-*` and `Retry-After`. **The limiter fails open** — a database error is logged with `logWarn` and the request is served, because this is abuse mitigation, not authorization. Failed credentials are counted per client IP (`auth-failure`); once spent, credentialed requests are refused before the token is hashed, and an in-memory hint keeps clean requests at one round trip. The client IP is `x-vercel-forwarded-for`, then `x-real-ip`, then the leftmost `x-forwarded-for`; Vercel overwrites these at its edge ([headers](https://vercel.com/docs/headers/request-headers)), which holds only while no proxy sits in front of it. Pruning is per key family so neither side deletes the other's live buckets.

## Input bounds are explicit

Every caller-controlled string that is persisted — a commit message, a body, an upload — has a maximum in `src/lib/limits.ts`, applied by the server function's validator. Without them the only bound is the platform body size, which says nothing about storage or rendering work. The upload bound is shared with the browser so the warning and the accepted value cannot drift.

The raw-content endpoint reads the size from the pack entry and refuses anything over `MAX_RAW_BYTES` with a `413` **without reading it**, because it streams from memory. List endpoints bound `skip` (`MAX_LIST_SKIP`) — a history walk reads `limit + skip` commits — and `git-read.ts` clamps the walk again (`MAX_HISTORY_WALK`) so a caller that skipped the validator cannot reintroduce it. Lookup fields that only address an existing row are deliberately unbounded: a few kilobytes neither persists nor grows.

## Caps are checked under a lease

Per-repository caps (labels, milestones, releases, collaborators) are a count followed by an insert, and Neon's HTTP driver has no transactions or advisory locks, so concurrent creates can all read the same count and overshoot. Each create takes a short lease in `repo_locks` under `caps/<repoId>/lock` and checks and inserts inside it. That is the lease row git writes use, in a separate key namespace, so a label create never waits for a push. Failing to take the lease within 65 seconds fails the create; a killed process's lease lapses after 60 seconds. The guarantee is mutual exclusion per repository, not per cap, at two extra queries per create.

## Revoking access takes effect immediately

The access and repository-by-name caches collapse a page load's parallel reads onto one lookup each, so a mutation that changes who may do what would otherwise stay invisible for the TTL. Every such mutation calls `invalidateRepositoryAccess(repoId)`, and `evictRepoByName` by renames and deletes, so the new answer is live at once.

## Git request bodies and secrets

`upload-pack` is reachable anonymously on public repositories, so `GIT_HTTP_MAX_BODY_BYTES` is enforced while the body streams in (`readGitRequestBody`), not just from a `Content-Length` a chunked request never sends. `BETTER_AUTH_SECRET` must never be reachable from client-bundled code — see [authentication.md](/docs/internals/authentication)'s note on the dynamic import — and no credential is ever passed to a logger on an auth path.

## Dependencies

`pnpm audit` and `pnpm audit --prod` report zero unreviewed vulnerabilities. Upgrade or remove the package responsible for a vulnerable transitive dependency instead of forcing an unsupported version into its graph; broad overrides and advisory exclusions have broken things here before ([why](/docs/internals/security-history#dependency-vulnerabilities)). An exception needs a released fix that does not exist, a path that never sees request input, and its removal condition; the workspace test fails on any other entry in `pnpm-workspace.yaml`.

- `GHSA-fc5q-39xc-vjpf` (picomatch ReDoS) is ignored in `auditConfig.ignoreGhsas`: every released picomatch is affected and only build and dev tooling matches our own globs with it. Remove it once a fix is released and the lockfile resolves to it.
- `@sentry/bundler-plugins>glob` is pinned to `>=14.0.2`: the plugin pins a vulnerable glob 13, glob 14 also clears the minimatch advisory, and Sentry's only call is `glob.glob()`, which glob 14 keeps. Remove the override once the plugin depends on a patched glob itself.

Build scripts need an explicit `allowBuilds` entry, bundled agent skills are denied per package, and automatic peer installation is off: install the drivers and adapters actually used rather than every optional ORM peer. Markdown styles and the shadcn Tailwind utilities live in the app's CSS, so the shadcn CLI and typography plugin are not dependencies.

## Aggregate diff work

Diff computation uses git-fs-s3's default budgets (3,000 changed paths, 10 MiB blob input and UTF-8 patch output), 16 concurrent operations, and stops queued work after a budget failure. `DiffLimitError` propagates to Files views; REST and plain-text diff/patch endpoints return `406` rather than an empty diff. Where a whole response is buffered the app is stricter: REST diff/patch media types refuse a rendered body over `MAX_API_DIFF_BYTES` (below Vercel's 4.5 MB cap), while the web origin's own `.diff`/`.patch` URLs keep the library's budget because they stream.
