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

3. **`git-cache.ts`'s two in-process LRU caches** (server, per-process,
   `GIT_CACHE_MAX_SIZE`/`GIT_CACHE_TTL`-tunable):
   - A raw `Buffer` cache for git object bytes read from R2.
   - A parsed-object cache storing JS values directly (`getCachedObject`/
     `setCachedObject`) — used for both real results (tree listings, commit
     logs) and negative/stat markers (see next layer), avoiding a JSON
     round-trip on every hit.

4. **`git-r2-backend.ts`'s negative-result and loose-object-hint caching** —
   isomorphic-git repeatedly probes paths it expects might not exist (ref
   candidates, loose-object paths before falling back to pack search,
   directory-existence checks before every read). Each 404 gets cached as a
   `{kind: "missing"}` marker; each confirmed directory as `{kind: "dir"}`.
   Layered on top, `detectLooseObjectsHint` answers "does this repo have any
   loose objects at all" once per repo with a single bounded LIST call, so a
   fully-packed repo (the common case) never even attempts a loose-object
   probe against R2 — see [git-storage.md](./git-storage.md) for the full
   story; this was the single biggest fix to commit-log cold-load time.

5. **`getCommitLog`'s per-head-SHA result cache** (`git-history-ops.ts`) —
   caches the deepest commit-chain walk seen for a resolved head SHA and
   slices/reuses it for shallower or repeated requests, since walking a commit
   chain is inherently sequential and R2-round-trip-bound.

6. **R2 request coalescing** — `git-r2-backend.ts`'s `pendingDownloads` map
   ensures concurrent reads for the same not-yet-cached R2 key (e.g. 100
   object reads all wanting the same pack file mid-walk) share one download
   instead of firing 100.

## Parallelism over sequential waiting

Route loaders and server functions favor `Promise.all` wherever calls don't
have a real data dependency on each other. Some concrete examples already in
the codebase, worth matching the shape of when adding new code:

- The tree page's loader fires `repositoryBranchesQueryOptions`,
  `repositoryFilesQueryOptions`, `repositoryLastCommitsQueryOptions`, and a
  `limit: 1` `repositoryCommitsQueryOptions` all in one `Promise.all` (only
  the initial `repositoryByNameQueryOptions` call blocks it, since everything
  else needs the resolved `repo.id`). It also **fire-and-forgets** (doesn't
  await) prefetches for issue/PR reference numbers and the README's content —
  those aren't needed to render the loader's own response, just likely to be
  needed moments later by the client, so there's no reason to hold the
  response on them.
- `git-http-iso.ts`'s `listAllRefs` resolves branches, tags, HEAD's oid, and
  the current-branch symref all in parallel, then resolves every
  branch/tag's oid in parallel too.
- `git-r2-backend.ts`'s `prefetchAllPacks` downloads every pack file in
  parallel *before* a sequential `git.log` walk starts, rather than letting
  isomorphic-git fetch packs lazily and serially as the walk needs them.
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
