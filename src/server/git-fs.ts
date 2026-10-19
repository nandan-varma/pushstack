/**
 * The isomorphic-git filesystem every repository lives behind, composed from
 * git-fs-s3, network-outward: R2 store (src/lib/r2.ts; in-memory without R2
 * env) → retry + circuit breaker → perf instrumentation → LRU cache
 * (coalescing, miss/list caching) → git-aware fs (loose-object hints,
 * registered gitdirs). Gitdirs are full storage roots
 * (`repos/{ownerKey}/{repoName}/git`), so fs paths map 1:1 onto R2 keys.
 */

import path from "node:path";
import {
	classifyGitdirPath,
	createCachedStore,
	createGitFs,
	createRetryStore,
	deletePrefix,
	type GitdirEntry,
	isMutableGitdirEntry,
	MemoryObjectStore,
	movePrefix,
	type ObjectStore,
} from "git-fs-s3";
import type { FetchS3ObjectStore } from "git-fs-s3/fetch-s3";
import { FileObjectStore } from "git-fs-s3/node";
import { createR2ObjectStoreFromEnv, isR2Configured } from "#/lib/r2";
import { GIT_CACHE_MAX_BYTES, GIT_CACHE_TTL_MS } from "./config";
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

// Refs and the `objects/` / `objects/pack/` listings change on every push;
// everything else is content-addressed. The cache is per instance with no
// cross-instance invalidation, so mutable entries get a short TTL: another
// warm instance sees a moved ref or a new pack within seconds, while objects
// keep the full TTL.
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

/**
 * A store that can serve byte ranges. Both backends this app builds implement
 * `getRange` — the R2 store with S3's `Range` header, `MemoryObjectStore`
 * directly — and requiring it here is deliberate: the alternative is a wrapper
 * that silently drops the method, which does not fail loudly, it makes
 * `getObjectSize` answer "unknown" so every size gate quietly reads the whole
 * object instead of refusing it. A future backend without ranges should be a
 * type error, not a silent regression.
 */
type RangeCapableStore = ObjectStore & {
	getRange: NonNullable<ObjectStore["getRange"]>;
};

// Without R2 env, repositories live on disk under PUSHSTACK_LOCAL_DIR
// (`pnpm dev:local`) or, failing that (tests), in memory for the life of the
// process; production refuses instead of silently losing pushes. Built on first use, never at import time.
let backend: {
	store: RangeCapableStore;
	r2: FetchS3ObjectStore | null;
} | null = null;

function getBackend(): {
	store: RangeCapableStore;
	r2: FetchS3ObjectStore | null;
} {
	if (backend) return backend;
	if (isR2Configured()) {
		const r2 = createR2ObjectStoreFromEnv(gitContentType);
		backend = { store: r2, r2 };
	} else if (process.env.NODE_ENV === "production") {
		throw new Error(
			"R2 is not configured (R2_BUCKET_NAME/R2_ENDPOINT/R2_ACCESS_KEY_ID/" +
				"R2_SECRET_ACCESS_KEY) — refusing to serve repositories from memory in production",
		);
	} else if (process.env.PUSHSTACK_LOCAL_DIR) {
		const root = path.join(process.env.PUSHSTACK_LOCAL_DIR, "git");
		backend = { store: new FileObjectStore(root), r2: null };
	} else {
		logWarn(
			"git-fs",
			"R2 is not configured: repositories are kept in memory and vanish when this process exits",
		);
		backend = { store: new MemoryObjectStore(), r2: null };
	}
	return backend;
}

const lazyStore: RangeCapableStore = {
	get: (key) => getBackend().store.get(key),
	put: (key, data) => getBackend().store.put(key, data),
	delete: (key) => getBackend().store.delete(key),
	head: (key) => getBackend().store.head(key),
	list: (prefix, options) => getBackend().store.list(prefix, options),
	getRange: (key, start, end) => getBackend().store.getRange(key, start, end),
};

// Every backend call shows in the request's perf tree (perf-log.ts).
function withPerfLogging(store: ObjectStore): ObjectStore {
	// Forwarded explicitly: this returns a new object, and a dropped `getRange`
	// would not fail — `getObjectSize` reports "unknown size" instead, so every
	// size gate would quietly fall back to reading the whole object.
	const range = store.getRange?.bind(store);
	return {
		...(range
			? {
					getRange: (key: string, start: number, end: number) =>
						perfR2(`R2 GET ${key} (range)`, () => range(key, start, end)),
				}
			: {}),
		get: (key) => perfR2(`R2 GET ${key}`, () => store.get(key)),
		put: (key, data) => perfR2(`R2 PUT ${key}`, () => store.put(key, data)),
		delete: (key) => perfR2(`R2 DELETE ${key}`, () => store.delete(key)),
		head: (key) => perfR2(`R2 HEAD ${key}`, () => store.head(key)),
		list: (prefix, options) =>
			perfR2(`R2 LIST ${prefix}`, () => store.list(prefix, options)),
	};
}

const networkStore = withPerfLogging(
	createRetryStore(lazyStore, {
		onRetry: ({ op, key, attempt }) =>
			perfNote(`R2 ${op} ${key}: retry ${attempt}`),
	}),
);

const cachedStore = createCachedStore(networkStore, {
	maxBytes: GIT_CACHE_MAX_BYTES,
	ttlMs: GIT_CACHE_TTL_MS,
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
 * This app never writes `packed-refs` (refs are always loose) or `shallow`
 * (shallow clones aren't advertised).
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
 * Drop every cached read for a repo. Writes through `gitFs` keep the cache
 * current on their own; this is for the storage-level operations below,
 * which bypass it.
 */
function invalidateRepoGitStorage(ownerKey: string, repoName: string): void {
	gitFs.invalidate(getRepoGitStoragePrefix(ownerKey, repoName));
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

/** Delete all of a repo's storage. Callers hold the repo lock. */
export async function deleteRepoStorage(
	ownerKey: string,
	repoName: string,
): Promise<void> {
	await deletePrefix(networkStore, getRepoGitStoragePrefix(ownerKey, repoName));
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
	const { r2 } = getBackend();
	await movePrefix(networkStore, oldPrefix, newPrefix, {
		copy: r2
			? (from, to) => perfR2(`R2 COPY ${from}`, () => r2.copy(from, to))
			: undefined,
	});
	invalidateRepoGitStorage(ownerKey, oldRepoName);
	invalidateRepoGitStorage(ownerKey, newRepoName);
}
