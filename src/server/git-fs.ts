/**
 * The R2-backed isomorphic-git filesystem, composed from
 * git-fs-s3 (extracted from this app's former git-r2-backend.ts).
 *
 * Stack, network-outward: R2 store (src/lib/r2.ts; in-memory without R2
 * env) → retry/circuit-breaker → perf
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
	MemoryObjectStore,
	type ObjectStore,
} from "git-fs-s3";
import {
	createR2ObjectStoreFromEnv,
	isR2Configured,
	type R2ObjectStore,
} from "#/lib/r2";
import {
	getRepoGitStoragePrefix,
	getRepoGitStorageRoot,
	parseRepoGitStorageKey,
} from "./git-storage-naming";
import {
	logWarn,
	perfNote,
	perfR2,
	recordCacheHit,
	recordCacheMiss,
} from "./perf-log";

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

// R2 is the only durable storage. Without R2 env (unit tests, a quick local
// run) repositories live in an in-memory store for the life of the process —
// nothing is ever written to local disk. Production refuses to start that
// way rather than silently losing every push on the next cold start. The real
// store is built on first use, never at import time.
let baseStore: ObjectStore | null = null;
let r2Store: R2ObjectStore | null = null;

function getBaseStore(): ObjectStore {
	if (baseStore) return baseStore;
	if (isR2Configured()) {
		r2Store = createR2ObjectStoreFromEnv(gitContentType);
		baseStore = r2Store;
	} else if (process.env.NODE_ENV === "production") {
		throw new Error(
			"R2 is not configured (R2_BUCKET_NAME/R2_ENDPOINT/R2_ACCESS_KEY_ID/" +
				"R2_SECRET_ACCESS_KEY) — refusing to serve repositories from memory in production",
		);
	} else {
		logWarn(
			"git-fs",
			"R2 is not configured: repositories are kept in memory and vanish when this process exits",
		);
		baseStore = new MemoryObjectStore();
	}
	return baseStore;
}

const lazyStore: ObjectStore = {
	get: (key) => getBaseStore().get(key),
	put: (key, data) => getBaseStore().put(key, data),
	delete: (key) => getBaseStore().delete(key),
	head: (key) => getBaseStore().head(key),
	list: (prefix, options) => getBaseStore().list(prefix, options),
};

// Keeps the request-scoped `[perf]` R2 tally (perf-log.ts) — without this,
// backend reads would vanish from every perfContext summary.
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

// The default policy retries 5xx/429 and Node socket error codes; fetch
// reports a dropped connection as a bare TypeError, and a stalled request as
// AbortSignal.timeout's TimeoutError — both transient.
function isRetryableStoreError(error: unknown): boolean {
	if (error instanceof TypeError) return true;
	if (typeof error !== "object" || error === null) return false;
	const err = error as {
		name?: string;
		$metadata?: { httpStatusCode?: number };
	};
	if (err.name === "TimeoutError" || err.name === "SlowDown") return true;
	const status = err.$metadata?.httpStatusCode;
	return status !== undefined && (status >= 500 || status === 429);
}

const networkStore = withPerfLogging(
	createRetryStore(lazyStore, {
		isRetryable: isRetryableStoreError,
		onRetry: ({ op, key, attempt }) =>
			perfNote(`R2 ${op} ${key}: retry ${attempt}`),
	}),
);

const cachedStore = createCachedStore(networkStore, {
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
});

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
 * hints) for a repo. Writes through `gitFs` keep the cache current on their
 * own; this is for changes made around it — the storage-level operations
 * below — or warm instances keep serving the old state.
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

/** Every object stored under a repo's gitdir (one uncached LIST, paginated). */
export async function listRepoStorage(
	ownerKey: string,
	repoName: string,
): Promise<{ key: string; size: number }[]> {
	const { objects } = await networkStore.list(
		getRepoGitStoragePrefix(ownerKey, repoName),
	);
	return objects;
}

/** Writes one raw storage object (uncached; operator scripts). */
export function putStorageObject(key: string, data: Uint8Array): Promise<void> {
	return networkStore.put(key, data);
}

/** Total bytes stored for a repo — what `repositories.diskUsage` records. */
export async function getRepoStorageSize(
	ownerKey: string,
	repoName: string,
): Promise<number> {
	const objects = await listRepoStorage(ownerKey, repoName);
	return objects.reduce((sum, object) => sum + object.size, 0);
}

const STORAGE_BATCH = 20;

async function inBatches<T>(
	items: T[],
	fn: (item: T) => Promise<void>,
): Promise<void> {
	for (let i = 0; i < items.length; i += STORAGE_BATCH) {
		await Promise.all(items.slice(i, i + STORAGE_BATCH).map(fn));
	}
}

/** Delete all of a repo's storage. Callers hold the repo lock. */
export async function deleteRepoStorage(
	ownerKey: string,
	repoName: string,
): Promise<void> {
	const objects = await listRepoStorage(ownerKey, repoName);
	await inBatches(objects, (object) => networkStore.delete(object.key));
	invalidateRepoGitStorage(ownerKey, repoName);
}

/**
 * Move a repo's storage to a new name: copy everything (server-side on R2),
 * then delete the old keys only once every copy succeeded — a failed copy
 * leaves the old storage untouched. Callers hold the repo lock.
 */
export async function moveRepoStorage(
	ownerKey: string,
	oldRepoName: string,
	newRepoName: string,
): Promise<void> {
	const oldPrefix = getRepoGitStoragePrefix(ownerKey, oldRepoName);
	const newPrefix = getRepoGitStoragePrefix(ownerKey, newRepoName);
	const objects = await listRepoStorage(ownerKey, oldRepoName);
	getBaseStore();
	const r2 = r2Store;
	const copy = r2
		? (from: string, to: string) =>
				perfR2(`R2 COPY ${from}`, () => r2.copy(from, to))
		: async (from: string, to: string) => {
				const data = await networkStore.get(from);
				if (data) await networkStore.put(to, data);
			};

	await inBatches(objects, (object) =>
		copy(object.key, `${newPrefix}${object.key.slice(oldPrefix.length)}`),
	);
	await inBatches(objects, (object) => networkStore.delete(object.key));
	invalidateRepoGitStorage(ownerKey, oldRepoName);
	invalidateRepoGitStorage(ownerKey, newRepoName);
}
