---
title: "Performance"
description: "Caching tiers, parallelism and the perf-log convention."
---

## Caching tiers, front to back

1. **TanStack Query** — tiers defined in `apps/web/src/lib/query-options.ts`:
   session 60s, default 2min, long-lived 10min, immutable (`Infinity`) for
   content addressed by SHA. A long `staleTime` needs the longer `gcTime`: the
   5min default would collect an unobserved entry before it ever went stale,
   silently refetching what `staleTime` said was fresh. Pick the tier matching
   how often the data changes; defaulting to the shortest refetches on every
   navigation.
2. **Access decisions** (`repo-access.ts`) — 4s TTL keyed by (repo, user), with
   in-flight coalescing: one page load fans out to several server functions
   each asking the same question. The short TTL is deliberate — a perf cache,
   not a correctness one, so a revoked collaborator takes seconds to apply.
3. **Parsed git results** (`git-cache.ts`) — ops results keyed by head sha, plus
   a separate LRU of small pack slices, so a repeated file view costs no R2
   call. Raw object bytes cache one layer down, in `git-fs.ts`.
4. **Mutable gitdir paths** — `refAwareTtl` gives `HEAD`, `refs/*` and the
   `objects/` listings 5s instead of the 1h default. Refs move on every push
   while their keys stay the same, and the cache is per instance with no
   cross-instance invalidation, so a warm instance would otherwise serve a
   pre-push ref or deny that a freshly pushed pack exists.
5. **Negative answers and loose objects** — absent files, cached misses and one
   bounded LIST telling whether the repo has any loose objects at all; see
   [git-storage.md](/docs/internals/git-storage).
6. **`getCommitLog`** caches the deepest walk per head SHA and slices it, so
   history pages, file history and last-commit lookups share one walk.
7. **Diffs** (`getCommitDiff`, `getDiffBetweenRefs`,
   `getDirectDiffBetweenRefs`) are memoized by the two immutable commit ids and
   the work limits, in the same parsed-object cache. A ref that moves to a new
   commit produces a new key, so this cache can never serve a stale diff; a
   compare page re-opened on the same pair costs microseconds.
8. **Repo rows** (`findRepositoryByName`) — short TTL and coalescing; every git
   operation makes two HTTP requests, so the second one hits it.
9. **Writes go straight to R2** — a push costs the pack upload and a few ref
   writes, independent of repository size apart from the repack threshold.

## Unblock the route, then parallelise

A loader should await only what the HTML needs. Everything else goes through
`contentQuery`/`backgroundQuery` (`apps/web/src/lib/prefetch.ts`): a query
resolved on the server but not awaited settles after the HTML is written, and
the page then hydrates against data the server never rendered. The two helpers
split "the server waits" from "the browser only".

Where calls have no data dependency, use `Promise.all` or prefetching: resolve
a git request's refs together, prefetch a walk's packs in parallel before the
sequential walk, apply a multi-ref push's updates concurrently (one ref file
each), and walk tree history in batches whose reads are prefetched together.

Some things are inherently sequential — a commit walk only reveals the next oid
after reading the current commit, and an access decision must exist before a
gated query runs. Fix those by caching or prefetching around the sequential
part, never by fighting the dependency. When a structural fix lands at some
call sites, `grep` for every place with the same shape.

## perf-log

A request middleware runs each request in a `perfContext`, so it has one id
(`X-Request-Id`, also `X-GitHub-Request-Id` on `/api/v3`). Nested contexts
become steps of the outer request, and `logError` tags Sentry events with it.
`perfStep` times an awaited sub-call, `perfR2` also tallies R2 calls and time,
`perfNote` adds a note, and `db/index.ts` records every statement's text (never
its parameters). On request end the whole tree prints as one block; a request
slower than `SLOW_REQUEST_MS` also logs a warning and a Sentry breadcrumb, and
`/api/debug/perf` shows the last 50 trees in dev.

It is off in production — on with `PUSHSTACK_PERF_LOG=1` on the server, or
`localStorage["pushstack:perf-log"]` in a browser (Settings → Developer) — so
wrap new read-path server functions in `perfContext` and their meaningful
sub-calls in `perfStep`. That breakdown is how every fix here was found.

## Freshness signalling

Long `staleTime`s mean a page can show data someone else has since changed.
Instead of shortening them, `useBranchUpdateBanner` adds a 60s
`refetchInterval` with `refetchIntervalInBackground` to the *same* query
`CommitSummaryBar` already reads: one cache entry serves both "is there
something new" and "what is new", and a backgrounded tab is already correct
when the user returns. Reload awaits `invalidateQueries(["repos", repoId])`,
which covers every repo-scoped key and refetches only mounted queries, so the
banner dismisses knowing everything is current. Reach for a separate minimal
query only when the display data is too expensive to poll on a timer.

## R2 resilience

Every call goes through `createRetryStore`: backoff and jitter per attempt,
each bounded by `AbortSignal.timeout` (30s for bodies, 10s for metadata) so a
stalled connection fails into the retry loop, plus a breaker (5 consecutive
non-404 failures in 30s) that fails fast during an outage. A 404 is never a
failure. `git-fs.ts` owns the app's single store instance.

isomorphic-git SHA-1s a whole pack the first time it reads from it in a
process, so a cold instance reading one object from a large pack pays the full
hash first. That is upstream and it is what makes a corrupt pack fail loudly.
The pack checksum does not cover its `.idx`, which is why the repack re-derives
every object's oid from its bytes before consolidating.

## Bounded fan-out

Trees are arbitrarily wide. `collectReachableOids` and `mergeTrees` bound
in-flight reads with a `p-limit` pool, releasing the permit before recursing so
the limit cannot deadlock, and `diffTrees` checks each object's size from its pack
entry header before reading, so a commit touching many large files never loads
them.

## Measure before changing

`pnpm perf:git` (in `apps/web`) prints cold and warm p50 for every git read
path against the local data dir. Use it before and after a storage change:
an optimization that only moves numbers on the second call is a cache, and one
that does not move them is noise.

## Client bundle

Server-function files keep their top-level imports in the client bundle (only
handler bodies are stripped), so a module that a route imports as a value must
not drag zod or a server dependency in: `site-stats.ts` imports the contract
inside its handler, and `wiki-slug.ts` holds the page-name rules apart from
`wiki-page.ts`'s schema because the markdown renderer runs in the browser.
Validate the graph by grepping the built chunks, not by reading imports.

Heavy, conditionally rendered dependencies are `React.lazy` with `Suspense` at
every call site: `MarkdownRenderer` on the repo home and in `CommentCard`,
`CodeViewer` on the blob page. `apps/web/vite.config.ts` marks `src/db/` and
`src/server/` side-effect free so unused exports drop out of the client bundle,
and server-only imports (Sentry's middlewares, openpgp) are dynamic so the SDK
stays out of the main chunk and out of module init. Check the build's chunk
output rather than trusting an import list.
