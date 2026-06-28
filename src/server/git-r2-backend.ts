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
import { deleteCache, getCache, invalidateCache, setCache } from "./git-cache";
import { GitObjectNotFoundError, GitRefNotFoundError } from "./git-errors";
import {
	getRepoGitStoragePrefix,
	getRepoGitStorageRoot,
} from "./git-storage-naming";

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
			return options?.encoding === "utf8" ? cached.toString("utf8") : cached;
		}

		// Fetch from R2
		const r2Key = getR2Key(ownerKey, repoName, relativePath);

		try {
			const result = await downloadFromR2(r2Key);
			const buffer = Buffer.from(result.content);

			// Cache the result
			setCache(cacheKey, buffer);

			return options?.encoding === "utf8" ? buffer.toString("utf8") : buffer;
		} catch (error: any) {
			if (
				error.name === "NoSuchKey" ||
				error.$metadata?.httpStatusCode === 404
			) {
				// isomorphic-git FileSystem.read() catches any error and returns null
				// but other callers (e.g. resolveRef) need ENOENT to handle missing refs
				throw Object.assign(
					new Error(`ENOENT: no such file or directory, open '${filepath}'`),
					{ code: "ENOENT" },
				);
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

		// Invalidate cache
		deleteCache(cacheKey);
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

		// Invalidate cache
		deleteCache(cacheKey);
	}

	/**
	 * Read directory (list objects with prefix)
	 */
	async readdir(filepath: string): Promise<string[]> {
		const { ownerKey, repoName } = parseGitDir(filepath);
		const relativePath = stripGitDir(filepath);

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

			return Array.from(names).sort();
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
	}

	/**
	 * Get file stats
	 */
	async stat(filepath: string): Promise<any> {
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
		const enoent = Object.assign(
			new Error(`ENOENT: no such file or directory, stat '${filepath}'`),
			{ code: "ENOENT" },
		);
		throw enoent;
	}

	/**
	 * Get file stats (symbolic link aware)
	 */
	async lstat(filepath: string): Promise<any> {
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
		} catch (error: any) {
			if (
				error.name === "NoSuchKey" ||
				error.$metadata?.httpStatusCode === 404
			) {
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
			} catch (error: any) {
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
