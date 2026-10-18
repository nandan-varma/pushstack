# Git Storage

This is the deepest, most performance-sensitive part of the codebase: how git
repository data is stored in Cloudflare R2, how reads and writes work with no
local disk at all, and how the Git smart HTTP protocol is served without a
native `git` binary.

## Why R2, and why isomorphic-git

The deployment target is Vercel serverless functions — there is no persistent
disk, and no realistic way to bundle a native `git` binary into a function. So:

- **isomorphic-git** implements the git object model, protocol, and plumbing
  entirely in JS, against a pluggable `fs`-like interface. It doesn't care
  whether that interface is backed by a real filesystem or something else.
- **Cloudflare R2** (S3-compatible object storage) is that "something else" —
  for reads *and* writes. Every git object, ref, and pack file lives in R2
  under a canonical key scheme, and `git-fs.ts` (built on the published
  `git-fs-s3` package) speaks R2 on isomorphic-git's behalf.

There is no native `git` binary anywhere in the codebase, and no local
filesystem either: no `/tmp` working copy, no hydrate/sync step, no scratch
worktree. Server code uses only Web APIs (`fetch`, WebCrypto, `TextEncoder`,
`CompressionStream`) plus `node:async_hooks` for perf-log's request context.
Without R2 env vars (unit tests, a quick local run), `git-fs.ts` backs the same
stack with an in-memory object store instead — repositories then last as long
as the process; production refuses to start that way.

## Storage key scheme

All git data for a repository lives at:

```
repos/{ownerKey}/{repoName}/git/{path-inside-the-bare-repo}
```

e.g. `repos/alice/my-repo/git/refs/heads/main`,
`repos/alice/my-repo/git/objects/pack/pack-abc123.pack`.

`src/server/git-storage-naming.ts` is the **only** place that constructs these
keys — never build an R2 key by hand elsewhere in the codebase. Its key
functions:

