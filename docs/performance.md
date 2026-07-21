# Performance

This codebase has had multiple dedicated performance passes — cold-start repo
page loads were measured at several seconds before these existed. This doc
covers the caching layers, the instrumentation convention used to diagnose
slowness, and the biggest fixes made, as case studies for the kind of thing to
watch for when adding new code.

## Caching layers, front to back

1. **TanStack Query** (client + SSR) — tiered `staleTime`/`gcTime` per data
   shape, all defined in `src/lib/query-options.ts`:
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
   lifetime). See [authentication.md](./authentication.md).

3. **`git-cache.ts`'s in-process parsed-object cache** (server, per-process) —
   stores JS values directly (`getCachedObject`/`setCachedObject`), used for
   both real results (tree listings, commit logs) and negative/stat markers,
   avoiding a JSON round-trip on every hit. The *raw* `Buffer` cache for git
   object bytes read from R2 used to live here too, but has since moved into
   `git-fs-s3`'s own `createCachedStore` (composed in
   `git-fs.ts`) as part of extracting the R2 backend into that published
   package (see item 4 below).

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
   (passed as `git-fs-s3` 0.3.4+'s `ttlForKey` option) gives
   `HEAD`, `refs/*`, and the two listing paths a 5-second override instead —
   cheap, since each is one small object or a bounded listing, and safe,
   since everything downstream (tree/commit/blob reads keyed by the sha a
   fresh ref resolves to) still gets the full-length cache benefit once the
   structure itself is current.

4. **Negative-result and loose-object-hint caching** — isomorphic-git
   repeatedly probes paths it expects might not exist (ref candidates,
   loose-object paths before falling back to pack search, directory-existence
   checks before every read). This now lives in `git-fs-s3`
   itself (`createGitFs`'s `looseObjectHints`/`isStructurallyAbsent` options,
   wired in `git-fs.ts`) rather than the app's own former
   `git-r2-backend.ts`, which was extracted into that published package —
   see [git-storage.md](./git-storage.md) for the current architecture.
   `detectLooseObjectsHint` still answers "does this repo have any loose
   objects at all" once per repo with a single bounded LIST call, so a
   fully-packed repo (the common case) never even attempts a loose-object
   probe against R2 — this was the single biggest fix to commit-log
   cold-load time, and (once wired into the actual clone/fetch-serving path,
   not just commit-log browsing) to cold clones too.

5. **`getCommitLog`'s per-head-SHA result cache** (`git-history-ops.ts`) —
   caches the deepest commit-chain walk seen for a resolved head SHA and
   slices/reuses it for shallower or repeated requests, since walking a commit
   chain is inherently sequential and R2-round-trip-bound.

6. **R2 request coalescing** — `git-fs-s3`'s
   `createCachedStore` (`coalesce` option, on by default; formerly
   `git-r2-backend.ts`'s own `pendingDownloads`/`pendingStats` maps before
   the R2 backend was extracted into that package) ensures concurrent reads
   for the same not-yet-cached R2 key (e.g. 100 object reads all wanting the
   same pack file mid-walk, or several concurrent ref/branch lookups that
   each independently stat the gitdir root) share one backend call instead
   of firing one each — on a cold cache, none of them can see a result the
   others haven't produced yet; measured 4 concurrent callers as 4 real
   `HeadObject`+`ListObjects` pairs against the identical key before this
   existed.

7. **`repositories.ts`'s repo-row cache** (`fetchRepoRowByName`, 5-second TTL
   + in-flight coalescing) — a single-join, cached lookup that both the web
   UI's `getRepositoryByName` and git-auth's `findRepositoryByName` share.
   Every git HTTP operation makes at least two requests (info/refs, then
   upload-pack/receive-pack), and `findRepositoryByName` used to be two
   sequential, fully uncached queries paid fresh on *every single one* of
   them; routing it through the same cache the web pages already used means
   the second request of a push typically gets a free hit.

## Parallelism over sequential waiting

Route loaders and server functions favor `Promise.all` wherever calls don't
have a real data dependency on each other. Some concrete examples already in
the codebase, worth matching the shape of when adding new code:

