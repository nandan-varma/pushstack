/**
 * The R2-backed isomorphic-git filesystem, composed from
 * @nandan-varma/git-fs-s3 (extracted from this app's former git-r2-backend.ts).
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
} from "@nandan-varma/git-fs-s3";
import { S3ObjectStore } from "@nandan-varma/git-fs-s3/s3";
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
