# Changelog

Releases of `git-fs-s3`, derived from this repository's release history. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- `createSemaphore(limit)` and its `Semaphore` type are exported from the
  package root (git-edge now uses this one instead of its own copy).
- `git-fs-s3/testing` entry: `createFakeS3({ bucket, pageSize? })`, an
  in-memory `fetch` speaking enough of the S3 REST API to drive
  `createFetchS3Store` (and its SigV4 signing) in tests without a network
  (pushstack#169).

### Changed

- `collectReachableOids` (receive-pack's connectivity check, repack) no
  longer inflates every new blob to prove it exists: blob presence and type
  come from pack entry headers in one `getObjectTypes` batch. A full push of
  a ~9.7k-object repository: receive-pack 2.1 s to 1.2 s; the walk alone
  ~1 s to ~0.2 s. A blob is reported missing when its stored object is not a
  blob, as `git fsck` would.
- `findPackIndexOffset` (behind `getObjectSize`, `getObjectSizes` and
  `getObjectTypes`) binary-searches the `.idx` fanout instead of decoding and
  hex-encoding the whole index on every lookup. Sizing a 635-blob tree against
  a ~10k-object pack drops from ~2.5 s to ~20 ms. An entry past 2 GiB now
  answers `null` on its own rather than making the whole index unreadable.
- `createCachedStore`'s `getRange` slices a whole object already in the cache
  (a prefetched pack) instead of asking the backend. A cold pull-request read
  (`GET /pulls/:n`) that had prefetched its pack still made ~150 range reads
  for diff size gates; it now makes none.

### Fixed

- Refs that collide as file and directory (`refs/heads/a` and
  `refs/heads/a/b`) are refused, as git refuses them: `createBranchFrom`
  throws `GitConflictError` and receive-pack rejects the update ("cannot lock
  ref"), including two such creations in one push. New
  `findRefCollision(repo, ref)` (pushstack#160).

## [0.18.0] - 2026-10-21

### Added

- `withPackedWrites(repo, fn, { keepUntil })` writes a `.keep` file
  (`keep-until <ISO date>`) next to each pack it stores. `repackRepository`
  leaves such packs alone until that date: their objects survive even when
  no ref reaches them yet (a REST client's blob, tree and commit before its
  ref update), and they don't count towards the repack threshold. Once
  expired, the pack and its `.keep` are consolidated away like any other.
  A `.keep` with other content (git's own) protects its pack indefinitely.
- `RepackOptions.now`: the time `.keep` expiries are checked against.
- `consolidateKeptPacks(repo, { threshold, keepUntil, now })`: merge
  unexpired `keep-until` packs into one kept pack once `threshold` of them
  accumulate, reading only those packs, so objects written ahead of a ref
  don't pile up as one small pack each until their keeps expire.
- `getObjectTypes(repo, oids)`: each object's type (or `null` when absent)
  from pack entry headers — following delta chains to their base — and
  loose-object headers, without inflating any object body.

## [0.17.0] - 2026-10-20

### Added

- `getObjectSizes(repo, oids)`: `getObjectSize` for many objects in few range
  reads. Pack indexes are read once and neighbouring pack entries share one
  read (gaps up to 64 KiB, at most 1 MiB per read); a 60-file directory listing
  went from 61 storage calls to 2 (pushstack#124). At most 8 range reads are
  in flight per call.

### Fixed

- `getObjectSize`/`getObjectSizes`: a failed pack directory listing now throws
  instead of reading as "no packs" (only a missing directory is empty).

## [0.16.0] - 2026-10-20

### Added

- `createCachedStore` now caches small `getRange` reads (new `maxRangeBytes`
  option, default 64 KiB, `0` disables), in their own LRU capped at a quarter
  of `maxBytes`. Range reads used to bypass the cache entirely, so every view
  of a packed blob cost one R2 range GET even when repeated (#79). Slices are
  keyed by offsets, coalesced, and dropped by `put`, `delete` and `invalidate`.
- `resolveCommitOid(repo, rev)` in `git-fs-s3/ops`: resolves a branch, tag,
  `HEAD`, full ref, full sha or abbreviated sha (4+ hex digits) to a commit
  oid, so callers can read and cache by the immutable oid (pushstack#104).

## [0.15.3] - 2026-10-20

### Changed

- `repackRepository` now rejects when consolidation fails instead of
  swallowing the error and returning no stale paths, including when listing
  the pack directory fails (#92; only a missing directory — an empty
  repository — still reads as "nothing to consolidate"). Best-effort is a call-site
  decision: `applyReceivePack` still treats a repack after a push as best-effort
  (the refs have moved, so a failed consolidation is reported through
  `hooks.onWarn` and the push succeeds), while an explicit maintenance repack
  now reports its failure. Silently returning `[]` made every caller — including
  a post-write repack in pushstack, where a failure read as a failed commit —
  unable to tell a failed consolidation from one with nothing to do.

### Fixed

- Ref and `HEAD` reads in `ops` no longer turn a failed read into "absent"
  (#93): `deleteBranchByName` used to skip its default-branch guard when
  `HEAD` couldn't be read (isomorphic-git's `deleteBranch` then detaches
  `HEAD` instead of refusing), and `listTags`, `listBranches`'
  `packed-refs`/`HEAD` reads and the info-refs advertisement silently dropped
  a tag or branch whose read failed. Only a not-found or `ENOENT` (the new
  `isAbsentError`) reads as absent; anything else rejects.
- `receive-pack` no longer reads a failed ref or `HEAD` read as "absent". A
  `resolveRef` failure other than a genuine not-found used to map to the zero
  oid, so `force: true` in `applyRefUpdates` would overwrite a ref another
  writer had moved (its commits became unreachable); a failed `HEAD` read used
  to map to "detached", so a push could delete the branch HEAD named and leave
  the repository without a default branch. Both, a failed `deleteRef`, and a
  failed `HEAD` probe during first-push initialization now reject the push
  (500) instead. `isNotFoundError` now also recognizes isomorphic-git's own
  `NotFoundError` (`resolveRef`/`readObject`/`deleteRef`/`currentBranch` throw
  that, not this package's typed errors).
- `repackRepository` no longer drops a ref from the consolidated pack when
  resolving its tip fails transiently. Dropping it excluded that ref's history
  from the new pack while the cleanup deleted the packs that still held it,
  leaving the ref dangling; the consolidation now rejects instead.
- The package's `homepage` metadata now points at the docs site; 0.15.2 was
  published before that field was corrected.
- `applyReceivePack` no longer fails a push whose post-refs pack consolidation
  failed. The refs were already updated, so the client-visible error was
  spurious; the failure is reported through `hooks.onWarn` and the next push
  retries the repack.

## [0.15.2] - 2026-10-19

- First release published from the monorepo (0.15.1 was tagged but its
  publish failed).

## [0.15.1] - 2026-10-19 (not published)

### Changed

- Developed and published from the pushstack monorepo
  (`packages/git-fs-s3` in nandan-varma/pushstack); no code changes.

## [0.15.0] - 2026-10-19

### Added

- `git-fs-s3/fetch-s3`: `createFetchS3Store`, an S3/R2 store over `fetch`
  signed with `aws4fetch` (new optional peer dependency), with ranges,
  server-side `copy` and `S3HttpError`.
- `git-fs-s3/node`: `FileObjectStore`, a disk-backed store for local dev.
- `isRetryableError` (the default retry classifier, now also retrying
  fetch's bare `TypeError`), `isNotFoundError`, `deletePrefix`, `movePrefix`.

## [0.14.0] - 2026-10-19

### Added

- Tags: every read that takes a `ref` (tree, file content, log, history,
  diffs, last commits, submodules) now accepts a tag name, trying
  `refs/heads/<name>` first and then `refs/tags/<name>`. Annotated tags are
  peeled to their commit. `listTags` lists tags with their peeled commits in
  version order; `peelToCommit` peels a single oid.

## [0.13.0] - 2026-10-19

### Changed

- Requires isomorphic-git 1.44.3 or later (peer range and dev dependency).
  Earlier versions swallowed read and readdir errors other than
  file-not-found (fixed upstream in 1.44.3, isomorphic-git#2461), so a
  transient object-store failure could surface as a missing object instead
  of an error.

## [0.12.1] - 2026-10-19

### Fixed

- `handleUploadPack` answers a fetch's final negotiation round with
  `ACK <first common have>` instead of always `NAK`. The pack was already
  incremental, but the NAK told git there was no common history, so every
  fetch printed `warning: no common commits`.

## [0.12.0] - 2026-10-18

### Changed

- Licence: AGPL-3.0-or-later (was MIT). Versions up to and including `0.11.0`
  were published under MIT and remain available under it; from this release
  onward, a network service built on this package must offer its users the
  corresponding source (AGPL section 13).

### Fixed

- `createRetryStore` no longer drops the optional `ObjectStore.getRange`. It
  returns a new object listing the methods it wraps, so `getRange` used to
  disappear from any stack built with it — silently, because a missing
  `getRange` makes `getObjectSize` answer "unknown" instead of throwing, and
  every caller that gates on a size then read the whole object anyway. The
  0.11.0 size gate was inert in the recommended stack
  (`r2 → retry → cache → fs`) for exactly this reason.

## [0.11.0] - 2026-10-18

### Added

- `getObjectSize(repo, oid)` — an object's exact size in bytes without
  inflating it: the pack entry header for a whole object, the delta header
  inside its deflated data for a deltified one. Returns `null` when the size
  isn't readable (a loose object, an unindexed object, a store without range
  reads, or a delta prefix too short to yield its header).
- Optional `ObjectStore.getRange(key, start, end)` — bytes `start`..`end`
  inclusive, `null` when the key is absent — implemented by
  `MemoryObjectStore` and `S3ObjectStore` (S3's `Range` header) and exposed on
  the git-aware fs as `promises.getRange` only when the backing store has it.

### Changed

- Diffs decide `kind: "too-large"` from the object's pack entry **before
  reading it**, and bound blob reads and size probes with one shared semaphore
  (`MAX_CONCURRENT_READS`), so a wide commit can't fan out into a request per
  entry.
- `collectReachableOids` caps in-flight object reads at `MAX_CONCURRENT_READS`
  (16) with one semaphore per walk; the permit is released before recursing
  into an object's children.
- Added `src/semaphore.ts`, a FIFO semaphore that bounds in-flight reads by
  count rather than letting a wide tree issue one request per entry.
- Split the pack entry-header, delta-header and version-2 `.idx` parsers out of
  `http/pack-reuse.ts` into `pack-entry.ts` and `pack-index.ts`, shared by pack
  reuse and object size.
- `createCachedStore` forwards `getRange` to the backing store uncached.
- CI adds an npm audit job and drops the unused pnpm lockfile (CI and
  releases use npm).

### Fixed

- receive-pack unlinks the incoming pack when no ref update is applied, instead
  of leaving an unreachable pack behind for the threshold repack to carry.
- pkt-line throws rather than emitting a frame whose body exceeds what its
  4-hex-digit length prefix can describe.

## [0.10.0] - 2026-10-18

### Added

- Submodule support across the package: tree entries with `type: "commit"` and
  mode `160000` are external pointers that HTTP reachability, receive-pack,
  upload-pack and repack never try to read in the parent repository.
- `getSubmodules(repo, ref)` and `parseGitmodules(text)` for reading a root
  `.gitmodules` at a revision without following URLs or expanding includes.
- Diffs report `kind: "submodule"` for pointer additions, removals, updates
  and conversions to/from blobs or trees, with `oldEntry`/`newEntry` (oid,
  type, mode); pointer changes do not count as text additions/deletions.
- `getFileHistory` tracks submodule pointer changes; diff results include the
  exact `oldRef` and `newRef` used for navigation.

### Changed

- Releases publish through npm trusted publishing.

### Fixed

- Pinned the docs' `postcss-selector-parser` to 7.1.6 (CPU-exhaustion
  advisory; no patched 6.x).

## [0.9.0] - 2026-10-18

### Changed

- `getCommitHistory` slices `getCommitLog`'s cached walk (one shared
  `HISTORY_WALK_DEPTH`); history entries are `CommitSummary`s built by
  `summarizeCommit`.
- `getDiffBetweenRefs` diffs against the merge base, and `diffTrees` walks both
  trees once.
- `DiffFile.status` is `added | modified | deleted`; the rename fields are
  gone.
- `ResultCache` is typed over objects; `OpsHooks` drops `prefetchMinDepth`.
- `info/refs` resolves an unborn `HEAD` without candidate lookups.

### Removed

- `getFileFromRef`, `FileHistoryEntry`, `LastCommitInfo`, and the `eisdir`
  error.

## [0.8.0] - 2026-10-11

### Added

- Packed writes: `commitFilesToBare`, `deleteFileFromBare` and
  `writeCommitToBare` store their objects as one pack via `withPackedWrites`,
  flushed before any ref write. Nothing in the package writes loose objects
  any more.
- `isSafeTreePath` for validating tree-relative paths.

### Changed

- `createCachedStore`: a backend read that started before a write can no
  longer finish after it and cache the pre-write answer (including a
  "missing" entry for a just-written object); writes drop in-flight reads for
  the key.
- `createRetryStore`: any success resets the failure count, non-retryable
  errors never count, and half-open admits exactly one probe.
  `formatErrorResponse` maps an open circuit to 503 with `Retry-After`.
- receive-pack advertises side-band-64k and honors the client's capabilities;
  packs are named `pack-<checksum>`.
- upload-pack requires 40-hex wants/haves, rejects a want that isn't reachable
  from a ref, and walks only the client's commit ancestry plus the boundary
  commits' trees on a fetch.
- repack uses checksum-named packs, skips blob inflation during the walk
  (`indexPack` re-hashes everything), and removes stale `.idx` files before
  their packs.
- Ops: updated files keep their mode; file/directory clashes and duplicate
  paths are rejected; deleting a missing file is `GitPathNotFoundError` and
  emptied directories are pruned.

### Fixed

- receive-pack frames its report when side-band-64k is requested (a push from
  isomorphic-git could not parse the plain report), refuses duplicate commands
  for one ref and deletion of the branch `HEAD` names, and reports "unpack
  index-pack failed" for unindexable packs.
- upload-pack's single-pack fast path requires no loose objects and a pack
  holding every want — a clone after loose writes came back incomplete.
- `fastForwardMerge`/`analyzeMerge` treat an already-contained source as up to
  date (no no-op merge commit); `createBranchFrom` throws `GitConflictError`
  for an existing name; `deleteBranchByName` refuses `HEAD`'s branch.

## [0.7.0] - 2026-10-11

### Changed

- `DiffFile` carries `kind: "text" | "binary" | "too-large"` in place of
  `isBinary` and base64 `oldContent`/`newContent`. Binary files and text over
  `MAX_DIFF_TEXT_BYTES` (1 MiB) carry no patch and no content — only
  `oldSize`/`newSize` — so diffs of large or binary files no longer balloon.
  Callers fetch a side by path at its ref when they need to show it.

## [0.6.0] - 2026-10-11

### Changed

- A ref that doesn't resolve makes `resolveCommit` (and so `getTreeFromRef`,
  `getFileContent`) throw `GitRefNotFoundError` instead of returning `[]`, so
  a missing branch no longer looks like an empty directory. `getCommitLog`
  still returns `[]` for an unborn branch.
- Refs and default branches are explicit: `getTreeFromRef`, `getFileContent`,
  `getCommitLog`, `createBranchFrom`'s `startPoint`, and
  `handleInfoRefs`/`applyReceivePack`'s `defaultBranch` are required, with no
  implicit `main`.

## [0.5.0] - 2026-10-11

### Changed

- The package is ESM-only on Node 22+; type declarations come from `tsc`
  (TypeScript 7) and exports resolve to `dist/types`.
- Docs cover pack reuse, the shared isomorphic-git cache, `registerGitdir`,
  the typed gitdir layout, and the cache `copy` option; regex examples were
  replaced with the typed helpers.

### Removed

- `isStructurallyAbsent` — use `registerGitdir`'s `absentFiles`.

## [0.4.0] - 2026-10-11

### Added

- Typed gitdir path classification (`classifyGitdirPath`, `isMutableGitdirEntry`)
  in `git-layout.ts`, replacing the loose-object regex, and exported
  `pack-files.ts` helpers.
- `registerGitdir` accepts `GitdirFacts.absentFiles`, so per-gitdir structural
  absence costs zero store calls.

### Changed

- upload-pack builds its pack from stored pack entries (deltas kept, nothing
  re-deflated), falling back to `packObjects` for loose objects; repack
  consolidates via the same reuse and only rebuilds verified, non-deltified
  objects when some are loose.
- `info/refs` lists refs through a one-LIST branch/tag fast path instead of
  isomorphic-git's directory walk.
- The reachability walk reads each commit/tree once; upload-pack skips blob
  reads and bounds the wants walk by the client's haves; receive-pack
  validation is bounded to new objects at existing refs.
- `prefetchPacks` warms only `.pack`/`.idx`; the loose-object hint is detected
  on the first loose read; `createCachedStore` gains a `copy` option.
- CI adds CodeQL code scanning.

### Fixed

- Skip submodule gitlinks in the reachability walk — following one reported a
  missing object and made every walk incomplete, blocking repack and rejecting
  pushes.
- Repack keeps a dominant base pack instead of rewriting it undeltified, and
  cleans up orphaned `.bitmap`/`.rev` files.

## [0.3.11] - 2026-08-31

### Changed

- receive-pack validates the pushed object graph before applying ref updates,
  bounded to the objects the push introduces.
- Packs are prefetched before object-store file reads, and object-store branch
  listings avoid per-ref probes.
- Deduplicated `DiffFile` construction, the ref compare-and-swap check,
  loose-ref filesystem access, and `fromHex`; synced the npm lockfile.

## [0.3.7] - 2026-08-30

### Changed

- `listBranches`, `createBranchFrom`'s start-point lookup, `assertBranchExists`
  and `listAllRefs` resolve a loose branch/tag oid with one read instead of a
  stat-then-read, roughly halving the object-store round trips a branch
  listing needs.

## [0.3.6] - 2026-08-30

### Changed

- Renamed the package from `@nandan-varma/git-fs-s3` to unscoped `git-fs-s3`.
- Moved CVE fixes to this repository's actual npm toolchain, pinned patched
  `diff`/`esbuild` dev-toolchain versions, and committed the lockfile.
- Updated the docs' Astro/Starlight dependencies.

### Fixed

- Removed dead code and deduplicated `toKey` against its own implementation.
- `listAllRefs` avoids a redundant `resolveRef("HEAD")`.

## [0.3.5] - 2026-07-19

### Fixed

- A commit object that can't be read after a ref has resolved is no longer
  reported as an empty repository: `getTreeFromRef` and `getCommitLog` surface
  a typed `GitObjectNotFoundError` instead of `[]`.

## [0.3.4] - 2026-07-19

### Added

- `CacheOptions.ttlForKey` — a per-key/prefix TTL override, so mutable keys
  (refs, `HEAD`) can use a short TTL while content-addressed object keys keep
  the long `ttlMs`.

## [0.3.3] - 2026-07-19

### Added

- The `git-fs-s3/ops` (app-layer operations) and `git-fs-s3/http` (smart-HTTP)
  subpaths.
- An Astro + Starlight documentation site.

### Fixed

- Wired the prefetch hook into `getTreeFromRef`, so a cache-miss tree read
  doesn't resolve packs one at a time.
- Corrected the HTTP repack pack-trailer checksum.
- Pinned `Uint8Array`-returning `/http` types to `Uint8Array<ArrayBuffer>`.

## [0.1.0] - 2026-07-18

### Added

- The production read-path stack: `createRetryStore` (exponential backoff and
  a per-instance circuit breaker), `createCachedStore` (coalescing, list and
  miss caching, invalidation), git-aware loose-object hints, and pack
  prefetching.

## [0.0.1] - 2026-07-17

### Added

- Initial release: an isomorphic-git filesystem backend for S3-compatible
  object storage — `createGitFs`, `MemoryObjectStore` and `S3ObjectStore`,
  the `ObjectStore` contract, package scaffolding, a README, and CI with
  tag-triggered npm publishing.