- The tree page's loader only `await`s `repositoryByNameQueryOptions` (fast —
  one DB row) — `repositoryBranchesQueryOptions`, `repositoryFilesQueryOptions`,
  `repositoryLastCommitsQueryOptions`, the `limit: 1`
  `repositoryCommitsQueryOptions` call, and the README content query are all
  **fire-and-forgotten** (`ensureQueryData(...).catch(() => {})`, not
  awaited), so the route commits and the page mounts the moment `repo`
  resolves instead of blocking on whichever of those four is slowest. Each
  section (`FileTable`, `CommitSummaryBar`, the branch selector, ...) reads
  the *same* query key client-side via its own `useQuery`, picks up the
  already-in-flight fire-and-forgotten request, and renders a skeleton
  matching its own final layout until that specific piece resolves — this
  used to be one blocking `Promise.all` before the loader was restructured
  to stream; see [server-functions.md](./server-functions.md).
- `git-fs-s3/http`'s `listAllRefs` (used by `git-http-iso.ts`'s
  thin wrapper) resolves branches, tags, HEAD's oid, and the current-branch
  symref all in parallel, then resolves every branch/tag's oid in parallel
  too.
- `git-fs.ts`'s `prefetchAllPacks` (a thin wrapper around
  `git-fs-s3`'s `GitFs.prefetchPacks`) downloads every pack
  file in parallel *before* a sequential `git.log` walk starts, rather than
  letting isomorphic-git fetch packs lazily and serially as the walk needs
  them. As of `getTreeFromRef`/`getCommitLog`'s current wiring this now
  fires unconditionally on a cache-miss tree read, and unconditionally (not
  depth-gated) for any commit-log walk too — see
  [git-storage.md](./git-storage.md).
- `git-http-iso.ts`'s `handleReceivePackIso` applies every ref update in a
  push (compare-and-swap check, then write/delete) in one `Promise.all` —
  each ref only touches its own ref file, so a multi-ref push (`git push
  --all`/`--tags`) applies them all concurrently instead of one at a time.
- `git-last-commit.ts`'s `getLastCommitsForTree` walks commit history in
  fixed-size batches, prefetching each batch's tree reads in parallel before
  processing that batch sequentially (the "which entries are still
  unresolved" state must advance commit-by-commit for correctness) — this
  two-phase shape (parallel prefetch, then sequential resolve) was previously
  the single largest contributor to slow repo page loads before it existed
  (measured: ~36s of a ~39s cold load), and should be preserved if this
  function is ever touched again.

Some things are **inherently sequential and can't be parallelized away** — a
commit chain walk only reveals the next oid to fetch after reading the
current commit, and a resolved access decision has to exist before a gated
query runs. The fix in those cases is caching/prefetching around the
sequential part, not fighting the dependency.

## Case study: a "safety check" that was itself the bug

`git-http-iso.ts`'s `repackLocal` consolidates a push's fragmented pack files
into one, but for a long time the consolidation only ever happened *locally*
— nothing told R2 to delete the packs it had just made redundant
(`syncRepositoryToR2Unlocked` deliberately never deletes anything under
`objects/`, for good reason — see [git-storage.md](./git-storage.md)). The
result: every single push left one more permanent pack file in R2, forever,
making both future pushes (more to hydrate) and clones (more packs to
prefetch) slower as history grew — completely defeating the point of
consolidating in the first place.

Fixing that alone wasn't enough, because `repackLocal`'s own safety check
(only delete old packs if the new pack's object count is at least as high as
the old packs' combined count — a guard against an incomplete traversal
silently losing objects) was **structurally broken**: the moment packs ever
overlap in content, the "old" side double-counts objects that appear in more
than one old pack, so it almost always comes out higher than the new
deduplicated count. Once that happened once, it happened every time after —
a permanent, silent lockout from ever consolidating again. This is why a
repo can accumulate many packs despite the consolidation code running (and
"succeeding," from its own perspective) on every push.

The lesson: **a safety check's assumptions can quietly stop holding once
something it depends on has already partially failed once.** The count
comparison assumed old packs were always disjoint — true until the very
first time the check itself declined to clean up. The fix replaced the
count comparison with a check on the actual property that matters
(traversal completeness — did every object the walk visited get read
successfully), which doesn't have that failure mode.

## Case study: a deliberate performance choice reopening a correctness gap

`deleteStalePacksFromR2` (the R2 half of the fix above) runs *after*
`withReceivePackLock`'s lock is released, on purpose — so a push's HTTP
response doesn't wait on cleanup that isn't needed for the push itself to be
correct. That's a reasonable performance trade-off in isolation, but it
opens a window: a concurrent reader's `objects/pack/` directory listing (a
clone/fetch's `collectReachableOids`, or another push's own hydration step)
can be taken *before* that deletion runs and still be in use *after* it
completes, naming pack files that no longer exist.

