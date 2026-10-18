/**
 * In-process TTL cache with in-flight coalescing, for short-lived Postgres
 * reads (repository rows, access decisions) repeated within one page load.
 * Bounded: past `maxEntries`, the oldest entries go first.
 */
export interface TtlCoalescedCache<V> {
	get(key: string, fetch: () => Promise<V>): Promise<V>;
	set(key: string, value: V): void;
	/** Forget `key`, including a fetch still in flight (it won't be cached). */
	delete(key: string): void;
}

export function createTtlCoalescedCache<V>(options: {
	ttlMs: number;
	maxEntries?: number;
	onHit?: (key: string) => void;
	onMiss?: (key: string) => void;
	onCoalesce?: (key: string) => void;
}): TtlCoalescedCache<V> {
	const { ttlMs, onHit, onMiss, onCoalesce } = options;
	const maxEntries = options.maxEntries ?? 10_000;
	// Map iteration is insertion order, so the first key is the oldest.
	const cache = new Map<string, { value: V; expiresAt: number }>();
	const inFlight = new Map<string, Promise<V>>();

	function store(key: string, value: V): void {
		cache.delete(key);
		cache.set(key, { value, expiresAt: Date.now() + ttlMs });
		while (cache.size > maxEntries) {
			const oldest = cache.keys().next().value;
			if (oldest === undefined) break;
			cache.delete(oldest);
		}
	}

	return {
		get(key, fetch) {
			const cached = cache.get(key);
			if (cached && cached.expiresAt > Date.now()) {
				onHit?.(key);
				return Promise.resolve(cached.value);
			}
			cache.delete(key);
			const pending = inFlight.get(key);
			if (pending) {
				onCoalesce?.(key);
				return pending;
			}
			onMiss?.(key);
			const promise = fetch().then(
				(value) => {
					// Skip caching when delete() ran while this was in flight.
					if (inFlight.get(key) === promise) {
						inFlight.delete(key);
						store(key, value);
					}
					return value;
				},
				(error: unknown) => {
					if (inFlight.get(key) === promise) inFlight.delete(key);
					throw error;
				},
			);
			inFlight.set(key, promise);
			return promise;
		},
		set: store,
		delete(key) {
			cache.delete(key);
			inFlight.delete(key);
		},
	};
}
