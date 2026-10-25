---
title: "Performance"
description: "Caching layers front to back, perf-log instrumentation and the biggest fixes."
---

This codebase has had multiple dedicated performance passes — cold-start repo
page loads were measured at several seconds before these existed. This doc
covers the caching layers, the instrumentation convention used to diagnose
slowness, and the biggest fixes made, as case studies for the kind of thing to
watch for when adding new code.

## Caching layers, front to back

1. **TanStack Query** (client + SSR) — tiered `staleTime`/`gcTime` per data
   shape, all defined in `apps/web/src/lib/query-options.ts`:
   - `SESSION_STALE_TIME` (60s) — auth session.
   - `DEFAULT_STALE_TIME` (2min) — most repo/issue/PR list data.
   - `LONG_LIVED_STALE_TIME` (10min), with a **longer** `gcTime` (30min) —
     branch lists and similar data that changes rarely. The longer `gcTime`
     matters: React Query's default `gcTime` (5min) is shorter than a 10-minute
     `staleTime`, so an unobserved entry (a tab the user navigated away from)
     would get garbage-collected before it ever went stale, silently forcing a
     refetch that the `staleTime` said shouldn't be needed yet.
   - `IMMUTABLE_STALE_TIME` (`Infinity`) — commits and their diffs, addressed
     by SHA. Content-addressed and immutable, so once fetched they never need
     a background refetch.

   When adding a new query, pick the tier that matches how often the
   underlying data actually changes — don't default to the shortest one out
   of caution; that's how a page ends up re-fetching data on every navigation
   for no reason.

2. **`repo-access.ts`'s access-decision cache** — 4-second TTL, keyed by
   `(repoId, userId)`, with in-flight coalescing. A single tree-page load
   fans out to 4+ server functions in parallel that each independently need
   "does this user have access to this repo" — without this, that's 4+
   redundant DB round trips for the identical answer. Short TTL is
   deliberate: this is a perf cache, not a correctness cache (a revoked
   collaborator should take effect in seconds, not linger for a request's
   lifetime). See [authentication.md](/docs/internals/authentication).

3. **`git-cache.ts`'s in-process result cache** (server, per-process) —
   `resultCache`, holding parsed `git-fs-s3/ops` results (tree listings,
   commit logs) as JS values keyed by head sha, so a hit costs no parsing. Raw object bytes are cached one
   layer down, in `git-fs-s3`'s `createCachedStore` (composed in `git-fs.ts`). Small pack
   slices (`getRange`, up to 64 KiB, the usual inline-viewable blob) are cached
   too, in a separate LRU, so a repeated file view costs no R2 call; larger
   slices keep going straight to R2.

   <a id="ref-aware-ttl"></a>**`git-fs.ts`'s per-key TTL override** — the R2
   read cache's TTL (`GIT_CACHE_MAX_SIZE`/`GIT_CACHE_TTL`-tunable, default
   1h) is right for content-addressed object reads (a given key's bytes
   never change) but wrong for the mutable parts of a gitdir: a ref's value
   moves on every push, and the `objects/`/`objects/pack/` directory
   listings grow on every push, while the *key* naming either stays the
   same. Since this cache is in-process per server instance with no
   cross-instance invalidation, a warm instance that isn't the one handling
   a given push could keep serving a pre-push ref, or fail to discover a
   freshly pushed pack exists at all (misreporting its commits as "missing
   from storage"), for up to the full TTL. `git-fs.ts`'s `refAwareTtl`
   (passed as `git-fs-s3`'s `ttlForKey` option) gives
   `HEAD`, `refs/*`, and the two listing paths a 5-second override instead —
   cheap, since each is one small object or a bounded listing, and safe,
   since everything downstream (tree/commit/blob reads keyed by the sha a
   fresh ref resolves to) still gets the full-length cache benefit once the
   structure itself is current.

4. **Negative-result and loose-object-hint caching** — isomorphic-git
   repeatedly probes paths it expects might not exist (ref candidates,
   loose-object paths before falling back to pack search, directory-existence
   checks before every read). `git-fs-s3`'s `createGitFs`
   (`looseObjectHints`, `registerGitdir`, wired in `git-fs.ts`) answers those
   without R2 calls — see [git-storage.md](/docs/internals/git-storage).
   `detectLooseObjectsHint` answers "does this repo have any loose
   objects at all" once per repo with a single bounded LIST call, so a
   fully-packed repo (the common case) never even attempts a loose-object
   probe against R2 — the single biggest win for cold commit-log loads and
   cold clones.

5. **`getCommitLog`'s per-head-SHA result cache** (`git-fs-s3/ops`, via
   `git-read.ts`) — caches the deepest commit-chain walk seen for a resolved
   head SHA and slices it for shallower or repeated requests; commit history
   pages, file history and last-commit lookups all reuse that one walk.

6. **R2 request coalescing** — `git-fs-s3`'s
   `createCachedStore` (`coalesce` option, on by default) ensures concurrent reads
   for the same not-yet-cached R2 key (e.g. 100 object reads all wanting the
   same pack file mid-walk, or several concurrent ref/branch lookups that
   each independently stat the gitdir root) share one backend call instead
   of firing one each — on a cold cache, none of them can see a result the
   others haven't produced yet.

7. **`repository-lookup.ts`'s repo-row cache** (`findRepositoryByName`, short TTL
   + in-flight coalescing) — one single-join lookup shared by the web UI and
   the git endpoint. Every git operation makes at least two requests
   (info/refs, then upload-pack/receive-pack), so the second one typically
   hits the cache.

