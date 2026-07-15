/**
 * R2 Storage Backend for isomorphic-git
 *
 * Implements a custom filesystem interface that stores git objects in Cloudflare R2
 * instead of the local filesystem. Provides atomic operations with ETag-based
 * optimistic locking and integrates with cache and transaction layers.
 */

import {
	bulkDeleteFromR2,
	deleteFromR2,
	downloadFromR2,
	headR2Object,
	listAllR2Files,
	listR2Files,
	uploadToR2,
} from "#/lib/r2-operations";
import {
	deleteCache,
	deleteCachedObject,
	getCache,
	getCachedObject,
	invalidateCache,
	invalidateObjectCache,
	setCache,
	setCachedObject,
} from "./git-cache";
import { isR2NotFoundError } from "./git-errors";
import {
	getRepoGitStoragePrefix,
	getRepoGitStorageRoot,
} from "./git-storage-naming";
import { perfNote, recordCacheHit, recordCacheMiss } from "./perf-log";

// ponytail: coalesces concurrent reads for the same R2 key so a single pack file
// (e.g. 1.5 MB) is only downloaded once even when 100+ object reads fire in parallel.
const pendingDownloads = new Map<string, Promise<Buffer>>();

// Same idea as pendingDownloads, for stat() — see the comment where this is used.
const pendingStats = new Map<string, Promise<R2Stat>>();

// isomorphic-git's own ref resolution tries several candidate paths in order
// (packed-refs, <ref>, refs/<ref>, refs/tags/<ref>, refs/heads/<ref>) on every
// resolveRef call, and readObject probes a loose-object path before falling back
// to pack search on every object read — most repos don't have packed-refs or a
// bare `main` ref file, and most objects here are packed rather than loose, so
// those lookups 404 the *same way* every single time. Measured: a single blob
// read against a real repo repeated the same 4 failed ref-candidate GETs and 3
// failed loose-object GETs even on a warm buffer cache, ~900ms wasted on lookups
// that were already known to fail. Cache negative results (and directory-exists
// positives for stat()) in the object cache — separate from the content buffer
// cache since these aren't buffers — invalidated by the same push-triggered sweep
// in git-repo-storage.ts that clears everything else for a repo.
type StatMarker = { kind: "missing" } | { kind: "dir" };
const MISSING: StatMarker = { kind: "missing" };
const DIR: StatMarker = { kind: "dir" };

// A committed repo's history usually lives entirely in packs, so every commit
// walked by git.log() probes a loose-object path (objects/xx/yyyy...) that is
// guaranteed to 404 — and since each commit has a distinct oid, the per-key
// negative cache above never gets reused within the walk. Measured: a 60-commit
// walk paid ~85ms of real network latency per commit this way, ~5.2s serial,
// because isomorphic-git only learns the next oid to check after reading the
// current one. Detecting once per repo (single bounded LIST, 1 item — S3 keys
// sort loose dirs like "00".."ff" before "info"/"pack" lexically, so the first
// key under objects/ reveals whether any loose object exists at all) and
// caching that lets every loose-object read in the walk short-circuit locally.
// Must be flipped back to "present" the instant any loose object is actually
// written (see writeFile) or a real object would 404 after the repo goes from
// packed to holding new loose commits (e.g. mid-push, before repacking).
type LooseHint = { kind: "none" } | { kind: "present" };
const LOOSE_NONE: LooseHint = { kind: "none" };
const LOOSE_PRESENT: LooseHint = { kind: "present" };
const LOOSE_OBJECT_RE = /^objects\/[0-9a-f]{2}\/[0-9a-f]{38}$/;

function looseHintKey(ownerKey: string, repoName: string): string {
	return `loose-hint:${ownerKey}/${repoName}`;
}

/** Cheap one-time-per-repo check so readFile can skip doomed loose-object GETs. */
export async function detectLooseObjectsHint(
	ownerKey: string,
	repoName: string,
): Promise<void> {
	const key = looseHintKey(ownerKey, repoName);
	if (getCachedObject<LooseHint>(key)) return;
	const basePrefix = getR2Key(ownerKey, repoName, "");
	try {
		const files = await listR2Files(`${basePrefix}objects/`, 1);
		const hasLoose = files.some((f) =>
			LOOSE_OBJECT_RE.test(f.key.slice(basePrefix.length)),
		);
		setCachedObject(key, hasLoose ? LOOSE_PRESENT : LOOSE_NONE);
		perfNote(
			`loose objects for ${ownerKey}/${repoName}: ${hasLoose ? "present" : "none — skipping per-commit loose lookups"}`,
		);
	} catch {
		// Leave unknown — readFile falls back to its normal per-object round trip.
	}
}