- `getStorageOwnerKey(owner)` — derives the owner segment from username (falls
  back to the email's local part, then the user id).
- `getRepoStorageCoordinates(repo)` — the usual entry point: given a
  repository row (with its `owner` relation loaded), returns `{ ownerKey,
  repoKey }`, both already sanitized.
- `sanitizeStorageSegment(value)` — replaces `/`/`\` and whitespace runs with
  `-`, and collapses a bare `.` or `..` segment to `_`. This exists because a
  repo name or username becomes part of a gitFs path, which `git-fs-s3`
  normalizes (resolving `..`) before mapping it onto an R2 key — an
  unsanitized `..` there would traverse into another repository's prefix, not
  just make an ugly key. Repo names are additionally restricted at input
  validation (`repositories.ts`'s `repoNameSchema`) to a safe charset. See
  [security.md](./security.md).

There is **no legacy storage path handling** — `getRepoStorageCoordinates()`
returns only `{ ownerKey, repoKey }`, no `legacyOwnerKeys` fallback array. If
you're tempted to add one for a migration, don't; handle that migration
explicitly instead.

## The storage stack: `git-fs.ts`

`git-fs.ts` composes pushstack's R2-backed isomorphic-git `fs` from decorators
the published `git-fs-s3` package provides, network-outward to gitdir-facing:

```
R2 store (src/lib/r2.ts) → createRetryStore → perfR2 (perf-log.ts) → createCachedStore → createGitFs
```

Every git operation — clone, fetch, push, web-UI commits, merges, branch
changes — goes through this one stack.

Gitdirs are the full storage roots (`repos/{ownerKey}/{repoName}/git`), so fs
paths map 1:1 onto R2 keys — the store is built with no key prefix. Each
layer's job:

- **R2 store** (`src/lib/r2.ts`'s `createR2ObjectStore`) — the raw
  `GetObject`/`PutObject`/`DeleteObject`/`HeadObject`/`ListObjectsV2` (plus
  server-side `CopyObject`, used by renames) calls against R2's S3 API, signed
  with `aws4fetch` and sent with plain `fetch`: no AWS SDK, no `node:https`
  agent. Node's built-in fetch pools keep-alive connections itself. Each
  attempt has a timeout (`AbortSignal.timeout`: 30s for bodies, 10s for
  metadata calls); failures throw `R2HttpError` carrying
  `$metadata.httpStatusCode`, which the retry layer classifies. `git-fs.ts`
  owns the app's single instance.
- **`createRetryStore`** — exponential backoff + jitter, plus a per-instance
  circuit breaker (5 consecutive non-404 failures within 30s opens it, failing
  fast instead of piling up retries against an R2 outage). Placed directly
  above the network store so the cache above it never stores a transient
  failure, and callers coalesced onto one request (see below) share a single
  retried attempt. `git-fs.ts` passes its own `isRetryable` (5xx, 429, fetch's
  `TypeError` for a dropped connection, and `TimeoutError`) — the default
  policy only knows Node socket error codes.
- **`createCachedStore`** — an in-process LRU read cache
  (`GIT_CACHE_MAX_SIZE`/`GIT_CACHE_TTL`-tunable, default 1GB / 1h), with:
  - **Request coalescing** (on by default) — if 100 concurrent object reads
    all want the same not-yet-cached pack file, only one R2 `GetObject`
    fires; the other 99 await the same in-flight promise. Covers `get`/
    `head`/`list` independently, so e.g. several concurrent ref/branch
    lookups that each stat the gitdir root on a cold cache also collapse to
    one real round trip instead of one each.
  - **Negative-result caching** (`cacheMisses: true`) — a loose-object probe
    on a packed repo is almost always a miss; caching "this key doesn't
    exist" avoids repeating the same doomed round trip.
  - **Directory-listing caching** (`cacheLists: true`) — `readdir`/existence
    probes. A non-empty `limit: 1` probe ("this directory exists") survives
    writes underneath it, since adding a key below a prefix can't make that
    prefix stop existing; empty probes and full listings are dropped on any
    write/delete that could affect them.
  - **Ref-aware TTL** (`git-fs.ts`'s `refAwareTtl`, passed as `ttlForKey`) —
    the cache's long default TTL is right for content-addressed object keys (a
    given key's bytes never change) but wrong for the mutable parts of a
    gitdir: a ref moves on every push, and the `objects/`/`objects/pack/`
    listings grow on every push, while the *key* naming either stays the
    same. Since this cache is in-process per server instance with no
    cross-instance invalidation, a warm instance that isn't the one handling
    a given push could otherwise keep serving a pre-push ref, or fail to
    discover a freshly pushed pack exists at all, for up to the full TTL.
    `refAwareTtl` gives `HEAD`, `refs/*`, and the two listing paths a
    5-second override instead — cheap (each is one small object or a bounded
    listing) and safe (everything downstream, keyed by the sha a fresh ref
    resolves to, still gets the full-length cache benefit once the structure
    itself is current). See [performance.md](./performance.md#ref-aware-ttl).
- **`createGitFs`** (`looseObjectHints: true`) — the actual `fs` interface
  isomorphic-git needs (`readFile`, `writeFile`, `unlink`, `readdir`, `mkdir`,
  `rmdir`, `stat`, `lstat`), plus:
  - **Registered gitdirs** (`registerGitdir`, exposed here as
    `registerRepoGitdir(ownerKey, repoName)`) — isomorphic-git stats the
    gitdir on every command and probes `packed-refs` and `shallow` on
    essentially every ref resolution or merge. Nothing in this codebase ever
    writes either file (refs are always loose, never packed; shallow clones
    are never created or advertised — see `handleInfoRefsIso`'s capabilities
    line), and a repo's gitdir is known to exist once its DB row is found.
    Registering the gitdir with `absentFiles: ["packed-refs", "shallow"]`
    answers all three with **zero** R2 calls — not even a cached miss, which
    wouldn't help a cold serverless invocation's empty cache (the common case
    on Vercel). `absentFiles` names top-level gitdir files only, so a branch
    literally named `packed-refs` (`refs/heads/packed-refs`) is unaffected.
  - **Loose-object hint** (`detectLooseObjects`, exposed here as
    `detectLooseObjectsHint(ownerKey, repoName)`) — most repositories are
    fully packed, so *every distinct commit* a reachability walk touches
    probes a loose-object path (`objects/xx/yyyy...`) that's guaranteed to
    404 — and since each commit has a different oid, the negative-result
    cache above never gets reused within one walk (60 commits = 60
    guaranteed-failing R2 round trips, serially). One cheap bounded
    `ListObjectsV2` call (relying on S3 key ordering: loose-object dirs
    `00`–`ff` sort before `info`/`pack`) tells us up front whether the repo
    has *any* loose objects at all; if not, every loose-object `readFile`
    short-circuits to an immediate `ENOENT` with zero network calls. Flips
    back to "present" the instant a loose write actually lands, so it can
    never serve a false negative mid-push. Called from both `getCommitLog`
    (commit-log browsing) *and* `handleUploadPackIso` (real `git clone`/`git
    fetch` traffic, via `collectReachableOids`'s `beforeWalk` hook).

`prefetchAllPacks(ownerKey, repoName)` (`git-fs.ts`, wrapping `GitFs.prefetchPacks`)
is the other major lever: since walking
a commit chain is inherently sequential (you only learn the next oid to fetch
after reading the current commit), a deep `git.log` would otherwise pay one R2
round trip *per commit* whenever that commit isn't already in a downloaded
pack. Downloading every pack file in parallel *before* the sequential walk
starts turns "N sequential round trips" into "a few parallel downloads, then N
in-memory reads." Bounded by `prefetchPacks`'s own `maxPacks` option (default
30, skipped past `maxPacks * 2` pack files) so a repo with a long, fragmented
pack history doesn't pull down far more data than a shallow request actually
needs.

**Qualify ref names before resolving them.** isomorphic-git's `resolveRef`
(and `git.merge`'s own internal `GitRefManager.expand`) try several candidate
paths in sequence for a bare ref name — `<ref>`, `refs/<ref>`,
`refs/tags/<ref>`, `refs/heads/<ref>`, `refs/remotes/<ref>`,
`refs/remotes/<ref>/HEAD` — 404ing (or stat-ing) the first three every time
before reaching the one this app's ref model actually uses. This codebase's
ref model is branch-only, never tags, so `qualifyBranchRef` (`git-repo-storage.ts`)
maps a bare name straight to `refs/heads/<name>` up front; every call site
that resolves a branch by name (`git-history-ops.ts`, `git-diff-iso.ts`,
`git-merge-iso.ts`, including `git.merge`'s `ours`/`theirs`) should use it
rather than passing the bare name through and letting isomorphic-git pay the
scan. Left alone: already-qualified refs, `"HEAD"` (its own first candidate,
already optimal), and 40-char oids (resolved locally, no I/O at all).

`getCommitLog()` (`git-history-ops.ts`) additionally caches the deepest
commit-chain walk seen per resolved head SHA and slices/reuses it for
shallower or repeated requests, so repeat visits to the same branch at
different depths don't re-walk from scratch.

## Writes: straight to R2, under the repo lock

Writes use the same `gitFs` as reads — there is no local copy to hydrate or
sync back. Each write path builds git objects and updates refs directly:

- **Web-UI commits/deletes** (`git-commit-write.ts`) — `git-fs-s3/ops`'s
  `commitFilesToBare`/`deleteFileFromBare`: blobs, then trees, then the commit,
  then the branch ref — no worktree, no index.
- **Merges** (`git-merge-iso.ts`) — `git-fs-s3/ops`'s `fastForwardMerge`, else
  `git-edge`'s `threeWayMerge` on the object graph.
- **Branch/HEAD changes** (`git-branch-ops.ts`) — ref writes.
- **Pushes and repacks** (`git-http-iso.ts`, below) — the incoming pack and its
  index, CAS ref updates, pack consolidation.

The order makes every write safe to interrupt: objects land before any ref
names them, so a killed function leaves at most unreferenced objects (which
the next repack drops), never a ref pointing at something missing.

Every write runs inside `withRepositoryLock(ownerKey, repoName, fn)`
(`git-repo-lock.ts`) — a distributed lease-row lock backed by Postgres (the
`repo_locks` table), one row per `{ownerKey}/{repoName}` key, so concurrent
writes to the same repo serialize instead of racing *even across different
serverless instances*. This app runs on Vercel, where a lock scoped to one
process's memory gives zero protection — two concurrent pushes to the same
repo can land on two different, unrelated function invocations with no shared
state at all. Acquire is a single atomic `INSERT ... ON CONFLICT DO UPDATE ...
WHERE expires_at < now() RETURNING` (works over Neon's stateless HTTP driver,
which can't hold a session-scoped `pg_advisory_lock` or a long-lived
transaction); release is a holder-scoped `DELETE`. The lease has a 60s TTL
that a live holder renews every 20s (a holder-scoped `UPDATE ... RETURNING`),
so a long push or repack never has its lock taken over mid-write; if a
holder's function is killed mid-critical-section (Vercel's execution limit),
it stops renewing and the repo self-recovers within one TTL instead of
staying locked forever. A renewal that finds the lease gone is logged as an
error. See `acquireRepoLock`/`releaseRepoLock` in
`git-repo-lock.ts`.

**It is not reentrant**: a function already holding the lock must never call
another function that tries to take it again for the same repo, or it
deadlocks (now: times out after ~65s and throws, rather than hanging
forever).

`getRepoOptions(ownerKey, repoName)` (`git-repo-storage.ts`, the same thing as
`git-manager-iso.ts`'s `getBareRepoOptions`) is the shared entry point nearly
everything in `src/server/git-*.ts` calls to get isomorphic-git's `{fs,
gitdir, cache}` options — always `gitFs`, the registered gitdir, and the
shared per-repo isomorphic-git cache.

Writes through `gitFs` keep this instance's caches current on their own (the
cached store updates or drops the keys it writes and deletes). After a push
or repack, `afterRepositoryPush` additionally drops the repo's `ops.*` result
caches (keyed per head sha, so this frees superseded entries rather than
fixing staleness) and isomorphic-git's per-repo pack-index cache
(`invalidateRepoGitCache` — a repack replaces pack files), then records the
repo's stored size (`repositories.diskUsage`, one `ListObjectsV2`) without
delaying the response. Other warm instances pick up moved refs and new packs
through the 5s ref-aware TTL (see "Ref-aware TTL" above).

### Renaming and deleting a repository

Every storage key in this layer is derived from the repository's *current*
`name`, read fresh from the DB — so renaming a repository has to move its
actual storage, not just update the DB row. `renameRepositoryStorage`
(`git-repo-storage.ts`, via `git-fs.ts`'s `moveRepoStorage`) server-side-copies
(`CopyObject`, no download/upload round trip) every object under the old
name's prefix to the new one, then deletes the old keys only after every copy
succeeds.

This function does **not** lock internally — `repositories.ts`'s
`updateRepository` wraps both the storage move *and* the DB row update in a
single `withRepositoryLock(ownerKey, repo.name, ...)` call, so a concurrent
write for the old name can't observe a half-renamed state (old storage
partially copied, or DB already pointing at the new name while storage hasn't
moved yet). Skipping this migration entirely used to be the bug: a rename
changed only the DB row, so the very next access resolved storage under the
new (empty) prefix, and permanently orphaned the old commit history under the
old prefix.

`deleteRepositoryStorage` lists the repo's prefix and deletes every key.
`deleteRepository` deletes the DB row first, then runs it under the repo lock
(so an in-flight push can't land new objects after the listing); a storage
cleanup that fails afterwards only leaves unreachable objects. Those can't
leak into a later repository of the same name: `createRepository` inserts
its row first (the unique index decides a creation race before any storage
is touched), then, under the lock, clears whatever is still under the prefix
before `initBareRepo` — and rolls the row back if that fails.

## No loose objects, ever

Every write stores its objects as packs: pushes (the incoming pack), web-UI
commits and merges (`git-fs-s3`'s `withPackedWrites` — one pack per
operation, flushed before the ref moves), and repacks. That's what keeps the
loose-object hint correct across instances: a warm instance that once saw "no
loose objects" in a repo can't be told when another instance writes one, so
nothing ever does (repositories that already have loose objects from before
keep the hint "present" — correct, just not as fast). Wrap any new code that
writes objects in `withPackedWrites`. Web commits and merges call
`repackIfNeededUnlocked` afterwards, inside their lock, so their one-pack-
per-operation doesn't accumulate past the repack threshold.

## The Git smart HTTP protocol (`git-http-iso.ts`)

This is what `git clone https://.../owner/repo.git`, `git fetch`, and `git
push` actually talk to — the catch-all route `src/routes/api/git.$.ts`
dispatches into it. The [Git HTTP smart protocol](https://git-scm.com/docs/http-protocol)
implementation itself (pkt-line framing, `info/refs?service=...`
advertisement, `upload-pack`/`receive-pack`, the reachability walk, ref-CAS
logic, and pack consolidation) lives in the published `git-fs-s3/http`
module now — `git-http-iso.ts` is a thin pushstack-specific wrapper around it
(this file used to hand-roll all of it before that extraction). What stays
here: auth checks, the repo lock around pushes, wiring `perfStep`/`logWarn`
into the library's `HttpHooks`, and post-push bookkeeping. Every service runs
against `gitFs`.

- **`handleInfoRefsIso`** — auth check, then delegates to `git-fs-s3/http`'s
  `handleInfoRefs`: lists all branches/tags/HEAD in parallel, resolves every
  ref's oid in parallel, and writes the pkt-line response.
- **`handleUploadPackIso`** (clone/fetch) — auth check, then `handleUploadPack`
  reads directly against `gitFs`, lock-free. Its response wraps the packfile in `side-band-64k`
  framing (`sideBandPackfile`), which `handleInfoRefs` advertises in the
  upload-pack capabilities line. Real native `git` tolerates a raw, unframed
  packfile stream when side-band isn't negotiated, but not every client does
  — isomorphic-git's own HTTP client (`GitSideBand.demux`) always assumes
  side-band framing regardless of what was negotiated, and silently spins
  forever parsing raw packfile bytes as bogus pkt-line headers if it isn't
  there. (The same assumption breaks isomorphic-git *pushes*: its `push`
  always requests and demuxes `side-band-64k` even though receive-pack never
  advertises it, so it can't parse the plain report-status `receivePackResponse`
  sends. Fixed in git-fs-s3 0.8: receive-pack now advertises side-band-64k
  and frames its report when asked. `git-user-lifecycle.test.ts` pushes with
  isomorphic-git, and `pnpm smoke:git` with native git.) `handleUploadPackIso` wires `detectLooseObjectsHint` +
  `prefetchAllPacks` into `handleUploadPack`'s `beforeWalk` hook, so the
  reachability walk it runs internally (`collectReachableOids`) gets the same
  pack-prefetch/loose-hint treatment as the web UI's own history walks (see
  "The storage stack" above).
- **`handleReceivePackIso`** (push) — auth check, `parseReceivePackBody`, then
  runs `git-fs-s3/http`'s `applyReceivePack` against `gitFs` under
  `withRepositoryLock`: write the incoming pack to R2 and index it
  (`indexPack` writes the `.idx` beside it), verify the pushed tips' object
  graph is complete, apply ref updates (compare-and-swap per ref, in parallel
  — a multi-ref push like `git push --all` applies all of them concurrently
  since each only touches its own ref file), then `repackRepository` (also
  from `git-fs-s3/http`), then `afterRepositoryPush`. The whole push body is
  held in memory, capped by `GIT_HTTP_MAX_BODY_BYTES` — enforced while
  streaming (`readGitRequestBody`), not just from `Content-Length`, which a
  chunked request doesn't send. The report is side-band-64k framed when the
  client asked for it (git and isomorphic-git both do); a pack that can't be
  indexed is reported as `unpack index-pack failed`. Branches must point at
  commits, and deleting the branch `HEAD` names is refused.

  Every ref-update command's client-supplied `refName` is validated with
  `isSafeFullRefName` *before* any of `git.resolveRef`/`deleteRef`/`writeRef`
  runs on it — an invalid name gets `{ ok: false, reason: "invalid ref name"
  }` in the response instead of reaching those calls. This isn't redundant
  with `git.writeRef`'s own internal validation: the top-level
  `git.deleteRef` and `git.resolveRef` isomorphic-git exposes have **no**
  such check, and both resolve straight through `fs.rm`/`fs.read(join(gitdir,
  ref))` — a `"../"`-laden `refName` would otherwise let a push with write
  access to any one repo read, corrupt, or delete another repo's ref/object
  files that happen to sit under the same shared storage root (see
  [security.md](./security.md)'s "Path traversal via git branch/ref names").
  The same validator (as `isSafeBranchName`, its bare-name variant, from
  `git-ref-name.ts`) guards every branch name accepted anywhere else in the
  app — `files.ts`/`pull-requests.ts`'s input schemas, and defense-in-depth
  checks in `git-branch-ops.ts`/`git-commit-write.ts`/`git-merge-iso.ts` —
  since `git.commit`/`git.merge`/`git.deleteBranch` have the same
  no-internal-validation gap and are reachable from ordinary web-UI actions
  (branch delete, PR merge), not just a raw git push.

  `repackRepository` consolidates all local pack files into one, but only
  when the pack count is already at or above `REPACK_PACK_COUNT_THRESHOLD`
  (4) — below that, it's a no-op. Consolidating is O(total repo object count)
  (a full reachability traversal + independent re-verification of every
  object's SHA-1 + `packObjects` + `indexPack` over *everything*, not just
  what this push added), so doing it on every single push would make push
  latency grow with total repo size forever instead of with the size of the
  just-pushed delta; the threshold defers that cost until pack fragmentation
  actually matters.

  Its safety check for whether the old packs are actually safe to delete is
  traversal **completeness** (did every object the reachability walk visited
  actually get read successfully — `collectReachableOids`'s `complete`
  flag), not an object-count comparison. An earlier count-based check (new
  consolidated pack's object count vs. sum of old packs' counts) was
  structurally broken: once packs ever overlap in content, the old side
  double-counts objects present in more than one old pack, so it almost
  always came out higher than the new deduplicated count — which permanently
  refused to ever consolidate again after the first time it happened. That's
  exactly how a repo can end up with many packs despite this function running
  on every push.

  `repackRepository` writes and indexes the consolidated pack, verifies it
  holds every reachable object, and only then deletes the superseded
  `.pack`/`.idx` files — all through `gitFs`, so those deletes are the R2
  deletes; there's never a window where R2 has neither the old nor the new
  pack. (This used to be a real bug in the hydrate/sync design: the repack
  deleted old packs from the local copy, nothing told R2, and every push left
  one more permanent pack file behind.)

  A lock-free clone/fetch can still race that delete: it may have listed
  `objects/pack/` just before a concurrent push's repack removed one of the
  listed packs. Reads never take the write lock, so `collectReachableOids`
  (serves clone/fetch) tolerates it instead — it retries once, after a short
  delay, before marking an object genuinely missing, so the retry observes the
  current pack list rather than the mid-transition snapshot. Reproduced
  directly under concurrent load before that tolerance existed (15 clones
  racing a burst of pushes that kept crossing the repack threshold): most
  clones failed with "remote did not send all necessary objects" for the same
  oid that succeeded moments earlier or later, while `git fsck` on any
  successful clone confirmed nothing was ever actually corrupted.

Auth for every git HTTP request goes through `src/server/git-auth.ts` — see
[authentication.md](./authentication.md). Every git HTTP request (info/refs,
then upload-pack/receive-pack — at least two per operation) resolves the
target repository by owner+name; this goes through
`repositories.ts`'s `findRepositoryByName`, which is the same cached,
single-join `fetchRepoRowByName` the web UI's repo pages use — so the
second request of a push typically gets a free cache hit instead of hitting
Postgres again.

## Environment variables that tune this layer

```
GIT_HTTP_MAX_BODY_BYTES=52428800   # optional, default 50MB — request body cap for push
GIT_CACHE_MAX_SIZE=1073741824      # optional, default 1GB — sizes git-fs.ts's raw R2 object cache directly; git-cache.ts's separate parsed-object cache (tree/commit results) budgets a quarter of this value
GIT_CACHE_TTL=3600                 # optional, default 1 hour (seconds)
```

`GIT_CACHE_TTL` sizes the R2 read cache's *default* TTL — right for
content-addressed object reads, but `git-fs.ts`'s `refAwareTtl` overrides it
down to a fixed 5s for the mutable parts of a gitdir (`HEAD`, `refs/*`, and
the `objects/`/`objects/pack/` listings) via
`git-fs-s3`'s `ttlForKey` option — not tunable by this env var.
See [performance.md](./performance.md#ref-aware-ttl).
