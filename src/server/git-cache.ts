import { LRUCache } from "lru-cache";

const MAX_SIZE = Number.parseInt(
	process.env.GIT_CACHE_MAX_SIZE || "1073741824",
	10,
);
const TTL = Number.parseInt(process.env.GIT_CACHE_TTL || "3600", 10) * 1000;

// Raw buffer cache — for git objects read from R2
const cache = new LRUCache<string, Buffer>({
	maxSize: MAX_SIZE,
	sizeCalculation: (v) => v.length,
	ttl: TTL,
});

export const getCache = (key: string): Buffer | null => cache.get(key) ?? null;

export const setCache = (key: string, value: Buffer): void => {
	if (value.length <= MAX_SIZE * 0.1) cache.set(key, value);
};

export const deleteCache = (key: string): void => {
	cache.delete(key);
};

export function invalidateCache(prefix: string): void {
	for (const k of cache.keys()) {
		if (k.startsWith(prefix)) cache.delete(k);
	}
}

// Parsed-object cache — stores JS values directly, avoiding JSON.parse on every hit
// ponytail: separate instance so sizeCalculation can use JSON.stringify length estimate
const objectCache = new LRUCache<string, unknown>({
	maxSize: MAX_SIZE / 4,
	sizeCalculation: (v) => JSON.stringify(v).length,
	ttl: TTL,
});

export function getCachedObject<T>(key: string): T | null {
	return (objectCache.get(key) as T) ?? null;
}

export function setCachedObject<T>(key: string, value: T): void {
	objectCache.set(key, value);
}

export function invalidateObjectCache(prefix: string): void {
	for (const k of objectCache.keys()) {
		if (k.startsWith(prefix)) objectCache.delete(k);
	}
}
