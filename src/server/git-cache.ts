/**
 * LRU Cache for Git Objects
 *
 * Provides memory-based caching with optional filesystem persistence
 * to reduce R2 read operations and improve performance.
 */

import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

// Configuration from environment
const CACHE_MAX_SIZE = parseInt(
	process.env.GIT_CACHE_MAX_SIZE || "1073741824",
	10,
); // 1GB default
const CACHE_TTL = parseInt(process.env.GIT_CACHE_TTL || "3600", 10) * 1000; // 1 hour default
const CACHE_DIR = process.env.GIT_CACHE_DIR || ".cache/git";
// ponytail: opt-in only — Vercel's process.cwd() is read-only and /tmp is ephemeral per-invocation
const USE_FILESYSTEM_CACHE = process.env.GIT_CACHE_FILESYSTEM === "true";

interface CacheEntry {
	key: string;
	value: Buffer;
	size: number;
	timestamp: number;
	hits: number;
}

class LRUCache {
	private cache = new Map<string, CacheEntry>();
	private totalSize = 0;
	private maxSize: number;
	private ttl: number;

	constructor(maxSize: number, ttl: number) {
		this.maxSize = maxSize;
		this.ttl = ttl;
	}

	/**
	 * Get value from cache
	 */
	get(key: string): Buffer | null {
		const entry = this.cache.get(key);

		if (!entry) {
			return null;
		}

		// Check if expired
		if (Date.now() - entry.timestamp > this.ttl) {
			this.delete(key);
			return null;
		}

		// Update hit count and move to end (most recently used)
		entry.hits++;
		entry.timestamp = Date.now();
		this.cache.delete(key);
		this.cache.set(key, entry);

		return entry.value;
	}

	/**
	 * Set value in cache
	 */
	set(key: string, value: Buffer): void {
		const size = value.length;

		// Don't cache objects larger than 10% of max cache size
		if (size > this.maxSize * 0.1) {
			return;
		}

		// Delete existing entry if present
		if (this.cache.has(key)) {
			this.delete(key);
		}

		// Evict entries if needed to make space
		while (this.totalSize + size > this.maxSize && this.cache.size > 0) {
			this.evictLRU();
		}

		// Add new entry
		const entry: CacheEntry = {
			key,
			value,
			size,
			timestamp: Date.now(),
			hits: 0,
		};

		this.cache.set(key, entry);
		this.totalSize += size;
	}

	/**
	 * Delete entry from cache
	 */
	delete(key: string): void {
		const entry = this.cache.get(key);
		if (entry) {
			this.cache.delete(key);
			this.totalSize -= entry.size;
		}
	}

	/**
	 * Evict least recently used entry
	 */
	private evictLRU(): void {
		// First entry in Map is least recently used (we move entries to end on access)
		const firstKey = this.cache.keys().next().value;
		if (firstKey) {
			this.delete(firstKey);
		}
	}

	/**
	 * Invalidate all entries matching prefix
	 */
	invalidatePrefix(prefix: string): void {
		const keysToDelete: string[] = [];

		for (const key of this.cache.keys()) {
			if (key.startsWith(prefix)) {
				keysToDelete.push(key);
			}
		}

		for (const key of keysToDelete) {
			this.delete(key);
		}
	}

	/**
	 * Clear entire cache
	 */
	clear(): void {
		this.cache.clear();
		this.totalSize = 0;
	}

	/**
	 * Get cache statistics
	 */
	getStats() {
		return {
			entries: this.cache.size,
			totalSize: this.totalSize,
			maxSize: this.maxSize,
			utilizationPercent: (this.totalSize / this.maxSize) * 100,
		};
	}
}

// Singleton cache instance
const cache = new LRUCache(CACHE_MAX_SIZE, CACHE_TTL);

/**
 * Get filesystem cache path for a key
 */
function getCachePath(key: string): string {
	// Hash the key to create a safe filename
	const hash = createHash("sha256").update(key).digest("hex");
	const dir = join(CACHE_DIR, hash.slice(0, 2));
	return join(dir, hash.slice(2));
}

/**
 * Get value from cache (memory + optional filesystem)
 */
export function getCache(key: string): Buffer | null {
	// Try memory cache first
	const memoryValue = cache.get(key);
	if (memoryValue) {
		return memoryValue;
	}

	// Try filesystem cache if enabled
	if (USE_FILESYSTEM_CACHE) {
		try {
			const cachePath = getCachePath(key);
			if (existsSync(cachePath)) {
				const value = readFileSync(cachePath);

				// Populate memory cache
				cache.set(key, value);

				return value;
			}
		} catch (error) {
			// Filesystem cache miss or error, continue
		}
	}

	return null;
}

/**
 * Set value in cache (memory + optional filesystem)
 */
export function setCache(key: string, value: Buffer): void {
	// Set in memory cache
	cache.set(key, value);

	// Set in filesystem cache if enabled
	if (USE_FILESYSTEM_CACHE) {
		try {
			const cachePath = getCachePath(key);
			const dir = dirname(cachePath);

			// Create directory if needed
			if (!existsSync(dir)) {
				mkdirSync(dir, { recursive: true });
			}

			writeFileSync(cachePath, value);
		} catch (error) {
			// Filesystem cache write failed, continue (memory cache still set)
			console.error("Failed to write filesystem cache:", error);
		}
	}
}

/**
 * Delete value from cache (memory + filesystem)
 */
export function deleteCache(key: string): void {
	// Delete from memory cache
	cache.delete(key);

	// Delete from filesystem cache if enabled
	if (USE_FILESYSTEM_CACHE) {
		try {
			const cachePath = getCachePath(key);
			if (existsSync(cachePath)) {
				unlinkSync(cachePath);
			}
		} catch (error) {
			// Filesystem cache delete failed, continue
		}
	}
}

/**
 * Invalidate all cache entries matching prefix
 */
export function invalidateCache(prefix: string): void {
	cache.invalidatePrefix(prefix);

	// Note: Filesystem cache invalidation by prefix is expensive
	// We rely on TTL to expire filesystem cache entries
}

/**
 * Clear entire cache
 */
export function clearCache(): void {
	cache.clear();
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
	return cache.getStats();
}
