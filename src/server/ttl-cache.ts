/**
 * In-process TTL cache with in-flight request coalescing, for short-lived
 * per-request Postgres reads (repo rows, access decisions) that would
 * otherwise be re-fetched multiple times within the same page load. Two
 * independent hand-rolled copies of this shape used to live in
 * repo-access.ts and repositories.ts.
 */
export interface TtlCoalescedCacheOptions {
	ttlMs: number;
	onHit?: (key: string) => void;
	onMiss?: (key: string) => void;
	onCoalesce?: (key: string) => void;
}

export interface TtlCoalescedCache<V> {
	get(key: string, fetch: () => Promise<V>): Promise<V>;
	set(key: string, value: V): void;
	delete(key: string): void;
}

export function createTtlCoalescedCache<V>(
	options: TtlCoalescedCacheOptions,
): TtlCoalescedCache<V> {
	const { ttlMs, onHit, onMiss, onCoalesce } = options;
	const cache = new Map<string, { value: V; at: number }>();
	const inFlight = new Map<string, Promise<V>>();

	return {
		async get(key: string, fetch: () => Promise<V>): Promise<V> {
			const cached = cache.get(key);
			if (cached && Date.now() - cached.at < ttlMs) {
				onHit?.(key);
				return cached.value;
			}

			const existing = inFlight.get(key);
			if (existing) {
				onCoalesce?.(key);
				return existing;
			}

			onMiss?.(key);
			const promise = fetch();
			inFlight.set(key, promise);
			try {
				const result = await promise;
				cache.set(key, { value: result, at: Date.now() });
				return result;
			} finally {
				inFlight.delete(key);
			}
		},

		set(key: string, value: V): void {
			cache.set(key, { value, at: Date.now() });
		},

		delete(key: string): void {
			cache.delete(key);
		},
	};
}
