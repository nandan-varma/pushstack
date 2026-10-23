---
title: "Git storage"
description: "How git data lives in Cloudflare R2 and is served without a native git binary."
---

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

```text
repos/{ownerKey}/{repoName}/git/{path-inside-the-bare-repo}
```

e.g. `repos/alice/my-repo/git/refs/heads/main`,
`repos/alice/my-repo/git/objects/pack/pack-abc123.pack`.

`apps/web/src/server/git-storage-naming.ts` is the **only** place that constructs these
keys — never build an R2 key by hand elsewhere in the codebase. Its key
functions:

- `ownerKeyOf(repo)` — the owner segment: the owner's username, which is
  required and immutable (see [authentication.md](/docs/internals/authentication)).
- `getRepoGitStorageRoot(ownerKey, repoName)` / `getRepoGitStoragePrefix` —
  the gitdir and its key prefix. Both check every segment against
  `STORAGE_NAME_RE` and throw rather than build a key from anything else: a
  segment becomes part of a gitFs path, which `git-fs-s3` normalizes
  (resolving `..`) before mapping onto a key, so an unchecked `..` would reach
  another repository's prefix. Repo names and usernames are restricted to the
  same pattern at input. See [security.md](/docs/internals/security).
- `parseRepoGitStorageKey(key)` — the inverse, for classifying keys.
- `getRepoReleaseStoragePrefix` / `getReleaseAssetKey(ownerKey, repoName, assetId)` —
  release assets, beside the git data at `repos/{ownerKey}/{repoName}/releases/{assetId}`. The
  key holds only the immutable asset id: names and labels are editable and live in the
  `release_assets` row. Renaming or deleting a repository moves or deletes this prefix with the
  git data. Downloads stream chunked `Range` reads (a buffered Vercel response is capped at 4.5 MB).
  Uploads of up to 4,000,000 bytes pass through a function; larger ones (up to 2 GiB) are `PUT`
  straight to R2 on a presigned URL, because a function request body is capped at 4.5 MB. The URL
  cannot bind a size, so finishing the upload (`…/assets/{id}/finish`) `HEAD`s the object and
  discards it unless its size equals the declared one. A single presigned `PUT` (R2 allows 5 GiB)
  is used rather than multipart: the 2 GiB cap fits, and there is no part bookkeeping to expire.

## The storage stack: `git-fs.ts`

`git-fs.ts` composes pushstack's R2-backed isomorphic-git `fs` from decorators
the published `git-fs-s3` package provides, network-outward to gitdir-facing:

```text
R2 store (git-fs-s3/fetch-s3, wired in apps/web/src/lib/r2.ts) → createRetryStore → perfR2 (perf-log.ts) → createCachedStore → createGitFs
```

Every git operation — clone, fetch, push, web-UI commits, merges, branch
changes — goes through this one stack.

Gitdirs are the full storage roots (`repos/{ownerKey}/{repoName}/git`), so fs
paths map 1:1 onto R2 keys — the store is built with no key prefix. Each
layer's job:

- **R2 store** (`git-fs-s3/fetch-s3`'s `createFetchS3Store`, configured from env by `apps/web/src/lib/r2.ts`) — the raw
  `GetObject`/`PutObject`/`DeleteObject`/`HeadObject`/`ListObjectsV2` (plus
  server-side `CopyObject`, used by renames) calls against R2's S3 API, signed
  with `aws4fetch` and sent with plain `fetch`: no AWS SDK, no `node:https`
  agent. Node's built-in fetch pools keep-alive connections itself. Each
  attempt has a timeout (`AbortSignal.timeout`: 30s for bodies, 10s for
  metadata calls); failures throw `S3HttpError` carrying
  `$metadata.httpStatusCode`, which the retry layer classifies. `git-fs.ts`
  owns the app's single instance.
- **`createRetryStore`** — exponential backoff + jitter, plus a per-instance
  circuit breaker (5 consecutive non-404 failures within 30s opens it, failing
  fast instead of piling up retries against an R2 outage). Placed directly
  above the network store so the cache above it never stores a transient
  failure, and callers coalesced onto one request (see below) share a single
  retried attempt. The default `isRetryable` (the library's `isRetryableError`: 5xx, 429, fetch's
  `TypeError` for a dropped connection, `TimeoutError`, Node socket codes) is used as is.
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
    itself is current). See [performance.md](/docs/internals/performance#caching-layers-front-to-back).
- **`createGitFs`** (`looseObjectHints: true`) — the actual `fs` interface
  isomorphic-git needs (`readFile`, `writeFile`, `unlink`, `readdir`, `mkdir`,
  `rmdir`, `stat`, `lstat`), plus:
  - **Registered gitdirs** (`registerGitdir`, exposed here as
    `registerRepoGitdir(ownerKey, repoName)`) — isomorphic-git stats the
    gitdir on every command and probes `packed-refs` and `shallow` on
    essentially every ref resolution or merge. Nothing in this codebase ever
    writes either file (refs are always loose, never packed; shallow clones
    are never created or advertised), and a repo's gitdir is known to exist once its DB row is found.
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
    never serve a false negative mid-push. `git-http.ts` calls it before upload-pack's
    reachability walk (`beforeWalk`).

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

**Ref names are qualified before resolving.** For a bare name,
isomorphic-git's `resolveRef` tries `<ref>`, `refs/<ref>`, `refs/tags/<ref>`
before `refs/heads/<ref>`, 404ing each time. This app's ref model is
branch-only, so `git-fs-s3`'s ops qualify bare names to `refs/heads/<name>`
(`qualifyBranchRef`) themselves; new code resolving a branch by name should
go through `git-read.ts` rather than isomorphic-git directly.

`getCommitLog` caches the deepest walk seen per head SHA and slices it for
shallower requests; commit history pages, file history and last-commit
lookups all reuse that one walk.

## Writes: straight to R2, under the repo lock

Writes use the same `gitFs` as reads — there is no local copy to hydrate or
sync back. Each write path builds git objects and updates refs directly:

- **Web-UI commits/deletes** (`git-write.ts`) — `git-fs-s3/ops`'s
  `commitFilesToBare`/`deleteFileFromBare`: blobs, then trees, then the commit,
  then the branch ref — no worktree, no index.
- **Merges** (`git-write.ts`'s `mergeBranches`) — `git-fs-s3/ops`'s
  `fastForwardMerge`, else `git-edge`'s `threeWayMerge` on the object graph.
- **Branch/HEAD changes** (`git-write.ts`) — ref writes.
- **Pushes and repacks** (`git-http.ts`, below) — the incoming pack and its
  index, CAS ref updates, pack consolidation.

The order makes every write safe to interrupt: objects land before any ref
names them, so a killed function leaves at most unreferenced objects (which
the next repack drops), never a ref pointing at something missing.

### Locking

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
error.

**It is not reentrant**: a function already holding the lock must never call
another function that tries to take it again for the same repo, or it
times out after ~65s and throws.

`repoFor(ownerKey, repoName)` (`git-repo.ts`) is the handle every git call
takes: `gitFs`, the registered gitdir, and the shared per-repo
isomorphic-git cache.

Writes through `gitFs` keep this instance's caches current on their own (the
cached store updates or drops the keys it writes and deletes). After a push
or repack, `afterRepositoryPush` additionally drops the repo's `ops.*` result
caches (keyed per head sha, so this frees superseded entries rather than
fixing staleness) and isomorphic-git's per-repo pack-index cache
(a repack replaces pack files). Other warm instances pick up moved refs and new packs
through the 5s ref-aware TTL (see "Ref-aware TTL" above).

### Renaming and deleting a repository

Every storage key in this layer is derived from the repository's *current*
`name`, read fresh from the DB — so renaming a repository has to move its
actual storage, not just update the DB row. `renameRepositoryStorage`
(`git-repo.ts`, via `git-fs.ts`'s `moveRepoStorage`) server-side-copies
(`CopyObject`, no download/upload round trip) every object under the old
name's prefix to the new one, then deletes the old keys only after every copy
succeeds.

This function does **not** lock internally — `repositories.ts`'s
`updateRepository` wraps both the storage move *and* the DB row update in a
single `withRepositoryLock(ownerKey, repo.name, ...)` call, so a concurrent
write for the old name can't observe a half-renamed state (old storage
partially copied, or DB already pointing at the new name while storage hasn't
moved yet). If the row update fails, the storage move is reverted.

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
nothing ever does. Wrap any new code that
writes objects in `withPackedWrites`. Web commits and merges call
`repackIfNeededUnlocked` afterwards, inside their lock, so their one-pack-
per-operation doesn't accumulate past the repack threshold.

Consolidation is best-effort on both write paths: it runs *after* the refs
have moved, so a failure is logged (`logWarn` in the app, `hooks.onWarn` in
`applyReceivePack`) and the commit or push stands — the next write retries the
repack. Only the explicit `repackRepositoryNow` maintenance action (the owner's
repository settings button) reports a failure to its caller; `repackRepository`
itself rejects so each caller makes that choice.

### Objects no ref names yet

A repack keeps only objects reachable from a branch or tag. The REST API's
Git database writes (`git-objects.ts`: `POST …/git/blobs`, `/trees`,
`/commits`, `/tags`) create objects *before* any ref names them — a client
commits by writing a blob, a tree, a commit and only then moving a ref — so a
repack landing between those requests would drop them. Their packs therefore
carry a `.keep` file (`keep-until <ISO date>`, a day out; `withPackedWrites`'
`keepUntil`). `repackRepository` leaves a kept pack in place and doesn't count
it towards the threshold; once the date passes, the pack and its `.keep` are
consolidated like any other and still-unreachable objects go, as git's gc
drops them after its grace period. A `.keep` with any other content (git's
own) protects its pack indefinitely.

## The Git smart HTTP protocol (`git-http.ts`)

This is what `git clone https://…/owner/repo.git`, `git fetch` and
`git push` talk to; the routes at the clone URL (`apps/web/src/routes/$owner.$name.info.refs.ts`,
`$owner.$name.git-upload-pack.ts`, `$owner.$name.git-receive-pack.ts`) call `serveGitRequest`. The
[protocol](https://git-scm.com/docs/http-protocol) itself (pkt-line framing,
ref advertisement, upload-pack/receive-pack, the reachability walk, ref CAS,
pack consolidation) is `git-fs-s3/http`. `serveGitRequest` does the rest:
route parsing (`parseGitUrl`: `/{owner}/{repo}[.git]/info/refs` or `/<service>`), the
streamed body cap, repo lookup, auth, the lock around pushes, perf hooks, and
post-push bookkeeping. Every service runs against `gitFs`.

- **info/refs** — `git-fs-s3/http`'s `handleInfoRefs`: lists all branches/tags/HEAD in parallel, resolves every
  ref's oid in parallel, and writes the pkt-line response.
- **upload-pack** (clone/fetch) — `handleUploadPack` reads directly against `gitFs`, lock-free. Its response wraps the packfile in `side-band-64k`
  framing (`sideBandPackfile`), which `handleInfoRefs` advertises in the
  upload-pack capabilities line. Real native `git` tolerates a raw, unframed
  packfile stream when side-band isn't negotiated, but not every client does
  — isomorphic-git's own HTTP client (`GitSideBand.demux`) always assumes
  side-band framing regardless of what was negotiated, and silently spins
  forever parsing raw packfile bytes as bogus pkt-line headers if it isn't
  there. Its pushes likewise always demux side-band, so receive-pack
  advertises it too. `git-user-lifecycle.test.ts` clones and pushes with
  isomorphic-git, `pnpm smoke:git` with native git. `detectLooseObjectsHint`
  and `prefetchAllPacks` run in the `beforeWalk` hook, so the reachability
  walk gets the same treatment as the web UI's history walks.
- **receive-pack** (push) — `parseReceivePackBody`, then `git-fs-s3/http`'s `applyReceivePack` against `gitFs` under
  `withRepositoryLock`: write the incoming pack to R2 and index it
  (`indexPack` writes the `.idx` beside it), verify the pushed tips' object
  graph is complete, apply ref updates (compare-and-swap per ref, in parallel
  — a multi-ref push like `git push --all` applies all of them concurrently
  since each only touches its own ref file), then `repackRepository` (also
  from `git-fs-s3/http`) — best-effort, so a failed consolidation is reported
  through `hooks.onWarn` and the push still succeeds — then
  `afterRepositoryPush`. The whole push body is held in memory, capped by
  `GIT_HTTP_MAX_BODY_BYTES` — enforced while streaming (`readGitRequestBody`),
  not just from `Content-Length`, which a chunked request doesn't send.
  Native Git gzip-compresses larger requests (including clone negotiations
  with many wanted refs); the app decodes `Content-Encoding: gzip` before
  parsing pkt-lines. The cap applies to both encoded and decoded bytes, so
  compression cannot bypass it. Malformed gzip returns 400; unsupported
  content encodings return 415. The report is side-band-64k framed when the
  client asked for it (git and isomorphic-git both do); a pack that can't be
  indexed is reported as `unpack index-pack failed`. Branches must point at
  commits, and deleting the branch `HEAD` names is refused.

  The library validates every client-supplied `refName` with
  `isSafeFullRefName` *before* any of `git.resolveRef`/`deleteRef`/`writeRef`
  runs on it — an invalid name gets `{ ok: false, reason: "invalid ref name"
  }` in the response instead of reaching those calls. This isn't redundant
  with `git.writeRef`'s own internal validation: the top-level
  `git.deleteRef` and `git.resolveRef` isomorphic-git exposes have **no**
  such check, and both resolve straight through `fs.rm`/`fs.read(join(gitdir,
  ref))` — a `"../"`-laden `refName` would otherwise let a push with write
  access to any one repo read, corrupt, or delete another repo's ref/object
  files that happen to sit under the same shared storage root (see
  [security.md](/docs/internals/security)'s "Names are single safe segments" for the rule,
  and [security-history.md](/docs/internals/security-history) for the incident that
  established it).
  The same validator (as `isSafeBranchName`, its bare-name variant, from
  `git-ref-name.ts`) guards every branch name accepted anywhere else in the
  app — `files.ts`/`pull-requests.ts`'s input schemas, and defense-in-depth
  checks in `git-write.ts` —
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
  flag), not an object count: packs can overlap, so old packs' summed counts
  overstate the deduplicated total.

  `repackRepository` writes and indexes the consolidated pack, verifies it
  holds every reachable object, and only then deletes the superseded
  `.pack`/`.idx` files — all through `gitFs`, so those deletes are the R2
  deletes; there's never a window where R2 has neither the old nor the new
  pack.

  A lock-free clone/fetch can still race that delete: it may have listed
  `objects/pack/` just before a concurrent push's repack removed one of the
  listed packs. Reads never take the write lock, so `collectReachableOids`
  (serves clone/fetch) tolerates it instead — it retries once, after a short
  delay, before marking an object genuinely missing, so the retry observes the
  current pack list rather than the mid-transition snapshot.