This was invisible under the testing that normally exercises this code
(sequential pushes, one clone at a time) — it only showed up under a
deliberately adversarial load test: 15 clones running concurrently against a
repo being pushed to in a tight loop, each push crossing the repack
threshold. Most of those clones failed with `fatal: bad object <sha>` /
"remote did not send all necessary objects" — always the *same* oid within a
given run, and always one that cloned fine moments before or after. `git
fsck` on every successful clone confirmed the object was never actually
missing anywhere; the failing requests were racing a real but narrow
transition window, not observing real data loss.

The fix in both places that read a pack listing this way (`collectReachableOids`
in `git-http-iso.ts`, `writeRemoteFilesToDisk` in `git-repo-storage.ts`) isn't
"take a lock" — locking a read against a background delete would reintroduce
exactly the latency this deferred-delete design exists to avoid, for a race
that's rare and whose content is never actually gone. It's **retry once, and
tolerate a 404 as "superseded," instead of treating either as fatal**: the
read side gets one retry after a short delay (long enough for the deletion's
own cache invalidation, which already existed for correctness, to land); the
hydration side skips a 404'd file outright, since a file that a repack just
deleted as redundant is, by construction, safe to skip.

The lesson: **when a performance decision means "this cleanup can happen
later, off the critical path," anything reading the state it cleans up needs
to tolerate seeing it mid-transition** — not by locking (which defeats the
reason the decision was made) but by treating a transient inconsistency as
recoverable rather than fatal, if and only if you can show it really is
(here: the replacement pack is always written before the old ones are
removed, so nothing a reader wants is ever actually gone).

## The `perf-log` instrumentation convention

Two parallel modules, same idea, different sides of the request:

- **`src/server/perf-log.ts`** (server): `perfContext(label, fn)` wraps a
  `createServerFn` handler in an AsyncLocalStorage-based context (so nested
  calls don't need it threaded through every function signature);
  `perfStep(label, fn)` times an awaited sub-call and nests under the active
  context; `perfR2(label, fn)` (used inside `r2-operations.ts`) additionally
  tallies R2 call count/time onto the context, printed in the `perfContext`
  summary line at the end (e.g. `■ done in 2721ms (r2: 39 calls / 16378ms,
  cache: 123 hit / 36 miss)`).
- **`src/lib/perf-log.ts`** (client/SSR): `perfTime`/`perfMark`, used in route
  loaders and `query-options.ts` queryFns — prefixed `[perf:ssr]` or
  `[perf:client]` so the same request's client-perceived latency can be
  compared against the server-side breakdown printed by the module above.

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
cheap as a bare ref resolve (`git-history-ops.ts`'s `PREFETCH_PACKS_MIN_DEPTH`
is 1 — effectively no gate, every cache-miss walk prefetches regardless of
depth; see [server-functions.md](./server-functions.md)), so there's no perf
reason to keep a minimal endpoint around just to avoid the walk.

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
[server-functions.md](./server-functions.md)), so one partial-match
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

## R2 resilience (`src/lib/r2-operations.ts`)

Every R2 call goes through retry-with-exponential-backoff-and-jitter
(`withRetry`) and a circuit breaker (5 consecutive non-404 failures within 30s
opens the circuit, failing fast instead of piling up retries against an R2
outage). 404s are explicitly excluded from tripping the breaker — a missing
object is expected, everyday behavior, not a sign R2 itself is unhealthy.
`getR2Client()` (`src/lib/r2.ts`) is a lazily-created singleton `S3Client`
with an explicit keep-alive `https.Agent` — a single page load can fire
hundreds of object reads, so TCP connection reuse matters; never construct a
second `S3Client`.

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