8. **Writes go straight to R2** — every write goes through the same `gitFs`
   as reads (see [git-storage.md](/docs/internals/git-storage)): a push costs the pack +
   index uploads and a few ref reads/writes, independent of how big the
   repository already is, apart from the threshold-gated repack.

## Parallelism over sequential waiting

Route loaders and server functions favor `Promise.all` wherever calls don't
have a real data dependency on each other. Some concrete examples already in
the codebase, worth matching the shape of when adding new code:

- The tree page's loader only `await`s `repositoryByNameQueryOptions` (fast —
  one DB row) — `repositoryBranchesQueryOptions`, `repositoryTreePageQueryOptions`,
  `repositoryLastCommitsQueryOptions`, the `limit: 1`
  `repositoryCommitsQueryOptions` call, and the README content query are all
  **fire-and-forgotten** (`ensureQueryData(...).catch(() => {})`, not
  awaited), so the route commits and the page mounts the moment `repo`
  resolves instead of blocking on whichever of those four is slowest. Each
  section (`FileTable`, `CommitSummaryBar`, the branch selector, ...) reads
  the *same* query key client-side via its own `useQuery`, picks up the
  already-in-flight fire-and-forgotten request, and renders a skeleton
  matching its own final layout until that specific piece resolves.
- `git-fs-s3/http`'s `listAllRefs` (info/refs) resolves branches, tags, HEAD's oid, and the current-branch
  symref all in parallel, then resolves every branch/tag's oid in parallel
  too.
- `git-fs.ts`'s `prefetchAllPacks` (a thin wrapper around
  `git-fs-s3`'s `GitFs.prefetchPacks`) downloads every pack
  file in parallel *before* a sequential `git.log` walk starts, rather than
  letting isomorphic-git fetch packs lazily and serially as the walk needs
  them. It fires on every cache-miss history walk and tree read.
- Receive-pack checks every incoming tree name, including unreachable trees,
  using the incoming pack bytes and the index generated during indexing.
  This avoids reading the pack back from storage for the fsck scan; unknown
  object types still require repository reads and fail closed if unreadable.
  The small-push regression test caps storage calls at 23.
- Receive-pack applies every ref update in a
  push (compare-and-swap check, then write/delete) in one `Promise.all` —
  each ref only touches its own ref file, so a multi-ref push (`git push
  --all`/`--tags`) applies them all concurrently instead of one at a time.
- `getLastCommitsForTree` (`git-fs-s3/ops`) walks commit history in
  fixed-size batches, prefetching each batch's tree reads in parallel before
  resolving that batch sequentially (which entries are still unresolved must
  advance commit by commit). Without it this was ~36s of a ~39s cold page
  load; keep the two-phase shape.