Auth for every git HTTP request goes through `apps/web/src/server/git-auth.ts` — see
[authentication.md](/docs/internals/authentication). Every git HTTP request (info/refs,
then upload-pack/receive-pack — at least two per operation) resolves the
target repository by owner+name; this goes through
`repository-lookup.ts`'s cached `findRepositoryByName`, shared with the web UI's
repo pages — so the
second request of a push typically gets a free cache hit instead of hitting
Postgres again.

## Environment variables that tune this layer

```bash
GIT_HTTP_MAX_BODY_BYTES=52428800   # optional, default 50MB — request body cap for push
GIT_CACHE_MAX_SIZE=1073741824      # optional, default 1GB — sizes git-fs.ts's raw R2 object cache directly; git-cache.ts's separate parsed-object cache (tree/commit results) budgets a quarter of this value
GIT_CACHE_TTL=3600                 # optional, default 1 hour (seconds)
```

`GIT_CACHE_TTL` sizes the R2 read cache's *default* TTL — right for
content-addressed object reads, but `git-fs.ts`'s `refAwareTtl` overrides it
down to a fixed 5s for the mutable parts of a gitdir (`HEAD`, `refs/*`, and
the `objects/`/`objects/pack/` listings) via
`git-fs-s3`'s `ttlForKey` option — not tunable by this env var.
See [performance.md](/docs/internals/performance#caching-layers-front-to-back).
