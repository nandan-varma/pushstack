# Git Storage

This is the deepest, most performance-sensitive part of the codebase: how git
repository data is stored in Cloudflare R2, how reads and writes work without a
persistent local disk, and how the Git smart HTTP protocol is served without a
native `git` binary.

## Why R2, and why isomorphic-git

The deployment target is Vercel serverless functions — there is no persistent
disk, and no realistic way to bundle a native `git` binary into a function. So:

- **isomorphic-git** implements the git object model, protocol, and plumbing
  entirely in JS, against a pluggable `fs`-like interface. It doesn't care
  whether that interface is backed by a real filesystem or something else.
- **Cloudflare R2** (S3-compatible object storage) is that "something else" for
  read operations — every git object, ref, and pack file lives in R2 under a
  canonical key scheme, and `git-fs.ts` (built on the published `git-fs-s3`
  package) speaks R2 on isomorphic-git's behalf.

There is no native `git` binary anywhere in the codebase — including
`withRepositoryWorktree` in `git-repo-storage.ts`, which materializes a scratch
working directory for merge/checkout/commit-write flows using isomorphic-git's
own `git.checkout`/`git.commit`/`git.merge` against `{dir: worktreePath,
gitdir}`, rather than shelling out to a real checkout.

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
  repo name or username ultimately gets joined into a real local filesystem
  path (`getRepoPath` in `git-manager-iso.ts`) during write-hydration — an
  unsanitized `..` there would be a path traversal, not just an ugly R2 key.
  Repo names are additionally restricted at input validation
  (`repositories.ts`'s `repoNameSchema`) to a safe charset, and `getRepoPath`
  itself re-sanitizes and verifies the resolved path stays under the storage
  root as defense in depth. See [security.md](./security.md).

There is **no legacy storage path handling** — `getRepoStorageCoordinates()`
returns only `{ ownerKey, repoKey }`, no `legacyOwnerKeys` fallback array. If
you're tempted to add one for a migration, don't; handle that migration
explicitly instead.

## Reads: `git-fs.ts`

`git-fs.ts` composes pushstack's R2-backed isomorphic-git `fs` from decorators
the published `git-fs-s3` package provides, network-outward to gitdir-facing:

```
S3ObjectStore → createRetryStore → perfR2 (perf-log.ts) → createCachedStore → createGitFs
```

Gitdirs are the full storage roots (`repos/{ownerKey}/{repoName}/git`), so fs
paths map 1:1 onto R2 keys — the store is built with no key prefix. Each
layer's job:

- **`S3ObjectStore`** (`git-fs-s3/s3`) — the raw `GetObject`/`PutObject`/
  `DeleteObject`/`HeadObject`/`ListObjectsV2` calls against R2.
- **`createRetryStore`** — exponential backoff + jitter, plus a per-instance
  circuit breaker (5 consecutive non-404 failures within 30s opens it, failing
  fast instead of piling up retries against an R2 outage). Placed directly
  above the network store so the cache above it never stores a transient
  failure, and callers coalesced onto one request (see below) share a single
  retried attempt.
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
  - **Structurally-absent short-circuits** (`isStructurallyAbsent`) —
    `packed-refs` and `shallow` are probed by isomorphic-git on essentially
    every ref resolution or merge, but nothing in this codebase ever writes
    either (refs are always loose, never packed; shallow clones are never
    created or advertised — see `handleInfoRefsIso`'s capabilities line).
    These are *permanent* 404s, so `readFile`/`stat` return `ENOENT`
    immediately without touching R2 or even the cache above — the cache only
    helps a *repeat* lookup within a warm process, which doesn't help the
    first lookup, and doesn't help at all on a cold serverless invocation
    with an empty in-process cache (the common case on Vercel). Anchored to
    the gitdir layout, so a branch literally named `packed-refs`
    (`refs/heads/packed-refs`) is unaffected.
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

## Writes: hydrate → mutate → sync (`git-repo-storage.ts`)

Reads can go straight against R2 via `git-fs.ts`'s `gitFs`, but writes (push,
in-browser file edits, branch creation, merges) need real filesystem
semantics that an object-store-backed `fs` doesn't fully provide efficiently
(atomic multi-file writes, `git.commit`'s internal bookkeeping, etc.). So
every write operation:

1. **Hydrates** — `ensureRepositoryHydrated(ownerKey, repoName)` downloads the
   full current state of the repo from R2 down to a local directory under
   `GIT_REPOS_PATH` (defaults to `os.tmpdir()/pushstack-repos` — `/tmp` is the
   only writable directory on Vercel). Skipped if a fresh-enough hydration
   already happened (`repoState`'s `hydratedAt` vs. the repository's DB
   `updatedAt`).
2. **Mutates** — the actual git operation runs against the local bare repo
   using isomorphic-git with Node's real `fs`.
3. **Syncs back** — `syncRepositoryToR2` uploads whatever changed. Git objects
   are content-addressed and immutable, so it only uploads objects that don't
   already exist in R2 (checked against a 5-second-TTL cached R2 listing) —
   loose objects and packs are never re-uploaded once present. Mutable files
   (`HEAD`, `config`, `packed-refs`, everything under `refs/`) are always
   re-uploaded and stale ones are deleted. **This function itself never
   deletes anything under `objects/`** — a local checkout being transiently
   incomplete (a caching quirk, a mid-hydration race) must never be read as
   "this object should no longer exist in R2." The one caller allowed to
   delete specific objects is `handleReceivePackIso` (`git-http-iso.ts`),
   which explicitly deletes the exact R2 keys `repackRepository`
   (`git-fs-s3/http`) just proved redundant, *after* confirming the
   replacement pack synced successfully — see the receive-pack section
   below. This distinction used to be a real bug: the repack consolidation
   deleted old packs locally, but nothing told R2, so every
   push left one more permanent pack file behind forever.

All three steps run inside `withRepositoryLock(ownerKey, repoName, fn)`
(`git-repo-lock.ts`) — a distributed lease-row lock backed by Postgres (the
`repo_locks` table), one row per `{ownerKey}/{repoName}` key, so concurrent
writes to the same repo serialize instead of racing *even across different
serverless instances*. This app runs on Vercel, where a lock scoped to one
process's memory gives zero protection — two concurrent pushes to the same
repo can land on two different, unrelated function invocations with no shared
state at all. Acquire is a single atomic `INSERT ... ON CONFLICT DO UPDATE ...
WHERE expires_at < now() RETURNING` (works over Neon's stateless HTTP driver,
which can't hold a session-scoped `pg_advisory_lock` or a long-lived
transaction); release is a holder-scoped `DELETE`. The lease has a TTL (60s)
rather than being heartbeat-renewed — if a holder's function is killed
mid-critical-section (Vercel's execution limit), the repo self-recovers
instead of staying locked forever. See `acquireRepoLock`/`releaseRepoLock` in
`git-repo-lock.ts`, which also exports `withRepositoryLockIfR2` — for a write
path that goes R2-direct when configured but otherwise falls back to
`getRepoOptions`/`syncRepositoryToR2` (which already lock internally on the
non-R2 path), taking the lock only in the R2-direct branch avoids the
non-reentrancy deadlock below without every such call site re-deriving that
`if (isR2Configured())` branch by hand.

**It is not reentrant**: a function already holding the lock must never call
another function that tries to take it again for the same repo, or it
deadlocks (now: times out after ~65s and throws, rather than hanging
forever). This is why `withReceivePackLock` (used for `git push`) takes the
lock once and spans hydrate → mutate → sync as a single critical section,
rather than composing `ensureRepositoryHydrated` + some mutation +
`syncRepositoryToR2` as three separately-locked calls — that gap between
separately-acquired locks was a real race before `withReceivePackLock`
existed (a concurrent hydrate/push could interleave and clobber
not-yet-synced local state).

`getRepoOptions(ownerKey, repoName)` is the shared entry point nearly
everything in `src/server/git-*.ts` calls to get isomorphic-git's `{fs,
gitdir}` options — it hydrates first only when R2 isn't configured (local-disk
dev mode) or, when R2 is configured, resolves directly against `git-fs.ts`'s
`gitFs` with no hydration step, since reads don't need one.

After every sync, several caches are invalidated: the R2 listing cache,
`git-fs.ts`'s object/negative-marker/directory-listing caches for that repo,
the cached tree/commit result objects, and isomorphic-git's own per-repo
pack-index parse cache
(`invalidateRepoGitCache` — a repack rewrites pack files out from under any
already-parsed index, so it can't be trusted across a push).

### Renaming a repository (`renameRepositoryStorage`)

Every storage key/path in this layer is derived from the repository's
*current* `name`, read fresh from the DB — so renaming a repository has to
move its actual storage, not just update the DB row. `renameRepositoryStorage`
does that: for R2, it server-side-copies (`CopyObjectCommand`, no download/
upload round trip) every object under the old name's prefix to the new one,
then deletes the old keys only after every copy succeeds; for local-disk-only
mode, it's a plain `fs.rename` of the hydration directory (tolerating ENOENT
— nothing hydrated locally yet under the old name is not an error).

This function does **not** lock internally — `repositories.ts`'s
`updateRepository` wraps both the storage move *and* the DB row update in a
single `withRepositoryLock(ownerKey, repo.name, ...)` call, so a concurrent
hydration attempt for the old name can't observe a half-renamed state (old
storage partially copied, or DB already pointing at the new name while
storage hasn't moved yet). Skipping this migration entirely used to be the
bug: a rename changed only the DB row, so the very next access resolved
storage under the new (empty) prefix, silently initialized a brand-new empty
bare repo there, and permanently orphaned the old commit history under the
old prefix.

## The Git smart HTTP protocol (`git-http-iso.ts`)

This is what `git clone https://.../owner/repo.git`, `git fetch`, and `git
push` actually talk to — the catch-all route `src/routes/api/git.$.ts`
dispatches into it. The [Git HTTP smart protocol](https://git-scm.com/docs/http-protocol)
implementation itself (pkt-line framing, `info/refs?service=...`
advertisement, `upload-pack`/`receive-pack`, the reachability walk, ref-CAS
logic, and pack consolidation) lives in the published `git-fs-s3/http`
module now — `git-http-iso.ts` is a thin pushstack-specific wrapper around it
(this file used to hand-roll all of it before that extraction). What stays
here: auth checks, choosing R2-backed `gitFs` (reads) vs local hydrated disk
via `withReceivePackLock` (writes), wiring `perfStep`/`logWarn` into the
library's `HttpHooks`, and R2 stale-pack cleanup after a repack.

- **`handleInfoRefsIso`** — auth check, then delegates to `git-fs-s3/http`'s
  `handleInfoRefs`: lists all branches/tags/HEAD in parallel, resolves every
  ref's oid in parallel, and writes the pkt-line response.
- **`handleUploadPackIso`** (clone/fetch) — auth check, then `handleUploadPack`
  reads directly against `gitFs` (R2-backed), no local hydration needed, since
  this is a pure read path. Its response wraps the packfile in `side-band-64k`
  framing (`sideBandPackfile`), which `handleInfoRefs` advertises in the
  upload-pack capabilities line. Real native `git` tolerates a raw, unframed
  packfile stream when side-band isn't negotiated, but not every client does
  — isomorphic-git's own HTTP client (`GitSideBand.demux`) always assumes
  side-band framing regardless of what was negotiated, and silently spins
  forever parsing raw packfile bytes as bogus pkt-line headers if it isn't
  there. `handleUploadPackIso` wires `detectLooseObjectsHint` +
  `prefetchAllPacks` into `handleUploadPack`'s `beforeWalk` hook, so the
  reachability walk it runs internally (`collectReachableOids`) gets the same
  pack-prefetch/loose-hint treatment as the web UI's own history walks (see
  "Reads" above).
- **`handleReceivePackIso`** (push) — auth check, `parseReceivePackBody`, then
  runs `git-fs-s3/http`'s `applyReceivePack` under `withReceivePackLock`:
  hydrate the repo locally, apply the incoming pack (`indexPack`), apply ref
  updates (compare-and-swap per ref, in parallel — a multi-ref push like `git
  push --all` applies all of them concurrently since each only touches its
  own ref file), then `repackRepository` (also from `git-fs-s3/http`).

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

  `repackRepository` only deletes the superseded pack/idx files *locally* and
  returns their relative paths — `handleReceivePackIso` deletes the same keys
  from R2 itself (`deleteStalePacksFromR2`, pushstack's own function; the
  library has no notion of a secondary R2 copy), but only *after*
  `withReceivePackLock`'s automatic `syncRepositoryToR2` has already uploaded
  the new consolidated pack, so there's never a window where R2 has neither
  the old nor the new pack.

  That R2 deletion (`deleteStalePacksFromR2`) runs via `withReceivePackLock`'s
  `afterSync` hook — after the sync has confirmed the replacement consolidated
  pack is uploaded, but still *inside* the same lock the push itself holds
  (it used to run after that lock was released, purely to keep it off the
  push's critical path — see [performance.md](./performance.md)'s case study
  for why that traded away more correctness than this app's actual traffic
  needed). This closes the race against a *concurrent push's own hydration*
  (`writeRemoteFilesToDisk`, below) entirely: hydration can't start until the
  previous push's cleanup is done. It does not, and can't, close the same
  race against a lock-free clone/fetch's `objects/pack/` directory listing —
  reads never take this lock (see "Reads" above) — so that side still
  tolerates a transient 404 rather than locking every read against a
  background delete. Reproduced directly under concurrent load before this
  fix (15 clones racing a burst of pushes that kept crossing the repack
  threshold): most clones failed with "remote did not send all necessary
  objects" for the same oid that succeeded moments earlier or later, while
  `git fsck` on any successful clone confirmed nothing was ever actually
  corrupted. Two places read pack files based on a listing that can go stale
  this way:
  - `collectReachableOids` (serves clone/fetch) retries once, after a short
    delay, before marking an object genuinely missing — long enough for
    `deleteStalePacksFromR2`'s own cache invalidation (already necessary for
    correctness, see its comment) to have landed, so the retry observes the
    current pack list rather than the mid-transition snapshot the first
    attempt raced against. This tolerance stays, since this path is
    inherently still racing the delete.
  - `writeRemoteFilesToDisk` (`git-repo-storage.ts`, hydrates a repo to local
    disk before a push writes to it) tolerates a 404 on an individual file as
    "a concurrent push's repack just deleted this as redundant" and skips it,
    rather than letting an unhandled rejection crash the whole hydration —
    kept as defense in depth, though the locking fix above means this path
    shouldn't actually hit it anymore.

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
GIT_REPOS_PATH=/path/to/dir        # optional, default os.tmpdir()/pushstack-repos — local hydration dir
```

`GIT_CACHE_TTL` sizes the R2 read cache's *default* TTL — right for
content-addressed object reads, but `git-fs.ts`'s `refAwareTtl` overrides it
down to a fixed 5s for the mutable parts of a gitdir (`HEAD`, `refs/*`, and
the `objects/`/`objects/pack/` listings) via
`git-fs-s3`'s `ttlForKey` option — not tunable by this env var.
See [performance.md](./performance.md#ref-aware-ttl).