Some things are **inherently sequential and can't be parallelized away** — a
commit chain walk only reveals the next oid to fetch after reading the
current commit, and a resolved access decision has to exist before a gated
query runs. The fix in those cases is caching/prefetching around the
sequential part, not fighting the dependency.

## Case study: a "safety check" that was itself the bug

`repackRepository` (`git-fs-s3/http`) once guarded deleting old packs with an
object-count comparison: the new pack's count had to be at least the old
packs' combined count. Packs can overlap, so the old side double-counts and
almost always came out higher — and once consolidation declined once, it
declined forever, so repos accumulated packs while the repack "succeeded" on
every push. The check now tests the property that matters: did the
reachability walk read every object it visited.

The lesson: **a safety check's assumptions can quietly stop holding once
something it depends on has already partially failed once.**

## Case study: lock-free readers racing a writer's cleanup

A clone's `collectReachableOids` can list `objects/pack/` just before a
concurrent push's repack deletes one of the listed packs. Under an
adversarial load test (15 clones against a repo pushed to in a tight loop,
each push crossing the repack threshold), most clones failed with "remote
did not send all necessary objects" — always the same oid, one that cloned
fine moments before or after; `git fsck` showed nothing was ever lost.

Taking the write lock on reads would give up what makes them fast, so the
reader tolerates the transition instead: on a missing object it retries
once after a short delay, which sees the current pack list. That's sound
only because the replacement pack is always written before old ones are
deleted, so nothing a reader wants is ever actually gone.

## Case study: an optimization applied to three call sites out of four

`prefetchAllPacks` (`git-fs.ts`) exists because walking a commit chain is
inherently sequential, so without prefetching a repo with several packs pays
one R2 round trip per pack, serially, as the walk discovers it needs each.
The web UI's history reads used it; upload-pack's walk
(`collectReachableOids`, serving real `git clone`) has the same shape but
didn't. Profiling against real R2 showed the walk alone at 744.7ms on a
2-pack repo; adding the prefetch to its `beforeWalk` hook dropped it to
20.1ms and a warm-server `git clone` from 2.1s to 0.65s.

The lesson: **when a structural problem is solved at some call sites, audit
every place with the same shape** — `grep` the fix's call sites
(`prefetchAllPacks(`) rather than trusting prose. `apps/web/scripts/perf-setup.ts` /
`apps/web/scripts/perf-page-load.ts` are the profiling harness: real `git` CLI
operations and direct read-path calls against a local dev server with real
R2, reading `perf-log.ts`'s breakdown from its stdout.

## The `perf-log` instrumentation convention

**Request ids and structured logs.** A global request middleware
(`apps/web/src/server/request-id.ts`) runs every request inside a `perfContext`, so each
has a unique id (32 hex chars) sent as `X-Request-Id`; `/api/v3` also sends it
as `X-GitHub-Request-Id`. Nested `perfContext`s (server functions, the API
dispatcher, git-http) become steps of the outer request and share its id.
`logError` tags Sentry events with `request_id`. In production (perf-log
off) every request prints one JSON line (`requestId`, `label`, `ms`, `r2Calls`,
`r2Ms`, cache hits/misses, top-level `steps` such as git ops), as do
`logError`/`logWarn`. A request slower than `SLOW_REQUEST_MS` (default 3000)
always logs a `slow request` warning plus a Sentry breadcrumb. In dev,
`GET /api/debug/perf` shows the last 50 request trees.

Two modules, same idea, different sides of the request:

