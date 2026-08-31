# Handoff — production readiness + performance audit

> **Update, later session (2026-08-30/31):** a follow-up session did a
> codebase-wide simplification/dedup pass across all three repos (pushstack,
> `git-fs-s3`, `git-edge`) — unrelated in goal to the perf audit below, but it
> moved several of the things this doc's "current state" section names.
> Current versions: `git-fs-s3` is now **0.3.11** (dedup-only: shared
> `DiffFile` construction, loose-ref fs access, ref-CAS check; no public API
> change), `git-edge` is now **0.2.1** (removed 3 unused exports, and
> replaced its hand-rolled lockstep line merge — the "not diff3/libgit2"
> content-merge mentioned in its own README — with a real diff3 algorithm via
> `node-diff3`, fixing a real false-conflict/corruption bug). pushstack's
> per-repo Postgres-lease locking (`withRepositoryLock`/`acquireRepoLock`/
> `releaseRepoLock`) moved out of `git-repo-storage.ts` into its own
> `git-repo-lock.ts`, which `git-repo-storage.ts` still re-exports from, so no
> call site changed. All three repos' docs were updated to match in the same
> session. This session did **not** touch Vercel/production deployment state
> at all (no `pnpm deploy`, no Vercel MCP calls) — the "Current state" section
> immediately below reflects only the state as of the *original* session; it
> was not re-verified against production and may now be stale on that front.

Session goal: audit pushstack for production readiness, add Sentry, then do a
real cold/warm performance sweep and fix what's actually slow — with an
explicit constraint (stated by the user partway through): **no caching
shortcuts that let served data diverge from R2, the single source of truth.
Only real, structural, always-reads-live fixes.**

## Current state (as of end of session)

- `pushstack` repo: `main` @ `5e0c9e4`, pushed, deployed to production
  (`git.nandan.fyi`), deployment `dpl_7v7D6T1L6r9DRVzNmj6pnRQXDV73`, READY.
- `git-fs-s3` (sibling package, `~/dev/git-fs-s3`, npm: `git-fs-s3`): `main` @
  `692a4a9`, pushed, published as `0.3.7`. pushstack's `package.json` already
  points at `^0.3.7`.
- `git-edge` (sibling package, `~/dev/git-edge`): untouched this session.
- Working tree clean in both repos. No temp scripts left behind (all
  `scripts_tmp_*` files were deleted; TLS certs in `/tmp/tls` cleaned up).
- Test user/repos created for perf testing (`perfaudit` user, `perf-empty`,
  `perf-large` repos) were deleted from the real production DB/R2 after use —
  confirmed via direct query, only the real `nandan`/`pushstack` repo remains.
- `pnpm typecheck` / `pnpm check` / `pnpm test` (855 tests) / `pnpm build` /
  `pnpm audit` all green as of the last commit.

## What shipped, in commit order

1. **`0263e56` — Sentry integration.** `@sentry/tanstackstart-react`, gated on
   `VITE_SENTRY_DSN` (no-ops if unset). Four wiring points:
   - `instrument.server.mjs` + `src/server.ts` (`wrapFetchWithSentry`) —
     server init + HTTP catch-all. Vercel functions can't use Node's
     `--import` flag, so this explicit wrap is the supported alternative.
   - `src/start.ts` (`createStart` with `sentryGlobalRequestMiddleware` /
     `sentryGlobalFunctionMiddleware`) — catches thrown request/server-fn
     errors.
   - `src/router.tsx` — client init inside `if (!router.isServer)`.
   - `src/routes/__root.tsx`'s `RootErrorComponent` — `useEffect` capturing
     SSR/render exceptions the middleware doesn't see.
   - Fixed a real bug found while verifying this live: the CSP's
     `connect-src 'self'` was silently blocking every client-side-captured
     error from ever reaching Sentry's ingest endpoint. `vite.config.ts` now
     derives the Sentry ingest origin from `VITE_SENTRY_DSN` at build time
     and adds it to `connect-src`.
   - `perf-log.ts`'s existing `logError`/`logWarn` (already used throughout
     `src/server/`) now forward to `Sentry.captureException`/breadcrumbs.
   - **Verified end-to-end live**: hit a real error path, confirmed the event
     landed in the user's actual Sentry project with correct stack trace,
     mechanism (`auto.middleware.tanstackstart.server_function`), breadcrumbs.
   - User has since installed the Sentry GitHub App (separate, no code
     changes needed — commit/PR linking + Seer, not source maps).
   - Env vars needed: `VITE_SENTRY_DSN` (added to Vercel by user),
     `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT` (optional, source maps
     only, not yet set).