function enoent(filepath: string, verb: "open" | "stat"): Error {
	return Object.assign(
		new Error(`ENOENT: no such file or directory, ${verb} '${filepath}'`),
		{ code: "ENOENT" },
	);
}

// Both of these are files isomorphic-git probes as a matter of course but
// that nothing in this codebase ever writes, making them structural,
// permanent 404s rather than merely "usually missing":
//  - "packed-refs": GitRefManager.resolve/listRefs unconditionally reads it
//    on *every* single ref resolution (no internal caching of its own — see
//    node_modules/isomorphic-git's GitRefManager.packedRefs); all refs here
//    are always loose, never packed (see git-branch-ops.ts).
//  - "shallow": probed by merge/log operations (GitShallowManager); this app
//    never advertises shallow-clone capabilities in git-http-iso.ts and never
//    creates a shallow repo, so it can never exist either.
// The MISSING marker set elsewhere in this file already turns a repeat lookup
// within one warm process into a cache hit, but that doesn't help the very
// first lookup, and doesn't help at all on a cold serverless invocation with
// an empty in-process cache (the common case on Vercel) — measured
// ~100-340ms of pure R2 round-trip latency paid on every single
// clone/fetch/push/merge for files that can never exist. Skip R2 entirely.
function isStructurallyAbsent(relativePath: string): boolean {
	return relativePath === "packed-refs" || relativePath === "shallow";
}

// A file's own cache key is never a prefix of its ancestor directories' cache
// keys (it's the other way around), so invalidateObjectCache(cacheKey) — which
// only clears keys *starting with* the written/deleted path — can never reach a
// stale "dir"/"missing" stat marker cached on a parent directory. Without this,
// a directory stat'd as missing before it had any content (e.g. the gitdir root
// on a brand-new repo, or refs/heads before the first branch push) stays
// negatively cached forever, even after a write puts real content under it.
function ancestorCacheKeys(
	ownerKey: string,
	repoName: string,
	relativePath: string,
): string[] {
	const keys: string[] = [];
	let dir = relativePath;
	while (dir.includes("/")) {
		dir = dir.slice(0, dir.lastIndexOf("/"));
		keys.push(`${ownerKey}/${repoName}/${dir}`);
	}
	keys.push(`${ownerKey}/${repoName}/`);
	return keys;
}

// Same idea as ancestorCacheKeys, but only for writes (writeFile/unlink), and
// deliberately one-directional: only clears a *missing* marker (a write can
// invalidate that — the ancestor now has content where before it had none).
// A *dir* marker is left alone, because a write or single-file delete
// underneath it essentially never turns it back into non-existent (unlike
// rmdir, which really can empty out an entire prefix — see its own use of
// ancestorCacheKeys above, which intentionally clears unconditionally).
// Clearing an already-correct "dir" marker just forces the next stat()
// (isomorphic-git re-stats the gitdir root before nearly every read) to pay a
// full HeadObject+ListObjects round trip for a fact that hadn't changed.
// Measured: a single 1-file commit writes ~3-5 objects (blob/tree/commit),
// and each write was invalidating the gitdir root's own "dir" marker, so
// every one of those writes' surrounding isomorphic-git calls repaid the
// ~300ms gitdir-root stat from scratch — several seconds of pure waste for
// one commit.
function clearStaleAncestorMarkers(
	ownerKey: string,
	repoName: string,
	relativePath: string,
): void {
	for (const key of ancestorCacheKeys(ownerKey, repoName, relativePath)) {
		if (getCachedObject<StatMarker>(key)?.kind === "missing") {
			deleteCachedObject(key);
		}
	}
}

interface R2Stat {
	type: "file" | "dir";
	mode: number;
	size: number;
	ino: number;
	mtimeMs: number;
	ctimeMs: number;
	uid: number;
	gid: number;
	dev: number;
	isFile: () => boolean;
	isDirectory: () => boolean;
	isSymbolicLink: () => boolean;
}

function fileStat(size: number): R2Stat {
	return {
		type: "file",
		mode: 0o100644,
		size,
		ino: 0,
		mtimeMs: Date.now(),
		ctimeMs: Date.now(),
		uid: 1,
		gid: 1,
		dev: 1,
		isFile: () => true,
		isDirectory: () => false,
		isSymbolicLink: () => false,
	};
}

