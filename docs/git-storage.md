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
  canonical key scheme, and a custom `fs` plugin (`git-r2-backend.ts`) speaks
  R2 on isomorphic-git's behalf.

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

## Reads: `git-r2-backend.ts`

`R2Backend` implements the subset of the `fs` interface isomorphic-git needs
(`readFile`, `writeFile`, `unlink`, `readdir`, `mkdir`, `rmdir`, `stat`,
`lstat`) by translating every call into R2 `GetObject`/`PutObject`/`ListObjectsV2`/etc
calls, plus caching:

- **Buffer cache** (`git-cache.ts`'s `getCache`/`setCache`) — every successful
  `readFile` populates it; a hit skips R2 entirely.
- **Negative-result / stat markers** (`getCachedObject`/`setCachedObject`,
  same module, different LRU instance) — isomorphic-git repeatedly probes
  paths it expects might not exist (candidate ref paths, loose-object paths
  before falling back to pack search, directory existence checks before
  reads). Each of those 404s or stat results gets cached as a `{kind:
  "missing"}` or `{kind: "dir"}` marker so the *same* doomed lookup isn't
  repeated against R2 on every call within a request (or across requests,
  within the cache's TTL). Writing a file only ever clears a `"missing"`
  ancestor-directory marker, never a `"dir"` one — a write underneath a
  directory can only ever keep it a directory, so clearing an already-correct
  `"dir"` marker just forces the next `stat()` (isomorphic-git re-stats the
  gitdir root before nearly every read/write) to redo a full round trip for a
  fact that hadn't changed. This one-directional rule (`clearStaleAncestorMarkers`)
  used to be the single biggest cost in `createCommit`: every object written in
  a single commit was invalidating the gitdir root's own `"dir"` marker,
  turning one commit into several seconds of repeated `HeadObject`+`ListObjects`
  pairs against the same key.
- **Structurally-absent files** (`isStructurallyAbsent`) — `packed-refs` and
  `shallow` are probed by isomorphic-git on essentially every ref resolution
  or merge, but nothing in this codebase ever writes either (refs are always
  loose, never packed; shallow clones are never created or advertised — see
  `handleInfoRefsIso`'s capabilities line). These are *permanent* 404s, not
  merely usually-missing ones, so `readFile`/`stat` short-circuit to ENOENT
  without touching R2 or even the marker cache above — the marker cache only
  helps a *repeat* lookup within a warm process, which doesn't help the first
  lookup, and doesn't help at all on a cold serverless invocation with an
  empty in-process cache (the common case on Vercel).
- **Loose-object hint** (`detectLooseObjectsHint`) — a further optimization
  layered on top of the marker cache. Most repositories are fully packed, so
  *every distinct commit* a reachability walk touches probes a loose-object
  path (`objects/xx/yyyy...`) that's guaranteed to 404 — and since each commit
  has a different oid, the per-key negative-result cache above never gets
  reused within one walk (60 commits = 60 guaranteed-failing R2 round trips,
  ~85ms each, serially). One cheap bounded `ListObjectsV2` call (relying on S3
  key ordering: loose-object dirs `00`–`ff` sort before `info`/`pack`) tells us
  up front whether the repo has *any* loose objects at all; if not, every
  loose-object `readFile` short-circuits to an immediate ENOENT with zero
  network calls. Flips back to "present" the instant `writeFile` actually
  writes a loose object, so it can never serve a false negative mid-push.
  Called from both `getCommitLog`'s `prefetchAllPacks` (commit-log browsing)
  *and* `handleUploadPackIsoInner`'s general path (real `git clone`/`git
  fetch` traffic, via `collectReachableOids`) — it used to only run from the
  former, so any clone/fetch against a repo with more than one accumulated
  pack (i.e. one that hasn't hit `REPACK_PACK_COUNT_THRESHOLD` yet) paid the
  full per-object tax that this hint exists to avoid.
- A directory's own R2 key can coincide with its storage-prefix representation
  (the gitdir root's `relativePath` is `""`, and `getRepoGitStoragePrefix`
  already returns a trailing `/`) — the directory-listing fallback in
  `resolveStatFromR2` normalizes the trailing slash before appending one,
  rather than assuming the key never already ends in `/`. Getting this wrong
  for the root specifically meant its directory listing always came back
  empty (a double-slash prefix matches no real single-slash key), permanently
  miscaching the gitdir root as `"missing"` — so the marker-cache hit path
  above was dead code for the one directory that's *always* present, and
  every isomorphic-git call paid the full round trip every time.
- **Request coalescing** (`pendingDownloads` map) — if 100 concurrent object
  reads all want the same not-yet-cached pack file, only one R2 `GetObject`
  fires; the other 99 await the same in-flight promise. `stat()` has the same
  problem in a different shape: isomorphic-git fires several *concurrent*
  calls (`listBranches`/`listTags`/`resolveRef(HEAD)`/`currentBranch`, e.g. in
  `git-http-iso.ts`'s `listAllRefs`) that each independently stat the gitdir
  root before doing their own work — on a cold cache all of them miss at the
  same instant (none can see a result the others haven't produced yet), so the
  marker cache above doesn't help; measured 4 concurrent callers as 4 real
  `HeadObject`+`ListObjects` pairs against the identical key. A second map,
  `pendingStats`, coalesces these the same way.

`prefetchAllPacks(ownerKey, repoName)` is the other major lever: since walking
a commit chain is inherently sequential (you only learn the next oid to fetch
after reading the current commit), a deep `git.log` would otherwise pay one R2
round trip *per commit* whenever that commit isn't already in a downloaded
pack. Downloading every pack file in parallel *before* the sequential walk
starts turns "N sequential round trips" into "a few parallel downloads, then N
in-memory reads." Bounded by `MAX_PACKS_TO_PREFETCH` so a repo with a long,
fragmented pack history doesn't pull down far more data than a shallow request
actually needs.

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

Reads can go straight against R2 via `R2Backend`, but writes (push, in-browser
file edits, branch creation, merges) need real filesystem semantics that
`R2Backend` doesn't fully provide efficiently (atomic multi-file writes,
`git.commit`'s internal bookkeeping, etc.). So every write operation:

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
   which explicitly deletes the exact R2 keys `repackLocal` just proved
   redundant, *after* confirming the replacement pack synced successfully —
   see the receive-pack section below. This distinction used to be a real
   bug: repackLocal deleted old packs locally, but nothing told R2, so every
   push left one more permanent pack file behind forever.

All three steps run inside `withRepositoryLock(ownerKey, repoName, fn)` — a
simple promise-chain mutex, one per `{ownerKey}/{repoName}` key, so concurrent
writes to the same repo serialize instead of racing. **It is not reentrant**:
a function already holding the lock must never call another function that
tries to take it again for the same repo, or it deadlocks. This is why
`withReceivePackLock` (used for `git push`) takes the lock once and spans
hydrate → mutate → sync as a single critical section, rather than composing
`ensureRepositoryHydrated` + some mutation + `syncRepositoryToR2` as three
separately-locked calls — that gap between separately-acquired locks was a
real race before `withReceivePackLock` existed (a concurrent hydrate/push
could interleave and clobber not-yet-synced local state).

`getRepoOptions(ownerKey, repoName)` is the shared entry point nearly
everything in `src/server/git-*.ts` calls to get isomorphic-git's `{fs,
gitdir}` options — it hydrates first only when R2 isn't configured (local-disk
dev mode) or, when R2 is configured, resolves directly against `R2Backend`
with no hydration step, since reads don't need one.

After every sync, several caches are invalidated: the R2 listing cache, the
`R2Backend` buffer/negative-marker caches for that repo, the cached tree/commit
result objects, and isomorphic-git's own per-repo pack-index parse cache
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
dispatches into it. It's a from-scratch implementation of the [Git HTTP smart
protocol](https://git-scm.com/docs/http-protocol) (pkt-line framing,
`info/refs?service=...` advertisement, `upload-pack`/`receive-pack`), not a
wrapper around a native `git http-backend`.

- **`handleInfoRefsIso`** — the initial ref advertisement for both clone/fetch
  and push. Lists all branches/tags/HEAD in parallel, resolves every ref's oid
  in parallel, and writes the pkt-line response.
- **`handleUploadPackIso`** (clone/fetch) — reads directly against `r2Backend`,
  no local hydration needed, since this is a pure read path. Its response
  wraps the packfile in `side-band-64k` framing (`sideBandPackfile`), which
  `handleInfoRefsIso` advertises in the upload-pack capabilities line. Real
  native `git` tolerates a raw, unframed packfile stream when side-band isn't
  negotiated, but not every client does — isomorphic-git's own HTTP client
  (`GitSideBand.demux`) always assumes side-band framing regardless of what
  was negotiated, and silently spins forever parsing raw packfile bytes as
  bogus pkt-line headers if it isn't there. Don't drop this framing without
  confirming isomorphic-git-based clients can still parse the response.
- **`handleReceivePackIso`** (push) — runs under `withReceivePackLock`: hydrate
  the repo locally, apply the incoming pack (`indexPack`), apply ref updates
  (compare-and-swap per ref, in parallel — a multi-ref push like `git push
  --all` applies all of them concurrently since each only touches its own ref
  file), then `repackLocal`.

  Every ref-update command's client-supplied `refName` is validated with
  `isSafeFullRefName` (`git-ref-name.ts`) *before* any of
  `git.resolveRef`/`deleteRef`/`writeRef` runs on it — an invalid name gets
  `{ ok: false, reason: "invalid ref name" }` in the response instead of
  reaching those calls. This isn't redundant with `git.writeRef`'s own
  internal validation: the top-level `git.deleteRef` and `git.resolveRef`
  isomorphic-git exposes have **no** such check, and both resolve straight
  through `fs.rm`/`fs.read(join(gitdir, ref))` — a `"../"`-laden `refName`
  would otherwise let a push with write access to any one repo read, corrupt,
  or delete another repo's ref/object files that happen to sit under the same
  shared storage root (see [security.md](./security.md)'s "Path traversal via
  git branch/ref names"). The same validator (as `isSafeBranchName`, its
  bare-name variant) guards every branch name accepted anywhere else in the
  app — `files.ts`/`pull-requests.ts`'s input schemas, and defense-in-depth
  checks in `git-branch-ops.ts`/`git-commit-write.ts`/`git-merge-iso.ts` —
  since `git.commit`/`git.merge`/`git.deleteBranch` have the same
  no-internal-validation gap and are reachable from ordinary web-UI actions
  (branch delete, PR merge), not just a raw git push.

  `repackLocal` consolidates all local pack files into one, but only when
  `countLocalPacks` is already at or above `REPACK_PACK_COUNT_THRESHOLD` (4) —
  below that, it's a no-op. Consolidating is O(total repo object count) (a
  full reachability traversal + `packObjects` + `indexPack` over *everything*,
  not just what this push added), so doing it on every single push would make
  push latency grow with total repo size forever instead of with the size of
  the just-pushed delta; the threshold defers that cost until pack
  fragmentation actually matters.

  Its safety check for whether the old packs are actually safe to delete is
  traversal **completeness** (did every object the reachability walk visited
  actually get read successfully — `collectReachableOids`'s `complete` flag),
  not an object-count comparison. An earlier count-based check (new
  consolidated pack's object count vs. sum of old packs' counts) was
  structurally broken: once packs ever overlap in content, the old side
  double-counts objects present in more than one old pack, so it almost
  always came out higher than the new deduplicated count — which permanently
  refused to ever consolidate again after the first time it happened. That's
  exactly how a repo can end up with many packs despite this function running
  on every push.

  `repackLocal` only deletes the superseded pack/idx files *locally* and
  returns their relative paths — `handleReceivePackIso` deletes the same keys
  from R2 itself, but only *after* `withReceivePackLock`'s automatic
  `syncRepositoryToR2` has already uploaded the new consolidated pack, so
  there's never a window where R2 has neither the old nor the new pack.

  That R2 deletion (`deleteStalePacksFromR2`) deliberately runs *after* the
  push's lock has already been released, so cleanup doesn't hold up the push
  response — but that leaves a real window where a concurrent reader's
  `objects/pack/` directory listing (or a concurrent *push*'s own hydration,
  see below) can name pack files that get deleted moments later. This is
  never actual data loss — the replacement consolidated pack is always
  uploaded before the old ones are removed — but a single object read or file
  download landing in that gap sees a genuine 404 for content that exists
  fine elsewhere. Reproduced directly under concurrent load (15 clones racing
  a burst of pushes that kept crossing the repack threshold): most clones
  failed with "remote did not send all necessary objects" for the same oid
  that succeeded moments earlier or later, while `git fsck` on any successful
  clone confirmed nothing was ever actually corrupted. Two places read pack
  files based on a listing that can go stale this way, and both now tolerate
  it instead of treating it as fatal:
  - `collectReachableOids` (serves clone/fetch) retries once, after a short
    delay, before marking an object genuinely missing — long enough for
    `deleteStalePacksFromR2`'s own cache invalidation (already necessary for
    correctness, see its comment) to have landed, so the retry observes the
    current pack list rather than the mid-transition snapshot the first
    attempt raced against.
  - `writeRemoteFilesToDisk` (`git-repo-storage.ts`, hydrates a repo to local
    disk before a push writes to it) now tolerates a 404 on an individual
    file as "a concurrent push's repack just deleted this as redundant" and
    skips it, rather than letting an unhandled rejection crash the whole
    hydration — and with it, that push's entire HTTP response — with a 500.

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
GIT_CACHE_MAX_SIZE=1073741824      # optional, default 1GB — shared budget for both LRU caches in git-cache.ts
GIT_CACHE_TTL=3600                 # optional, default 1 hour (seconds)
GIT_REPOS_PATH=/path/to/dir        # optional, default os.tmpdir()/pushstack-repos — local hydration dir
```
