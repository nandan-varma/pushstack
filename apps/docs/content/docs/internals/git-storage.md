---
title: "Git storage"
description: "Git data in Cloudflare R2, written and served with no native git binary."
---

Vercel functions have no persistent disk and cannot bundle a native `git`
binary, so the git object model runs in JS (isomorphic-git) against an `fs`
backed by Cloudflare R2 (`git-fs-s3`). There is no `/tmp` working copy and no
hydrate step: reads and writes both hit R2. Without R2 env vars (tests, local
runs) the same stack uses an in-memory store; production refuses that.

## Keys and names

All git data lives at `repos/{ownerKey}/{repoName}/git/…`.
`apps/web/src/server/git-storage-naming.ts` is the **only** place that builds
these keys. Every segment is checked against `STORAGE_NAME_RE` and throws
instead of building a key: a segment becomes a gitFs path, which normalizes
`..` before mapping onto a key, so an unchecked one would reach another
repository's prefix (see [security.md](/docs/internals/security)).

A wiki is a second bare repository, `repos/{ownerKey}/{repoName}/wiki/git`,
beside `git/` and `releases/`, on branch `master`. Rename, transfer and delete
carry the whole `wiki/` directory with the repository; a **fork does not** copy
it (GitHub's rule), so a fork starts with no wiki bytes at all. A repository
name may not end in `.wiki`, so `/{repo}.wiki.git` can never be ambiguous.

Release assets sit beside the git data, keyed by the immutable asset id only,
so renaming a repository moves them with it. Uploads above 4 MB go straight to
R2 on a presigned `PUT` (a function body is capped at 4.5 MB) under an
`uploads/` key; finishing it `HEAD`s that object, discards it unless its size
matches the declaration, then copies server-side, so a replayed `PUT` changes
nothing. There are no workers, so never-finished uploads are swept
opportunistically when a release's assets are listed or added.

A fork's git prefix is a server-side copy of its parent's (`CopyObject`, capped
by `MAX_FORK_COPY_BYTES`; a larger parent is refused with `422`), taken while
holding both repositories' locks so a repack cannot delete a pack mid-copy.
Nothing is shared afterwards, and release assets are not copied. The fork's row
is inserted only after the copy and HEAD exist, so a row always names complete
storage; a failed or killed copy leaves a prefix that the next fork or create
under that name clears.

## The storage stack

Network-outward to gitdir-facing: R2 store (`fetch-s3`) → `createRetryStore` →
`perfR2` → `createCachedStore` → `createGitFs`. Every operation — clone, push,
web commit, merge — goes through it; callers take `repoFor(ownerKey, repoName)`.

- **Retry** sits directly above the network so the cache can never store a
  transient failure, and coalesced callers share one retried attempt.
  `git-fs.ts` owns the app's single instance; never build a second.- **Cache** is an in-process LRU of raw bytes with coalescing, negative
  results, listing caching, and `refAwareTtl`, which shortens `HEAD`, `refs/*`
  and the `objects/` listings to 5s because a warm instance is never told
  another instance pushed (see
  [performance.md](/docs/internals/performance#caching-tiers-front-to-back)).
- **GitFs** registers each gitdir with `absentFiles: ["packed-refs",
  "shallow"]` — nothing here writes either, so isomorphic-git's per-command
  stat and ref probes cost zero R2 calls, even on a cold instance. It also
  answers "no loose objects" from one bounded LIST, because a fully packed
  repo would otherwise pay one guaranteed 404 per commit in a walk.

**Never write a loose object.** Everything goes through `withPackedWrites`, one
pack per operation flushed before the ref moves. A warm instance caches the
loose-object answer and is never told another instance wrote one, so the answer
stays correct only if no writer ever creates a loose object.

## Writes and the repo lock

Writes build objects and move refs directly. Objects always land before a ref
names them, so a killed function at worst leaves unreachable objects for the
next repack.

Every write runs inside `withRepositoryLock` (`git-repo-lock.ts`): a lease row
in `repo_locks` per `{ownerKey}/{repoName}`, because two concurrent pushes can
land on two unrelated Vercel instances with no shared state. Acquire is one
atomic `INSERT … ON CONFLICT … WHERE expires_at < now() RETURNING` (the Neon
HTTP driver cannot hold a session lock); the 60s lease is renewed every 20s so
a long repack is never taken over, and a killed holder stops renewing so the
repo recovers within one TTL. **It is not reentrant**: a holder that calls
another locked function times out after ~65s.

Storage keys derive from the repository's current name as read from its row, so
renaming moves storage: `updateRepository` wraps the `CopyObject` copy, the old
keys' deletion and the row update in one lock span, and reverts the copy if the
row update fails. Deleting a repository deletes the row first, then the prefix
under the lock; `createRepository` inserts its row first and clears the prefix
before `initBareRepo`, so leftovers cannot leak into a new repository of the
same name.

## Repacks

`repackRepository` consolidates only at `REPACK_PACK_COUNT_THRESHOLD` and
above: it is O(total objects), so doing it on every push would make push
latency grow with repository size forever. It writes and verifies the new pack
before deleting the old ones, and decides that deletion is safe from traversal
*completeness* — every visited object was read — never from an object count,
since packs overlap. A repack after a push or web commit is best-effort (logged,
the write stands); only the owner's explicit repack action reports a failure.

Repack keeps only objects reachable from a branch, a tag or a pull head, so a
pack holding objects no ref names yet (REST git-database writes) carries a
`.keep` for a day: the pack is left alone and does not count towards the
threshold until it expires.

Branch and tag lists read the ref directory once and then only the requested
page's tips, so thousands of refs cost a listing plus one page of reads.

## Pull request heads

A pull request whose head is in a fork is pinned in the base repository as
`refs/pull/<n>/head`, so the base can diff and merge it. Repacks use those refs
as roots, or a consolidation would drop the PR's commits. `info/refs` never
advertises them; the single-pack fast path is skipped while any pull head or
`.keep` exists, and a delta is reused only when its base is among the wanted
objects. `deletePullHead` removes the ref and repacks at once, so no pack
outlives the delete holding an object only that head named. Pushes cannot write
the namespace: `isSafeFullRefName` accepts only `refs/heads/` and `refs/tags/`.

A fork syncs through `importCommit` (`copyMissingObjects` with the
`MAX_IMPORT_OBJECTS`/`MAX_IMPORT_BYTES` caps, over which is `422`), which walks
from the wanted commit and stops at every object the destination already has,
sizing objects from the pack index so a huge blob is refused before it is
inflated. It takes no lock: the caller holds the destination's lock across the
copy **and** the ref move, because the pack has no `.keep`.

## Smart HTTP (`git-http.ts`, `git-fs-s3/http`)

`serveGitRequest` parses the clone URL, caps the streamed body
(`GIT_HTTP_MAX_BODY_BYTES`, enforced while streaming and on decoded bytes too,
so gzip cannot bypass it), looks up the repo, authenticates, locks pushes and
reports timings. upload-pack is lock-free; receive-pack writes and indexes the
pack, verifies the pushed graph, applies the ref updates concurrently, then
repacks.

Packfiles are always `side-band-64k` framed, and both services advertise it:
isomorphic-git's client always demultiplexes side-band regardless of
negotiation and spins forever parsing a raw packfile.

Every client `refName` is validated with `isSafeFullRefName` **before** the
isomorphic-git call, because `resolveRef`/`deleteRef` validate nothing and
resolve straight through `fs`, so a `../`-laden name would reach another
repository. The same validator, in its bare-name variant, guards every branch
name taken from the API and the web UI.

A lock-free clone can list `objects/pack/` just before a concurrent repack
deletes a pack, so a missing object is retried once after a short delay before
being called missing. That is sound only because the new pack is always
written before the old ones are removed.

## Tuning

```bash
GIT_HTTP_MAX_BODY_BYTES=52428800   # default 50MB — push body cap
GIT_CACHE_MAX_SIZE=1073741824      # default 1GB — raw R2 read cache
GIT_CACHE_TTL=3600                 # default 1h — overridden to 5s for refs and listings
```