function dirStat(): R2Stat {
	return {
		type: "dir",
		mode: 0o040000,
		size: 0,
		ino: 0,
		mtimeMs: Date.now(),
		ctimeMs: Date.now(),
		uid: 1,
		gid: 1,
		dev: 1,
		isFile: () => false,
		isDirectory: () => true,
		isSymbolicLink: () => false,
	};
}

// The actual R2 round trip(s) behind stat() — factored out so concurrent callers
// (see pendingStats above) can share a single in-flight call.
async function resolveStatFromR2(
	filepath: string,
	ownerKey: string,
	repoName: string,
	relativePath: string,
	cacheKey: string,
): Promise<R2Stat> {
	const r2Key = getR2Key(ownerKey, repoName, relativePath);

	// HeadObject is cheaper than GetObject and avoids downloading file content
	const meta = await headR2Object(r2Key);
	if (meta !== null) {
		return fileStat(meta.size);
	}

	// A loose-object leaf (objects/xx/yyyy...) is never a directory in this flat
	// storage model — nothing is ever written nested under an object's own oid
	// path — so the directory-prefix fallback below is guaranteed pointless for
	// it. isomorphic-git's own writeObjectLoose checks fs.exists() before every
	// single object write to avoid clobbering (see its comment), so this stat
	// runs once per blob/tree/commit written, always for brand-new content that
	// (by definition, before the HeadObject above 404s) doesn't exist yet —
	// skipping the extra ListObjects here cuts that from ~250-300ms to
	// ~100-200ms per object, every object, every commit.
	if (LOOSE_OBJECT_RE.test(relativePath)) {
		setCachedObject(cacheKey, MISSING);
		throw enoent(filepath, "stat");
	}

	// Not a file — check if it's a directory prefix. r2Key already ends in "/"
	// for the gitdir root itself (relativePath === "" — see
	// getRepoGitStoragePrefix), so blindly appending another "/" produced a
	// double-slash prefix that could never match any real (single-slash) key.
	// That meant the root's directory listing always came back empty, which
	// wrongly cached it as MISSING and threw ENOENT — the root's "dir" stat
	// never actually got to hit the cache-hit path below, so isomorphic-git
	// (which re-stats the gitdir root before nearly every read/write) paid a
	// full HeadObject+ListObjects round trip on every single call, request
	// after request, for the one directory that's *always* present.
	try {
		const prefix = r2Key.endsWith("/") ? r2Key : `${r2Key}/`;
		const files = await listR2Files(prefix, 1);
		if (files.length > 0) {
			setCachedObject(cacheKey, DIR);
			return dirStat();
		}
	} catch {}
	// isomorphic-git's FileSystem.exists() catches code==='ENOENT' to return false;
	// any other error is "unhandled" and aborts git.init / git.log / etc.
	setCachedObject(cacheKey, MISSING);
	throw enoent(filepath, "stat");
}

// R2 key pattern: repos/{ownerKey}/{repoName}/git/{path}
function getR2Key(
	ownerKey: string,
	repoName: string,
	filePath: string,
): string {
	// Normalize path - remove leading slashes
	const normalizedPath = filePath.startsWith("/")
		? filePath.slice(1)
		: filePath;
	return `${getRepoGitStoragePrefix(ownerKey, repoName)}${normalizedPath}`;
}

function stripGitDir(filepath: string): string {
	return filepath.replace(/^\/?repos\/[^/]+\/[^/]+\/git\/?/, "");
}

// Parse owner and repo from git directory path
function parseGitDir(dir: string): {
	ownerKey: string;
	repoName: string;
	prefix: string;
} {
	// Expected format: /repos/{ownerKey}/{repoName}/git or repos/{ownerKey}/{repoName}/git
	const parts = dir.split("/").filter((p) => p !== "");

	if (parts[0] === "repos" && parts.length >= 4 && parts[3] === "git") {
		return {
			ownerKey: parts[1],
			repoName: parts[2],
			prefix: getRepoGitStoragePrefix(parts[1], parts[2]),
		};
	}

	if (parts[0] === "repos" && parts.length >= 3) {
		return {
			ownerKey: parts[1],
			repoName: parts[2],
			prefix: `${getRepoGitStorageRoot(parts[1], parts[2])}/`,
		};
	}

	throw new Error(`Invalid git directory path: ${dir}`);
}

