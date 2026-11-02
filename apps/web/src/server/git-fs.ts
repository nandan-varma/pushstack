/**
 * The isomorphic-git filesystem every repository lives behind, composed from
 * git-fs-s3, network-outward: the R2 bucket binding → perf instrumentation → LRU cache
 * (coalescing, miss/list caching) → git-aware fs (loose-object hints,
 * registered gitdirs). Gitdirs are full storage roots
 * (`repos/{ownerKey}/{repoName}/git`), so fs paths map 1:1 onto R2 keys.
 */

import {
	classifyGitdirPath,
	copyPrefix,
	createCachedStore,
	createGitFs,
	deletePrefix,
	type GitdirEntry,
	isMutableGitdirEntry,
	movePrefix,
	type ObjectStore,
} from "git-fs-s3";
import { createR2Store } from "git-fs-s3/r2";
import { presignR2Put } from "#/lib/r2";
import { GIT_CACHE_MAX_BYTES, GIT_CACHE_TTL_MS } from "./config";
import { env } from "./env";
import {
	getRepoGitStoragePrefix,
	getRepoGitStorageRoot,
	getRepoReleaseStoragePrefix,
	parseRepoGitStorageKey,
} from "./git-storage-naming";
import {
	logError,
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

export function refAwareTtl(key: string): number | undefined {
	const entry = gitdirEntryOf(key);
	return entry && isMutableGitdirEntry(entry) ? STRUCTURE_TTL_MS : undefined;
}

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
 * The repository store: the app's one R2 bucket binding. Reads and writes stay
 * on Cloudflare's network, and R2 retries transient failures itself.
 */
const r2 = createR2Store(env.GIT_BUCKET, { contentType: gitContentType });

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

const networkStore = withPerfLogging(r2);

/** Copy within the bucket, streamed through the binding rather than buffered. */
const copyObject = (from: string, to: string) =>
	perfR2(`R2 COPY ${from}`, () => r2.copy(from, to));

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

export function detectLooseObjectsHint(
	ownerKey: string,
	repoName: string,
): Promise<void> {
	return gitFs.detectLooseObjects(getRepoGitStorageRoot(ownerKey, repoName));
}

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

export async function listRepoStorage(
	ownerKey: string,
	repoName: string,
): Promise<{ key: string; size: number }[]> {
	const { objects } = await networkStore.list(
		getRepoGitStoragePrefix(ownerKey, repoName),
	);
	return objects;
}

export function putStorageObject(key: string, data: Uint8Array): Promise<void> {
	return networkStore.put(key, data);
}

/** Delete all of a repo's storage (git data and release assets). Callers hold the repo lock. */
export async function deleteRepoStorage(
	ownerKey: string,
	repoName: string,
): Promise<void> {
	await deletePrefix(networkStore, getRepoGitStoragePrefix(ownerKey, repoName));
	await deletePrefix(
		networkStore,
		getRepoReleaseStoragePrefix(ownerKey, repoName),
	);
	invalidateRepoGitStorage(ownerKey, repoName);
}

/**
 * Copy a repository's git data (not its release assets) to a fork's storage.
 * The parent is left in place. Refuses before any object is copied when the
 * parent holds more than `maxBytes`; returns how many objects were copied.
 * Callers hold both repositories' locks.
 */
export async function forkRepoGitStorage(
	parentOwnerKey: string,
	parentRepoName: string,
	forkOwnerKey: string,
	forkRepoName: string,
	maxBytes: number,
): Promise<number> {
	const copied = await copyPrefix(
		networkStore,
		getRepoGitStoragePrefix(parentOwnerKey, parentRepoName),
		getRepoGitStoragePrefix(forkOwnerKey, forkRepoName),
		{ copy: copyObject, maxBytes },
	);
	invalidateRepoGitStorage(forkOwnerKey, forkRepoName);
	return copied;
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
	await transferRepoStorage(ownerKey, oldRepoName, ownerKey, newRepoName);
}

/**
 * {@link moveRepoStorage} across owners (a transfer): same copy-then-delete,
 * for the git data and the release assets, whose keys also derive from the
 * owner and name.
 */
export async function transferRepoStorage(
	oldOwnerKey: string,
	oldRepoName: string,
	newOwnerKey: string,
	newRepoName: string,
): Promise<void> {
	const gitFrom = getRepoGitStoragePrefix(oldOwnerKey, oldRepoName);
	const gitTo = getRepoGitStoragePrefix(newOwnerKey, newRepoName);
	await movePrefix(networkStore, gitFrom, gitTo, { copy: copyObject });
	try {
		await movePrefix(
			networkStore,
			getRepoReleaseStoragePrefix(oldOwnerKey, oldRepoName),
			getRepoReleaseStoragePrefix(newOwnerKey, newRepoName),
			{ copy: copyObject },
		);
	} catch (error) {
		// Never leave the git data at the new name with the releases behind:
		// the caller's row still names the old location.
		try {
			await movePrefix(networkStore, gitTo, gitFrom, { copy: copyObject });
		} catch (rollbackError) {
			logError(
				"git-fs",
				`moving ${gitTo} back after a failed release move failed`,
				rollbackError,
			);
		}
		invalidateRepoGitStorage(oldOwnerKey, oldRepoName);
		invalidateRepoGitStorage(newOwnerKey, newRepoName);
		throw error;
	}
	invalidateRepoGitStorage(oldOwnerKey, oldRepoName);
	invalidateRepoGitStorage(newOwnerKey, newRepoName);
}

/**
 * Release-asset objects bypass the git cache (they are large and read once):
 * straight to R2 through the retry layer.
 */
export const releaseAssetStorage = {
	put: (key: string, data: Uint8Array) => networkStore.put(key, data),
	delete: (key: string) => networkStore.delete(key),
	head: (key: string) => networkStore.head(key),
	copy: copyObject,
	getRange: (key: string, start: number, end: number) =>
		networkStore.getRange?.(key, start, end) ?? Promise.resolve(null),
	/** A presigned PUT URL, or null when no S3 API credentials are configured. */
	presignPut: presignR2Put,
};