- **`apps/web/src/server/perf-log.ts`** (server): `perfContext(label, fn)` wraps a
  `createServerFn` handler in an AsyncLocalStorage-based context (so nested
  calls don't need it threaded through every function signature);
  `perfStep(label, fn)` times an awaited sub-call, and anything that step
  starts is recorded one level deeper; `perfR2(label, fn)` (used inside
  `git-fs.ts`) also tallies R2 call count/time;
  `perfNote(text)` adds a note at the current depth (`db/index.ts` routes
  every SQL statement — text only, never parameters — through it). When the
  request ends, its whole tree prints as one block:

  ```
  [perf getTreePageData repo=11 main:src#4] done 539.3ms · r2 8 calls 1396.4ms · cache 8 hit 8 miss
    · getCurrentUserOptional 1.0ms
    · getRepositoryTreeData 538.1ms
      · R2 LIST repos/nandan/pushstack/git/refs/heads/ 208.8ms
      • getCommitLog: result-cache MISS for …
  ```
- **`apps/web/src/lib/perf-log.ts`** (client/SSR): `perfTime`/`perfMark`, used in route
  loaders and `query-options.ts` queryFns — prefixed `[perf:ssr]` or
  `[perf:client]` so a request's client-perceived latency can be compared
  against the server-side tree for the same request. It also owns the switch.

**Off in production by default.** Visitors' consoles stay quiet and the
server doesn't pay for log volume: everything above is a no-op unless
`isPerfLogEnabled()` — always in dev; on the server when
`PUSHSTACK_PERF_LOG=1`; in a browser when `localStorage["pushstack:perf-log"]`
is `"1"`, which Settings → Developer toggles for that browser. `logError` and
`logWarn` always log.

**Follow this pattern when adding a new server function on a user-facing read
path**: wrap the handler in `perfContext`, wrap each meaningfully-awaited
sub-call in `perfStep`. This is what made every fix described above possible
to actually find — the dev server's logs show a full timing breakdown for any
slow page load, rather than a single opaque total.

## Cache freshness signaling (the "new commits" banner)

The tiered `staleTime`s above are a trade-off: the longer they are, the
longer a page can keep showing data that's genuinely out of date if someone
else pushed in the meantime. Rather than shortening `staleTime` (which
undoes the caching win for everyone, all the time, to cover the rare case
someone else just pushed), `useBranchUpdateBanner`
(`hooks/use-branch-update-banner.ts`) adds `refetchInterval: 60_000` and
`refetchIntervalInBackground: true` (plus `refetchOnWindowFocus: true`) as
extra observer options on top of `repositoryLatestCommitQueryOptions`
(`query-options.ts` — a `limit: 1` `repositoryCommitsQueryOptions` call),
rather than standing up a second, separate "just the SHA" query.
`refetchIntervalInBackground` matters specifically for a backgrounded tab —
without it, `refetchInterval` alone still pauses while the tab isn't
focused, so a push landing then wouldn't surface until the user refocuses
*and* `refetchOnWindowFocus` happens to fire; with it, the banner is already
correct the moment they come back. A depth-1 commit-log walk is already as
cheap as a bare ref resolve, so there's no perf reason to keep a minimal endpoint around just to avoid the walk.

This matters because it's the *same* query/cache entry that
`CommitSummaryBar` (the tree page's "latest commit" line) reads for its own
display: the banner's poll is what keeps that display fresh, for free, with
zero extra requests — one query serves both "is there something new" and
"what is the something new," instead of two independently-resolved answers
to "what's HEAD" that could in principle disagree.

`useBranchUpdateBanner` compares each poll against the SHA seen when it
started watching and, on a mismatch, shows `BranchUpdateBanner` instead of
silently continuing to serve the stale cached tree/commit data. Clicking
Reload `await`s `invalidateQueries(["repos", repoId])` — every repo-scoped
query key is nested under that prefix (see
[server-functions.md](/docs/internals/server-functions)), so one partial-match
invalidation busts everything a push could have changed, and (with
`invalidateQueries`'s default `refetchType: "active"`) only refetches
whatever's actually mounted right now, not every cached-but-unmounted query
for that repo. Awaiting it (rather than firing-and-forgetting) is what lets
the banner know it's actually safe to dismiss itself — every mounted query
for this repo, including the slower ones, is guaranteed to have finished
refetching by the time `hasUpdate` clears, not just the fast poll.

This is the general pattern for any future "long cache, but tell me if it's
actually gone stale" need: pile the always-polling `refetchInterval` onto
the *same* query that already serves the real data whenever a live view of
that data doubles as its own freshness signal — only reach for a genuinely
separate minimal query if the display data itself is too expensive to poll
on a timer.

## R2 resilience (`git-fs.ts` + `git-fs-s3/fetch-s3`)

Every R2 call goes through `git-fs-s3`'s `createRetryStore`: retry with
exponential backoff and jitter (5xx, 429, a dropped connection, a timed-out
attempt), and a circuit breaker (5 consecutive failures within 30s opens the
circuit, failing fast instead of piling up retries against an R2 outage). A
missing object is never a failure — the store maps 404 to `null` — so it
can't trip the breaker. Each attempt is bounded by `AbortSignal.timeout`
(30s for object bodies, 10s for metadata calls), so a stalled connection
fails fast into the retry loop rather than hanging on the OS TCP timeout.

`git-fs-s3/fetch-s3` signs requests with `aws4fetch` and sends them with plain
`fetch` — Node's built-in fetch keeps connections alive and pools them on its
own, which is what the old explicit keep-alive `https.Agent` existed for (a
single page load can fire hundreds of object reads). `git-fs.ts` owns the
app's one store instance; never construct a second one.

## The cost isomorphic-git pays before your first object read

`isomorphic-git` verifies each pack against its index-recorded checksum the
first time it reads from it in a process: it compares the pack's trailer to the
index's record and then SHA-1s the **entire pack payload**, memoising the result
per pack per process. On a serverless runtime that memo has the lifetime of an
instance, so a cold instance serving one small object out of a large pack pays
a whole-pack hash first (a few hundred milliseconds for a 200 MB pack). It is
not avoidable from here — the verification lives upstream and it is what makes
a corrupted pack fail loudly instead of serving wrong bytes.

Worth knowing for two reasons. First, it is why `prefetchPacks` and the
per-repo parse cache matter more than their own timings suggest: they amortise
over a walk the verification the first read has already paid. Second, the pack
checksum does **not** cover the `.idx` beside it, so a tampered index could point
an oid at the wrong offset and pass. That is why `repackRepository` re-derives
every object's oid from its bytes before consolidating (`git-fs-s3`'s
`readAndVerifyObjects`) rather than trusting the read — the one place in this
app where a wrong answer would be written back to storage permanently.

## Bounded fan-out on push and merge

Both `collectReachableOids` (a push's validation walk, `git-fs-s3/http`) and
`mergeTrees` (`git-edge`) visit a tree's children concurrently, and a tree can
be arbitrarily wide. Unbounded, one push or merge of a wide directory issues one
object read per entry at once — enough to exhaust sockets or memory on a
serverless function and to trip storage rate limits. Both now bound in-flight
reads with a semaphore, releasing the permit *before* recursing into children so
the limit cannot deadlock against itself.

The diff path had the same shape plus one more: `diffTrees` read both sides of
every changed blob and only then applied `MAX_DIFF_TEXT_BYTES`, so a commit
touching many large files materialised all of them. The size gate now runs
before the read (via the object's size from its pack entry header, so nothing
large is ever loaded), and the remaining reads are bounded too.

## Client bundle size

Heavy, conditionally-rendered client dependencies are `React.lazy`-loaded at
every call site rather than imported directly: `MarkdownRenderer`
(`react-markdown`+`remark-gfm`+`rehype-highlight`, ~324KB) is lazy-loaded on
the tree page (repo home — the most-visited route in the app, most of whose
visits don't render a README at all) and in `CommentCard`; `CodeViewer`
(Shiki) is lazy-loaded on the blob page. Follow the same `lazy(() =>
import(...))` + `Suspense` pattern for any new heavy, conditionally-rendered
dependency — check the production build's chunk output (`pnpm build`, look at
`.vercel/output/static/assets/`) to confirm a new heavy import actually lands
in its own chunk rather than inflating a hot route's critical bundle.

Server code must not reach the browser either. TanStack Start strips server
function bodies from the client build but keeps each file's top-level
imports, so `apps/web/vite.config.ts` declares every module under `apps/web/src/db/` and
`apps/web/src/server/` free of side effects (`treeshake.moduleSideEffects`): once their
exports are unused, the bundler drops them. Before that, the Neon driver,
Drizzle and the schema shipped to every visitor (the `query-options` chunk
was 83 KB gzip; it's 16 KB). For the same reason `apps/web/src/start.ts` loads
Sentry's global middlewares with a server-only dynamic import — a static
import put the whole SDK in the main chunk, whose client halves are no-ops.
The main entry chunk is ~85 KB gzip; when it grows, check what's in it.
