import { LRUCache } from "lru-cache";

/**
 * In-process TTL cache with in-flight coalescing, for short-lived Postgres
 * reads (repository rows, access decisions) repeated within one page load.
 * Bounded: past `maxEntries`, the least recently used entry goes first.
 */
export interface TtlCoalescedCache<V> {
	get(key: string, fetch: () => Promise<V>): Promise<V>;
	/** The cached value, or undefined when absent or expired; never fetches. */
	peek(key: string): V | undefined;
	set(key: string, value: V): void;
	/** Forget `key`, including a fetch still in flight (it won't be cached). */
	delete(key: string): void;
	/**
	 * Forget every entry whose key starts with `prefix` — for a mutation that
	 * invalidates a whole key space at once (every user's access decision for one
	 * repository, say) rather than one key.
	 */
	deletePrefix(prefix: string): void;
}

export function createTtlCoalescedCache<V>(options: {
	ttlMs: number;
	maxEntries?: number;
	onHit?: (key: string) => void;
	onMiss?: (key: string) => void;
	onCoalesce?: (key: string) => void;
}): TtlCoalescedCache<V> {
	const { ttlMs, onHit, onMiss, onCoalesce } = options;
	/**
	 * The fetch running for a key, identified so that a delete during it (and the
	 * replacement fetch that may follow) cannot be mistaken for the same one.
	 * LRUCache only reveals an in-flight fetch through `fetch()`, not `keys()`.
	 */
	const inFlight = new Map<string, symbol>();

	// LRUCache refuses to store `undefined`, so a wrapper keeps null/false values.
	const cache = new LRUCache<string, { value: V }, () => Promise<V>>({
		max: options.maxEntries ?? 10_000,
		ttl: ttlMs,
		fetchMethod: async (key, _stale, { context }) => {
			if (!context) throw new Error(`no fetch supplied for ${key}`);
			const mine = Symbol(key);
			inFlight.set(key, mine);
			try {
				return { value: await context() };
			} finally {
				if (inFlight.get(key) === mine) inFlight.delete(key);
			}
		},
	});

	return {
		peek: (key) => cache.peek(key)?.value,
		get(key, compute) {
			const cached = cache.peek(key);
			if (cached) {
				onHit?.(key);
				return Promise.resolve(cached.value);
			}
			if (inFlight.has(key)) {
				onCoalesce?.(key);
			} else {
				onMiss?.(key);
			}
			// Ignore the abort a delete or eviction sends: the caller that started
			// the fetch keeps its answer, while the deleted key stays uncached.
			return cache
				.fetch(key, { context: compute, ignoreFetchAbort: true })
				.then((held) => {
					if (!held) throw new Error(`fetch for ${key} returned nothing`);
					return held.value;
				});
		},
		set(key, value) {
			cache.set(key, { value });
		},
		delete(key) {
			cache.delete(key);
			inFlight.delete(key);
		},
		deletePrefix(prefix) {
			for (const key of new Set([...cache.keys(), ...inFlight.keys()])) {
				if (key.startsWith(prefix)) {
					cache.delete(key);
					inFlight.delete(key);
				}
			}
		},
	};
}