2. **`fa578d1` — CI + logging cleanup.** Added `build` to the CI matrix and a
   separate `pnpm audit` job (previously only `check`/`typecheck`/`test` ran,
   so a build-only break wouldn't be caught until deploy). Replaced three
   unconditional `console.log`/`console.error` calls in
   `src/lib/r2-operations.ts` with `logWarn`/`logError`/`perfNote`.

3. **`0fc1605` — Health check.** `GET /api/health`, checks real DB
   connectivity (`select 1`), for uptime monitoring.

4. **`412da3c` — Loader streaming fixes (round 1) + first git-fs-s3 bump
   (`0.3.6`).** `pulls.tsx` and `commits.$branch.tsx` route loaders were
   blocking full SSR on `Promise.all([branches, primaryList])`. Branch
   listing costs one R2 round trip per branch with no batching (confirmed via
   perf-log: 500–700ms cold for 8 branches even in the local sandbox).
   Switched both to the same fire-and-forget pattern the **tree page's
   loader already used** (only await the repo row; everything else streams
   in via each section's own `useQuery`). This is a genuine architectural
   pattern already established elsewhere in the codebase — not new, not a
   caching shortcut, just applying an existing pattern more broadly. Also
   bumped `git-fs-s3` to `0.3.6` for a first fix (see below).

5. **`25b43a9` — Repo-name pattern bug + docs correction.** Found live while
   scripting repo creation for the perf audit: the repo-name input's HTML
   `pattern="[a-zA-Z0-9-_]+"` throws `Invalid character in character class`
   under Chrome's newer `v`-flag (`unicodeSets`) regex parsing — **repo
   creation was silently broken in-browser** with no visible error. Fixed to
   `[a-zA-Z0-9\-_]+` (escaped hyphen, valid under both modes). Also corrected
   `docs/security.md`'s speculative claim that the `.md` blob-route 404 issue
   "would also break in production" — traced it to nitro's local
   Vercel-dev-emulation specifically (confirmed `.txt`/extensionless requests
   to the same nonexistent path work fine), and the real generated
   `.vercel/output/config.json` has no rule that would reproduce it deployed.

6. **`afe8fbc` — Region pin, SDK retry fix, second git-fs-s3 bump (`0.3.7`).**
   The big one. See "Root causes found" below.

7. **`5e0c9e4` — Setup page loader.** Same fire-and-forget treatment applied
   to `repo/$owner.$name.setup.tsx`'s branch-count-only query.

## git-fs-s3 changes (published 0.3.6, then 0.3.7)

- **0.3.6** (`1b31867`): `listAllRefs` (the git-upload-pack info/refs
  advertisement — every `git clone`/`git fetch`) did a separate
  `git.resolveRef({ref: "HEAD"})` call that triggers isomorphic-git's full
  5-candidate ref-expansion (`refs/%s`, `refs/tags/%s`, `refs/heads/%s`,
  `refs/remotes/%s`, `refs/remotes/%s/HEAD`) even though the branch's oid was
  already resolved two lines earlier in the same function. Confirmed via a
  local `pnpm dev` clone test showing literal garbage probe paths like
  `refs/heads/refs/heads/main` in the logs. Fix: reuse the already-resolved
  branch oid; fall back to `git.resolveRef` only for detached HEAD or a
  symref to a not-yet-existing branch.

- **0.3.7** (`692a4a9`, the one that matters more): production runtime logs
  showed `getBranches` on the real `nandan/pushstack` repo (8 branches, some
  nested like `dogfood/x`) taking **7.2 seconds**, with individual
  `HeadObjectCommand` calls silently taking ~4.9s each (see root cause #1
  below — that part was actually the S3 client, not this). Separately,
  independent of that: isomorphic-git's `resolveRef` does a stat-then-read
  for every loose ref, even when the caller (this library's own
  `listBranches`/`listAllRefs`) already knows the ref exists because it just
  came from a directory listing. Added `resolveLooseRefFast(repo, ref)` in
  `src/ops/branch.ts`: reads the loose ref file directly via
  `repo.fs.promises.readFile`, falls back to `git.resolveRef` only if that
  doesn't pan out (packed-refs, or genuinely absent) — so correctness for
  those edge cases is unchanged. Applied everywhere a per-ref `resolveRef`
  ran in a loop: `listBranches`, `createBranchFrom`'s startPoint lookup,
  `assertBranchExists`, and `listAllRefs`'s branch/tag resolution.
  - **This was NOT caching** — every call still reads live from the object
    store every time. It just does one read instead of a stat+read for the
    common case.
  - Verified via a new dedicated unit test (`test/ops.test.ts`, spy-based:
    asserts 0 `store.head()` calls and exactly 1 `store.get()` call for a
    known-good loose ref) — not just log-reading. Also a packed-refs
    fallback test. 132 tests total in git-fs-s3 now (was 130).
  - **A TTL-based cache for `getBranches` was attempted first, then fully
    reverted** after explicit user pushback: "only source of truth is
    cloudflare R2... I don't want to go around for just the metrics... only
    improve performance using intelligence, remove any shortcuts previously
    added." The revert is clean — `git-branch-ops.ts` and its test file are
    back to their pre-session state, no cache Map, no TTL logic anywhere.

## Root causes found in the live perf sweep (via Vercel MCP runtime logs)

Pulled real production runtime logs (`mcp__claude_ai_Vercel__get_runtime_logs`)
rather than trusting local-sandbox timing, after the user reported real
cold-load times were worse than the local numbers suggested. Two real,
independent root causes found, both fixed in `afe8fbc`:

1. **AWS SDK retry stacking** (`src/lib/r2.ts`). Individual
   `HeadObjectCommand` calls were silently taking ~4.9 seconds — three
   different calls, nearly identical timing (4893.6ms, 4894.8ms, 4895.4ms),
   with **zero** corresponding "retrying (attempt N/M)" log line from this
   app's own `r2-operations.ts` `withRetry` wrapper (which does log every
   retry via `logWarn`, confirmed by grepping the logs). The only explanation:
   the AWS SDK's own default retry strategy (`maxAttempts: 3`, its own
   exponential backoff) was running *inside* a single `client.send()` call,
   invisible to and stacked underneath this app's own bounded/logged/
   circuit-breaker-integrated retry wrapper. Fix: `maxAttempts: 1` on the
   `S3Client` config, plus `requestTimeout: 5_000` on the `NodeHttpHandler`
   so a stalled attempt fails fast into the app's own wrapper instead of
   hanging toward the OS TCP timeout. This client (`getR2Client()`) is
   shared by both `r2-operations.ts` and `git-fs.ts`'s `S3ObjectStore` (git
   reads), so the fix applies everywhere.

