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
	classifyGitdirPath,
	createCachedStore,
	createGitFs,
	createRetryStore,
	type GitdirEntry,
	isMutableGitdirEntry,
	type ObjectStore,
} from "git-fs-s3";
import { S3ObjectStore } from "git-fs-s3/s3";
import { getR2Client, getR2Config } from "#/lib/r2";
import {
	getRepoGitStoragePrefix,
	getRepoGitStorageRoot,
	parseRepoGitStorageKey,
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

function gitdirEntryOf(key: string): GitdirEntry | null {
	const parsed = parseRepoGitStorageKey(key);
	return parsed ? classifyGitdirPath(parsed.gitdirPath) : null;
}

/** Exported for tests. */
export function refAwareTtl(key: string): number | undefined {
	const entry = gitdirEntryOf(key);
	return entry && isMutableGitdirEntry(entry) ? STRUCTURE_TTL_MS : undefined;
}

/** HEAD, config and refs are text; everything else is binary. */
function gitContentType(key: string): string | undefined {
	switch (gitdirEntryOf(key)?.kind) {
		case "head":
		case "config":
		case "refs":
			return "text/plain";
		default:
			return undefined;
	}
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
		contentType: gitContentType,
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
		// isomorphic-git never mutates the bytes it reads, so skip the
		// per-hit defensive copy (megabytes per read for packfiles).
		copy: false,
		onHit: recordCacheHit,
		onMiss: recordCacheMiss,
	},
);

export const gitFs = createGitFs(cachedStore, {
	looseObjectHints: true,
	onNote: perfNote,
});

/**
 * The repo's R2 gitdir, registered with `gitFs` so isomorphic-git's
 * per-command gitdir stat and its `packed-refs`/`shallow` probes cost no R2
 * calls. Only call once the repository is known to exist (its DB row).
 * `packed-refs` and `shallow` are never written by this app: refs are always
 * loose (git-branch-ops.ts) and shallow clones are never advertised.
 */
export function registerRepoGitdir(ownerKey: string, repoName: string): string {
	const gitdir = getRepoGitStorageRoot(ownerKey, repoName);
	gitFs.registerGitdir(gitdir, { absentFiles: ["packed-refs", "shallow"] });
	return gitdir;
}

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
