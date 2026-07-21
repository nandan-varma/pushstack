/**
 * The R2-backed isomorphic-git filesystem, composed from
 * git-fs-s3 (extracted from this app's former git-r2-backend.ts).
 *
 * Stack, network-outward: S3ObjectStore → retry/circuit-breaker → perf
 * instrumentation → LRU cache (coalescing, miss/list caching, invalidation) →
 * git-aware fs (loose-object hints, structural-absence short-circuits).
 * Gitdirs are the full storage roots (repos/{ownerKey}/{repoName}/git), so
 * fs paths map 1:1 onto R2 keys — the store is built with no prefix.
 */

import {
	createCachedStore,
	createGitFs,
	createRetryStore,
	type ObjectStore,
} from "git-fs-s3";
import { S3ObjectStore } from "git-fs-s3/s3";
import { getR2Client, getR2Config } from "#/lib/r2";
import {
	getRepoGitStoragePrefix,
	getRepoGitStorageRoot,
} from "./git-storage-naming";
import { perfNote, perfR2, recordCacheHit, recordCacheMiss } from "./perf-log";

const MAX_BYTES = Number.parseInt(
	process.env.GIT_CACHE_MAX_SIZE || "1073741824",
	10,
);
const TTL_MS = Number.parseInt(process.env.GIT_CACHE_TTL || "3600", 10) * 1000;

// Refs (HEAD, refs/heads/<branch>) and directory *listings* under objects/
// are the mutable things in a bare gitdir — refs move and new packs appear
// on every push — unlike every other key here (a specific content-addressed
// object's bytes, fixed forever once you know its key, safe to cache for the
// full TTL_MS). This cache is in-process per server instance with no
// cross-instance invalidation (invalidateRepoGitStorage only clears the
// instance handling the push), so without this a *different* warm instance
// that had already cached a ref, or the pack directory's listing, keeps
// serving that pre-push view for up to TTL_MS (an hour by default) even
// though nothing changed about that instance's own state — it just never
// re-checked. Concretely: prefetchAllPacks's readdir(objects/pack/) is what
// discovers a freshly pushed pack exists at all; caching that listing long
// means a warm instance can keep reporting an already-repaired repo's newest
// commit as "missing from storage" indefinitely, because it never sees the
// new pack file show up. A ref/listing read is cheap (one small object or a
// bounded directory), so re-checking far more often than TTL_MS costs little;
// everything downstream (tree, commit, blob — all keyed by the sha a fresh
// ref resolves to, or read by a specific pack name a fresh listing named)
// still gets the full-length cache benefit once the structure itself is
// fresh.
const STRUCTURE_TTL_MS = 5_000;
const STRUCTURE_KEY_RE = /\/(HEAD|refs(\/|$)|objects\/(pack\/)?$)/;

/** Exported for tests. */
export function refAwareTtl(key: string): number | undefined {
	return STRUCTURE_KEY_RE.test(key) ? STRUCTURE_TTL_MS : undefined;
}

// getR2Client() throws when R2 env is unset, so the real store is built on
// first use, never at import time — the local-disk fallback path
// (git-manager-iso.ts's getBareRepoOptions) and unit tests import this module
// without R2 configured.
let realStore: ObjectStore | null = null;

function getStore(): ObjectStore {
	if (realStore) return realStore;
	realStore = new S3ObjectStore({
		client: getR2Client(),
		bucket: getR2Config().bucketName,
		contentType: (key) =>
			/\/(HEAD|config)$|\/refs\//.test(key) ? "text/plain" : undefined,
	});
	return realStore;
}

const lazyS3: ObjectStore = {
	get: (key) => getStore().get(key),
	put: (key, data) => getStore().put(key, data),
	delete: (key) => getStore().delete(key),
	head: (key) => getStore().head(key),
	list: (prefix, options) => getStore().list(prefix, options),
};

// Keeps the request-scoped `[perf]` R2 tally (perf-log.ts) that r2-operations.ts
// provides for the hydrate/sync path — without this, backend reads would vanish
// from every perfContext summary.
function withPerfLogging(store: ObjectStore): ObjectStore {
	return {
		get: (key) => perfR2(`R2 GET ${key}`, () => store.get(key)),
		put: (key, data) => perfR2(`R2 PUT ${key}`, () => store.put(key, data)),
		delete: (key) => perfR2(`R2 DELETE ${key}`, () => store.delete(key)),
		head: (key) => perfR2(`R2 HEAD ${key}`, () => store.head(key)),
		list: (prefix, options) =>
			perfR2(`R2 LIST ${prefix}`, () => store.list(prefix, options)),
	};
}

const cachedStore = createCachedStore(
	withPerfLogging(createRetryStore(lazyS3)),
	{
		maxBytes: MAX_BYTES,
		ttlMs: TTL_MS,
		ttlForKey: refAwareTtl,
		cacheMisses: true,
		cacheLists: true,
		onHit: recordCacheHit,
		onMiss: recordCacheMiss,
	},
);

export const gitFs = createGitFs(cachedStore, {
	looseObjectHints: true,
	// packed-refs and shallow are structural, permanent 404s: nothing in this
	// codebase ever writes either (refs are always loose — git-branch-ops.ts —
	// and shallow clones are never advertised), yet isomorphic-git probes both
	// constantly. Anchored to the gitdir layout so a branch literally named
	// "packed-refs" (refs/heads/packed-refs) is unaffected.
	isStructurallyAbsent: (p) =>
		/^repos\/[^/]+\/[^/]+\/git\/(packed-refs|shallow)$/.test(p),
	onNote: perfNote,
});

/** Cheap one-time-per-repo check so reads can skip doomed loose-object GETs. */
export function detectLooseObjectsHint(
	ownerKey: string,
	repoName: string,
): Promise<void> {
	return gitFs.detectLooseObjects(getRepoGitStorageRoot(ownerKey, repoName));
}

/** Warm all pack files in parallel before a sequential commit walk. */
export function prefetchAllPacks(
	ownerKey: string,
	repoName: string,
): Promise<void> {
	return gitFs.prefetchPacks(getRepoGitStorageRoot(ownerKey, repoName));
}

/**
 * Drop every cached read (contents, negative markers, dir listings, loose
 * hints) for a repo. Must be called after anything writes to the repo's R2
 * prefix around this fs — the hydrate/sync push path, storage renames — or
 * warm instances keep serving pre-push state.
 */
export function invalidateRepoGitStorage(
	ownerKey: string,
	repoName: string,
): void {
	gitFs.invalidate(getRepoGitStoragePrefix(ownerKey, repoName));
}

/** Targeted eviction for individual full storage keys (e.g. superseded packs). */
export function invalidateGitStorageKeys(keys: string[]): void {
	for (const key of keys) {
		gitFs.invalidate(key);
	}
}