2. **Vercel region mismatch.** `DATABASE_URL` is a Neon instance in
   `us-west-2` (Oregon) — confirmed by grepping `.env.local`. Vercel's
   serverless function region defaults to `iad1` (Virginia) when
   unconfigured, meaning every DB round trip (at least one per request:
   session + repo lookup, often more) paid a real cross-country hop. Fixed
   via `nitro({ vercel: { functions: { regions: ["pdx1"] } } })` in
   `vite.config.ts` (`pdx1` = Portland, Vercel's closest region to
   `us-west-2`). Verified the fix is live by checking the `x-vercel-id`
   response header on the deployed site: `pdx1::pdx1::...`.

## Verified production impact (before → after, real `git.nandan.fyi`)

Measured via direct curl against production plus Vercel runtime log
inspection, not local simulation — the local sandbox's R2 latency was noisy
and not representative (a fact discovered mid-session when the user reported
real cold loads were slower than estimated).

- Cold `getBranches` (8 branches on the real pushstack repo, nested
  `dogfood/x` branches included): was up to **7.2s** with a 4.9s single-call
  stall; now consistently **~0.75–1.7s** cold (15 R2 calls, ~95–340ms each,
  no more multi-second single-call anomalies), **~3–25ms warm** (existing 5s
  structure-cache in git-fs.ts still does its job for repeat requests).