/**
 * R2 Filesystem Backend
 *
 * Implements the filesystem interface required by isomorphic-git.
 * All operations are routed to R2 with local caching for reads.
 */
export class R2Backend {
	/**
	 * Read file from R2 (with caching)
	 */
	async readFile(
		filepath: string,
		options?: { encoding?: string },
	): Promise<Buffer | string> {
		const { ownerKey, repoName } = parseGitDir(filepath);
		const relativePath = stripGitDir(filepath);
		const cacheKey = `${ownerKey}/${repoName}/${relativePath}`;

		if (isStructurallyAbsent(relativePath)) {
			recordCacheHit();
			throw enoent(filepath, "open");
		}

		// See detectLooseObjectsHint: most repos are fully packed, so a loose-object
		// path is a guaranteed 404 — skip the R2 round trip entirely once we know that.
		if (LOOSE_OBJECT_RE.test(relativePath)) {
			const hint = getCachedObject<LooseHint>(looseHintKey(ownerKey, repoName));
			if (hint?.kind === "none") {
				recordCacheHit();
				throw enoent(filepath, "open");
			}
		}

		// Try cache first
		const cached = getCache(cacheKey);
		if (cached) {
			recordCacheHit();
			return options?.encoding === "utf8" ? cached.toString("utf8") : cached;
		}

		// isomorphic-git's ref-candidate scan and loose-object probe both retry the
		// exact same non-existent paths on every call — skip straight to ENOENT
		// instead of re-asking R2 something we already know.
		const marker = getCachedObject<StatMarker>(cacheKey);
		if (marker?.kind === "missing") {
			recordCacheHit();
			throw enoent(filepath, "open");
		}
		recordCacheMiss();

		// Fetch from R2, coalescing concurrent requests for the same key
		const r2Key = getR2Key(ownerKey, repoName, relativePath);

		const existing = pendingDownloads.get(r2Key);
		if (existing) {
			const buffer = await existing;
			return options?.encoding === "utf8" ? buffer.toString("utf8") : buffer;
		}

		const download = downloadFromR2(r2Key)
			.then((result) => {
				const buffer = Buffer.from(result.content);
				setCache(cacheKey, buffer);
				pendingDownloads.delete(r2Key);
				return buffer;
			})
			.catch((error: unknown) => {
				pendingDownloads.delete(r2Key);
				throw error;
			});
		pendingDownloads.set(r2Key, download);

		try {
			const buffer = await download;
			return options?.encoding === "utf8" ? buffer.toString("utf8") : buffer;
		} catch (error) {
			if (isR2NotFoundError(error)) {
				setCachedObject(cacheKey, MISSING);
				throw enoent(filepath, "open");
			}
			throw error;
		}
	}

	/**
	 * Write file to R2 (with cache invalidation)
	 */
	async writeFile(
		filepath: string,
		data: Buffer | string,
		_options?: { mode?: number },
	): Promise<void> {
		const { ownerKey, repoName } = parseGitDir(filepath);
		const relativePath = stripGitDir(filepath);
		const cacheKey = `${ownerKey}/${repoName}/${relativePath}`;

		// Convert string to buffer if needed
		const buffer = typeof data === "string" ? Buffer.from(data) : data;

		// Determine content type based on path
		let contentType = "application/octet-stream";
		if (relativePath.startsWith("refs/")) {
			contentType = "text/plain";
		} else if (relativePath === "HEAD" || relativePath === "config") {
			contentType = "text/plain";
		}

		// Upload to R2
		const r2Key = getR2Key(ownerKey, repoName, relativePath);
		await uploadToR2(r2Key, buffer, contentType);

		// A loose object just got written — flip the hint immediately so any read
		// racing behind this one doesn't wrongly short-circuit to ENOENT.
		if (LOOSE_OBJECT_RE.test(relativePath)) {
			setCachedObject(looseHintKey(ownerKey, repoName), LOOSE_PRESENT);
		}

		// Invalidate file cache, any stale ("missing") stat marker on an ancestor
		// directory — see clearStaleAncestorMarkers — and parent dir listing cache
		deleteCache(cacheKey);
		invalidateObjectCache(cacheKey);
		const parentDir = relativePath.includes("/")
			? relativePath.slice(0, relativePath.lastIndexOf("/"))
			: "";
		deleteCache(`dir:${ownerKey}/${repoName}/${parentDir}`);
		clearStaleAncestorMarkers(ownerKey, repoName, relativePath);
	}

