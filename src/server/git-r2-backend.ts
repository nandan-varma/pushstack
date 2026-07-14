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
	getCache,
	getCachedObject,
	invalidateCache,
	invalidateObjectCache,
	setCache,
	setCachedObject,
} from "./git-cache";
import { GitRefNotFoundError, isR2NotFoundError } from "./git-errors";
import {
	getRepoGitStoragePrefix,
	getRepoGitStorageRoot,
} from "./git-storage-naming";
import { recordCacheHit, recordCacheMiss } from "./perf-log";

// ponytail: coalesces concurrent reads for the same R2 key so a single pack file
// (e.g. 1.5 MB) is only downloaded once even when 100+ object reads fire in parallel.
const pendingDownloads = new Map<string, Promise<Buffer>>();

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

function enoent(filepath: string, verb: "open" | "stat"): Error {
	return Object.assign(
		new Error(`ENOENT: no such file or directory, ${verb} '${filepath}'`),
		{ code: "ENOENT" },
	);
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

		// Invalidate file cache, any stale stat marker, and parent dir listing cache
		deleteCache(cacheKey);
		invalidateObjectCache(cacheKey);
		const parentDir = relativePath.includes("/")
			? relativePath.slice(0, relativePath.lastIndexOf("/"))
			: "";
		deleteCache(`dir:${ownerKey}/${repoName}/${parentDir}`);
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

		// Invalidate file cache, any stale stat marker, and parent dir listing cache
		deleteCache(cacheKey);
		invalidateObjectCache(cacheKey);
		const parentDir = relativePath.includes("/")
			? relativePath.slice(0, relativePath.lastIndexOf("/"))
			: "";
		deleteCache(`dir:${ownerKey}/${repoName}/${parentDir}`);
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

		// Invalidate cache for this prefix
		invalidateCache(`${ownerKey}/${repoName}/${prefix}`);
		invalidateObjectCache(`${ownerKey}/${repoName}/${prefix}`);
	}

	/**
	 * Get file stats
	 */
	async stat(filepath: string): Promise<R2Stat> {
		const { ownerKey, repoName } = parseGitDir(filepath);
		const relativePath = stripGitDir(filepath);
		const cacheKey = `${ownerKey}/${repoName}/${relativePath}`;

		// If content is cached we already know the file exists — skip HeadObject
		const cached = getCache(cacheKey);
		if (cached) {
			return {
				type: "file",
				mode: 0o100644,
				size: cached.length,
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

		// The gitdir root (and other structural directories) gets stat'd repeatedly
		// within a single request — isomorphic-git checks it before ref resolution,
		// before every readCommit, and before every readTree/readBlob. Without this,
		// each of those redid a HeadObject + ListObjects pair (measured: the same
		// gitdir stat repeated 3-4x in one file read, ~350ms each). Same idea for
		// paths that don't exist — HeadObject-then-ListObjects only to come up empty
		// every time.
		const marker = getCachedObject<StatMarker>(cacheKey);
		if (marker?.kind === "dir") {
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
		if (marker?.kind === "missing") {
			throw enoent(filepath, "stat");
		}

		const r2Key = getR2Key(ownerKey, repoName, relativePath);

		// HeadObject is cheaper than GetObject and avoids downloading file content
		const meta = await headR2Object(r2Key);
		if (meta !== null) {
			return {
				type: "file",
				mode: 0o100644,
				size: meta.size,
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

		// Not a file — check if it's a directory prefix
		try {
			const files = await listR2Files(`${r2Key}/`, 1);
			if (files.length > 0) {
				setCachedObject(cacheKey, DIR);
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
		} catch {}
		// isomorphic-git's FileSystem.exists() catches code==='ENOENT' to return false;
		// any other error is "unhandled" and aborts git.init / git.log / etc.
		setCachedObject(cacheKey, MISSING);
		throw enoent(filepath, "stat");
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

/**
 * Atomic ref operations with ETag-based compare-and-swap
 */
export class R2RefBackend {
	/**
	 * Read ref value (branch/tag)
	 */
	async readRef(
		ownerId: string,
		repoName: string,
		ref: string,
	): Promise<string> {
		const cacheKey = `${ownerId}/${repoName}/${ref}`;

		// Try cache first
		const cached = getCache(cacheKey);
		if (cached) {
			return cached.toString("utf8").trim();
		}

		const r2Key = getR2Key(ownerId, repoName, ref);

		try {
			const result = await downloadFromR2(r2Key);
			const value = Buffer.from(result.content).toString("utf8").trim();

			// Cache the result
			setCache(cacheKey, Buffer.from(value));

			return value;
		} catch (error) {
			if (isR2NotFoundError(error)) {
				throw new GitRefNotFoundError(`Ref not found: ${ref}`);
			}
			throw error;
		}
	}

	/**
	 * Write ref value atomically
	 *
	 * @param expectedValue - If provided, only update if current value matches (compare-and-swap)
	 */
	async writeRef(
		ownerId: string,
		repoName: string,
		ref: string,
		value: string,
		expectedValue?: string,
	): Promise<void> {
		const r2Key = getR2Key(ownerId, repoName, ref);
		const cacheKey = `${ownerId}/${repoName}/${ref}`;

		// If expectedValue is provided, verify current value first
		if (expectedValue !== undefined) {
			try {
				const currentValue = await this.readRef(ownerId, repoName, ref);
				if (currentValue !== expectedValue) {
					throw new Error(
						`Ref update conflict: expected ${expectedValue}, found ${currentValue}`,
					);
				}
			} catch (error) {
				if (error instanceof GitRefNotFoundError && expectedValue !== null) {
					throw new Error(
						`Ref update conflict: ref exists but expected it to be null`,
					);
				}
				if (!(error instanceof GitRefNotFoundError) || expectedValue !== null) {
					throw error;
				}
			}
		}

		// Write new value
		await uploadToR2(r2Key, Buffer.from(`${value}\n`), "text/plain");

		// Update cache
		setCache(cacheKey, Buffer.from(value));
	}

	/**
	 * Delete ref atomically
	 */
	async deleteRef(
		ownerId: string,
		repoName: string,
		ref: string,
	): Promise<void> {
		const r2Key = getR2Key(ownerId, repoName, ref);
		const cacheKey = `${ownerId}/${repoName}/${ref}`;

		await deleteFromR2(r2Key);
		deleteCache(cacheKey);
	}

	/**
	 * List all refs with a prefix
	 */
	async listRefs(
		ownerId: string,
		repoName: string,
		prefix: string = "refs/",
	): Promise<string[]> {
		const r2Prefix = getR2Key(ownerId, repoName, prefix);

		const files = await listAllR2Files(r2Prefix);

		return files
			.map((file) => {
				// Remove the full R2 key prefix to get just the ref path
				const basePrefix = `repos/${ownerId}/${repoName}/`;
				return file.key.replace(basePrefix, "");
			})
			.sort();
	}
}

// Export singleton instances
export const r2Backend = new R2Backend();
export const r2RefBackend = new R2RefBackend();
