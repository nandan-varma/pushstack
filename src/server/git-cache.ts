import { LRUCache } from "lru-cache";

const MAX_SIZE = Number.parseInt(
	process.env.GIT_CACHE_MAX_SIZE || "1073741824",
	10,
);
const TTL = Number.parseInt(process.env.GIT_CACHE_TTL || "3600", 10) * 1000;

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