	/**
	 * Delete file from R2
	 */
	async unlink(filepath: string): Promise<void> {
		const { ownerKey, repoName } = parseGitDir(filepath);
		const relativePath = stripGitDir(filepath);
		const cacheKey = `${ownerKey}/${repoName}/${relativePath}`;

		const r2Key = getR2Key(ownerKey, repoName, relativePath);
		await deleteFromR2(r2Key);

		// Invalidate file cache, any stale ("missing") stat marker on an ancestor
		// directory — see clearStaleAncestorMarkers — and parent dir listing cache
		deleteCache(cacheKey);
		invalidateObjectCache(cacheKey);
		const parentDir = relativePath.includes("/")
			? relativePath.slice(0, relativePath.lastIndexOf("/"))
			: "";
		deleteCache(`dir:${ownerKey}/${repoName}/${parentDir}`);
		clearStaleAncestorMarkers(ownerKey, repoName, relativePath);
	}

	/**
	 * Read directory (list objects with prefix)
	 */
	async readdir(filepath: string): Promise<string[]> {
		const { ownerKey, repoName } = parseGitDir(filepath);
		const relativePath = stripGitDir(filepath);

		// Cache dir listings — cuts R2 LIST calls for repeated readdir (refs/, objects/, etc.)
		const dirCacheKey = `dir:${ownerKey}/${repoName}/${relativePath}`;
		const cachedDir = getCache(dirCacheKey);
		if (cachedDir) {
			recordCacheHit();
			return JSON.parse(cachedDir.toString()) as string[];
		}
		recordCacheMiss();

		// Ensure path ends with / for prefix matching
		const prefix = relativePath ? `${relativePath}/` : "";
		const r2Prefix = getR2Key(ownerKey, repoName, prefix);

		try {
			const files = await listAllR2Files(r2Prefix);

			// Extract just the filenames (remove prefix and subdirectories)
			const names = new Set<string>();
			for (const file of files) {
				const fullPath = file.key.replace(r2Prefix, "");
				const parts = fullPath.split("/");
				if (parts[0]) {
					names.add(parts[0]);
				}
			}

			const result = Array.from(names).sort();
			setCache(dirCacheKey, Buffer.from(JSON.stringify(result)));
			return result;
		} catch {
			// Return empty array if directory doesn't exist
			return [];
		}
	}

	/**
	 * Create directory (no-op in R2 - object storage is flat)
	 */
	async mkdir(
		_filepath: string,
		_options?: { recursive?: boolean },
	): Promise<void> {
		// No-op: R2 doesn't require directory creation
		// Objects can be created with any prefix
	}

	/**
	 * Remove directory (delete all objects with prefix)
	 */
	async rmdir(filepath: string): Promise<void> {
		const { ownerKey, repoName } = parseGitDir(filepath);
		const relativePath = stripGitDir(filepath);

		const prefix = relativePath ? `${relativePath}/` : "";
		const r2Prefix = getR2Key(ownerKey, repoName, prefix);

		// List and delete all objects with this prefix
		const files = await listAllR2Files(r2Prefix);
		if (files.length > 0) {
			await bulkDeleteFromR2(files.map((f) => f.key));
		}

		// Invalidate cache for this prefix, plus ancestor stat markers — removing
		// the last entry under a directory can turn an ancestor from "dir" back
		// into "missing" (see ancestorCacheKeys).
		invalidateCache(`${ownerKey}/${repoName}/${prefix}`);
		invalidateObjectCache(`${ownerKey}/${repoName}/${prefix}`);
		for (const key of ancestorCacheKeys(ownerKey, repoName, relativePath)) {
			deleteCachedObject(key);
		}
	}

