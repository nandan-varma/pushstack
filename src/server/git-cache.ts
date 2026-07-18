import type { ParsedObjectStore } from "@nandan-varma/git-edge";
import { createParsedObjectCache } from "@nandan-varma/git-edge";

// The raw git-object Buffer cache that used to live here moved into
// @nandan-varma/git-fs-s3's createCachedStore (composed in git-fs.ts).

// Parsed-object cache — stores JS values directly, avoiding JSON.parse on every hit.
// Delegates to @nandan-varma/git-edge's generalized LRU cache.
const objectCache: ParsedObjectStore = createParsedObjectCache({
	maxSize:
		Number.parseInt(process.env.GIT_CACHE_MAX_SIZE || "1073741824", 10) / 4,
	ttl: Number.parseInt(process.env.GIT_CACHE_TTL || "3600", 10) * 1000,
});

export function getCachedObject<T extends object>(key: string): T | null {
	return objectCache.get<T>(key);
}

export function setCachedObject<T extends object>(key: string, value: T): void {
	objectCache.set(key, value);
}

export function deleteCachedObject(key: string): void {
	objectCache.delete(key);
}

export function invalidateObjectCache(prefix: string): void {
	objectCache.invalidatePrefix(prefix);
}
