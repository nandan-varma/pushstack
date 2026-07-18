import { LRUCache } from "lru-cache";

const MAX_SIZE = Number.parseInt(
	process.env.GIT_CACHE_MAX_SIZE || "1073741824",
	10,
);
const TTL = Number.parseInt(process.env.GIT_CACHE_TTL || "3600", 10) * 1000;

// The raw git-object Buffer cache that used to live here moved into
// @nandan-varma/git-fs-s3's createCachedStore (composed in git-fs.ts).

// Parsed-object cache — stores JS values directly, avoiding JSON.parse on every hit
// ponytail: separate instance so sizeCalculation can use JSON.stringify length estimate
const objectCache = new LRUCache<string, object>({
	maxSize: MAX_SIZE / 4,
	sizeCalculation: (v) => JSON.stringify(v).length,
	ttl: TTL,
});

export function getCachedObject<T extends object>(key: string): T | null {
	return (objectCache.get(key) as T) ?? null;
}

export function setCachedObject<T extends object>(key: string, value: T): void {
	objectCache.set(key, value);
}

export function deleteCachedObject(key: string): void {
	objectCache.delete(key);
}

export function invalidateObjectCache(prefix: string): void {
	for (const k of objectCache.keys()) {
		if (k.startsWith(prefix)) objectCache.delete(k);
	}
}