	/**
	 * Get file stats
	 */
	async stat(filepath: string): Promise<R2Stat> {
		const { ownerKey, repoName } = parseGitDir(filepath);
		const relativePath = stripGitDir(filepath);
		const cacheKey = `${ownerKey}/${repoName}/${relativePath}`;

		if (isStructurallyAbsent(relativePath)) {
			throw enoent(filepath, "stat");
		}

		// If content is cached we already know the file exists — skip HeadObject
		const cached = getCache(cacheKey);
		if (cached) {
			return fileStat(cached.length);
		}

		// The gitdir root (and other structural directories) gets stat'd repeatedly
		// within a single request — isomorphic-git checks it before ref resolution,
		// before every readCommit, and before every readTree/readBlob. Without this,
		// each of those redid a HeadObject + ListObjects pair (measured: the same
		// gitdir stat repeated 3-4x in one file read, ~350ms each). Same idea for
		// paths that don't exist — HeadObject-then-ListObjects only to come up empty
		// every time.
		const marker = getCachedObject<StatMarker>(cacheKey);
		if (marker?.kind === "dir") return dirStat();
		if (marker?.kind === "missing") throw enoent(filepath, "stat");

		// The marker cache above only helps *repeated* lookups — it can't help
		// several concurrent callers that all miss the cache at the same instant,
		// since none of them can see a result the others haven't produced yet.
		// git-http-iso.ts's listAllRefs, for instance, fires listBranches/listTags/
		// resolveRef(HEAD)/currentBranch all in one Promise.all, and each
		// independently stats the gitdir root first — measured 4 concurrent callers
		// = 4 real HeadObject+ListObjects pairs against the identical key. Coalesce
		// concurrent stat() calls the same way readFile already coalesces concurrent
		// downloads (pendingDownloads, above).
		const existingStat = pendingStats.get(cacheKey);
		if (existingStat) return existingStat;

		const statPromise = resolveStatFromR2(
			filepath,
			ownerKey,
			repoName,
			relativePath,
			cacheKey,
		).finally(() => {
			pendingStats.delete(cacheKey);
		});
		pendingStats.set(cacheKey, statPromise);
		return statPromise;
	}

	/**
	 * Get file stats (symbolic link aware)
	 */
	async lstat(filepath: string): Promise<R2Stat> {
		// For R2, lstat is the same as stat (no symbolic links in object storage)
		return this.stat(filepath);
	}

	/**
	 * Read symbolic link (not supported in R2)
	 */
	async readlink(_filepath: string): Promise<string> {
		throw new Error("Symbolic links are not supported in R2 backend");
	}

	/**
	 * Create symbolic link (not supported in R2)
	 */
	async symlink(_target: string, _filepath: string): Promise<void> {
		throw new Error("Symbolic links are not supported in R2 backend");
	}

	/**
	 * Change file permissions (no-op in R2)
	 */
	async chmod(_filepath: string, _mode: number): Promise<void> {
		// No-op: R2 doesn't support file permissions
	}
}

// Export singleton instance
export const r2Backend = new R2Backend();

// isomorphic-git's git.log() is inherently sequential — each commit's parent oid
// is only known after reading that commit — so a deep walk against R2 pays one
// R2 round trip *per commit* whenever the commit it needs isn't in an
// already-downloaded pack. A repo's history usually only lives in a handful of
// packs, so downloading all of them up front in parallel — before the sequential
// walk starts — turns "N sequential network round trips" into "a few parallel
// downloads, then N in-memory reads". Caller decides when this trade-off is
// worth it (a depth=1 lookup shouldn't pay to warm every pack).
//
// Measured on a real repo: this cut the network portion from being interleaved
// through the walk to a flat ~2.2s parallel batch for 15 packs — but the walk
// itself still took ~11s afterward, because isomorphic-git's pack-index parsing
// and delta decompression is CPU-bound, not network-bound, once the bytes are
// local. This function only fixes the network half of that; the CPU half would
// need either fewer/larger packs (periodic repacking) or a persistent
// cross-process cache to avoid re-parsing on every cold start — out of scope here.
//
// MAX_PACKS_TO_PREFETCH bounds the damage for a repo with a long, fragmented
// history: unconditionally prefetching *every* pack would download a rewind
// through the entire history even when the caller only asked for a shallow
// depth, which for an old/large repo could mean pulling down far more data than
// the walk will ever touch. Skip prefetching (fall back to isomorphic-git's own
// lazy per-pack fetch) rather than guess which packs are "recent enough".
const MAX_PACKS_TO_PREFETCH = 30;

export async function prefetchAllPacks(
	ownerKey: string,
	repoName: string,
): Promise<void> {
	const gitdir = getRepoGitStorageRoot(ownerKey, repoName);
	let files: string[];
	try {
		files = await r2Backend.readdir(`${gitdir}/objects/pack`);
	} catch {
		return;
	}
	if (files.length > MAX_PACKS_TO_PREFETCH * 2) return; // *2: each pack is an .idx + .pack pair
	await Promise.all([
		detectLooseObjectsHint(ownerKey, repoName),
		...files.map((name) =>
			r2Backend.readFile(`${gitdir}/objects/pack/${name}`).catch(() => {}),
		),
	]);
}