- General page load baseline (tree/commits/issues/pulls/settings, real repo):
  now consistently ~150–330ms across the board, both cold and warm passes —
  no more elevated tail latency.
- Because of the round-1 loader streaming fix (item 4 above), `getBranches`'s
  remaining cost — whatever it is — no longer blocks the user-visible page
  render; it streams in after the fact via each page's own `useQuery`.

## Known issue found, NOT fixed (out of scope this session)

**Real, pre-existing data-integrity bug, unrelated to anything touched this
session:** `GET /repo/nandan/pushstack/commit/b6b3f915a4c58c28010c13231ab7d167203c68ed`
returns 500. Server log:

```
[perf getCommit repo=11 b6b3f915...#1a] ✗ failed after 161.3ms:
Git data for repos/nandan/pushstack/git commit b6b3f915a4c58c28010c13231ab7d167203c68ed
is missing from storage. The repository may need to be re-pushed to repair it.
```

This is `git-history-ops.ts`'s own deliberate error message for a missing
commit object in R2 — a real data-integrity problem (object genuinely absent
from storage), not a bug in ref resolution or the R2 client config touched
this session. `b6b3f915...` was `main`'s tip at the *start* of this session
(per `git log --oneline` on the local pushstack checkout). Not yet
root-caused — worth investigating separately (possible causes: a prior
repack/pack-consolidation bug incorrectly treating this object as
superseded/redundant and deleting it, or an incomplete push). **This needs
its own investigation thread**, not a quick fix — start by checking whether
`main` has moved past this commit already (if so, check whether the object
is reachable from the new tip at all — it should be, since it's an ancestor)
and whether `deleteStalePacksFromR2`/repack logic in `git-http-iso.ts` has a
correctness gap.

## Remaining, unfixed architectural lever (flagged, not attempted)

`git.listBranches()` (isomorphic-git's own implementation) still does one
`stat` call per ref/directory level to determine "is this entry a leaf ref
file or a directory to recurse into" — this is what supports nested branch
names like `dogfood/x`. This is **separate from and unaffected by** the
`resolveLooseRefFast` fix (which only touches the *oid-lookup* step after
`listBranches` already has the flat name list) — confirmed by re-reading
production logs after deploy: the remaining `HEAD` calls line up exactly with
directory-walk entries (`dogfood`, and each nested leaf under it), not with
oid lookups. Fixing this further would mean either patching isomorphic-git's
own ref-expansion (too invasive) or reimplementing branch discovery to
batch-read the whole `refs/heads/` subtree in fewer calls (e.g., one
recursive `LIST` covering all nesting levels at once, doing the leaf/dir
classification from key suffixes instead of per-entry stats). Given the
loader-streaming fix means this no longer blocks page render, this is a
"nice to have, not urgent" item.

## Explicit user constraints for future work (important — don't relitigate)

- **No caching-based performance shortcuts.** R2 is the single source of
  truth; every read should reflect it live. A TTL cache for branches was
  tried and explicitly rejected mid-session for this reason.
- **"Minimal and performant code... not chasing metrics."** Prefer fixing
  the actual structural inefficiency (fewer round trips, correct client
  config) over papering over it with caching, feature flags, or other
  indirection.
- Test everything against real production data/logs when possible (Vercel
  MCP tools: `get_runtime_logs`, `get_runtime_errors`, `list_deployments`,
  `get_project`) rather than trusting local-sandbox timing, which was proven
  unreliable this session (R2 latency in the local dev sandbox doesn't match
  Vercel↔R2 latency at all).
- Publishing to npm / pushing to both repos' `main` was explicitly
  authorized ("bump, commit and push everywhere") and exercised twice this
  session (`git-fs-s3` 0.3.6 and 0.3.7). Same authorization likely still
  stands for continuing this work, but confirm if a long gap has passed.

## How to reproduce the local test harness (if needed again)

Building a genuinely representative local test environment took significant
back-and-forth this session; notes in case it's needed again:

- `pnpm build` produces `.vercel/output/functions/__server.func/index.mjs`,
  which exports `{ fetch(request, context) }` (Vercel's `vercel-edge`-style
  fetch handler format, from `nitro`'s `vercel.web.mjs` runtime) — a plain
  Node `http`/`https` wrapper can invoke it directly for a very
  close-to-real-production test, **but must run with `NODE_ENV=production`**
  (otherwise React's bundled CJS jsx-runtime and the ESM react-dom bundle
  disagree on dev vs prod dispatcher shape and crash).
- Must ALSO serve `.vercel/output/static/*` directly for any matching path
  (mimicking the real `"handle": "filesystem"` routing step) — the server
  function alone 404s every client JS asset otherwise, and the app never
  hydrates.
- Better Auth's `useSecureCookies: true` (hardcoded in `src/lib/auth.ts`,
  intentionally, for real production) means a plain-HTTP local wrapper can
  set the session cookie but the browser silently won't send it back on
  subsequent requests. Needed a self-signed TLS cert (`openssl req -x509
  -newkey rsa:2048 ...`) and to serve the wrapper over HTTPS, with
  `BETTER_AUTH_URL=https://localhost:3000` and Playwright's
  `ignoreHTTPSErrors: true`, for any authenticated-flow testing.
- When forwarding the Fetch API `Response` back through Node's
  `http.ServerResponse`, **must** use `response.headers.getSetCookie()` and
  set them as an array via one `res.setHeader("set-cookie", [...])` call —
  naively iterating `response.headers.entries()` and calling
  `res.setHeader(k, v)` per entry silently drops all but the last
  `Set-Cookie` header (Node replaces, doesn't append, on repeated
  `setHeader` calls with the same name). This exact bug cost real time this
  session (looked like a broken auth system before the real cause was found).
- `vite.config.ts`'s env-derived build behavior (Sentry CSP origin,
  `SENTRY_AUTH_TOKEN`-gated plugin) only sees real values if the shell
  process actually has them exported — `.env.local` is not auto-loaded into
  `vite.config.ts`'s own `process.env` the way `import.meta.env` is for
  app code. Confirmed this is fine for the real Vercel deploy (Vercel
  injects dashboard-configured env vars into `process.env` for the build
  process natively) — just don't be alarmed if a local `pnpm build` doesn't
  show the Sentry CSP origin unless you `export $(grep VITE_SENTRY_DSN
  .env.local | xargs)` first.
- All test-harness scripts (`scripts_tmp_*.{mjs,sh}`, TLS certs) were
  deleted at the end of each phase — none should exist in the working tree
  or `/tmp` right now.

## Open questions for the user, if resuming

1. Want the missing-commit-object bug investigated? (Separate thread —
   data integrity, not performance.)
2. Want `git.listBranches()`'s remaining directory-walk overhead addressed
   (would need a from-scratch branch-discovery reimplementation, not a
   small patch)?
3. Want source maps wired up (`SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/
   `SENTRY_PROJECT` — currently unset, so Sentry stack traces show bundled/
   minified names)?
