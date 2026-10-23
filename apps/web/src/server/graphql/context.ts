/**
 * Per-request GraphQL context: the authenticated caller (GraphQL always
 * requires one, as on GitHub) and request-scoped batch loaders, so a list of
 * N repositories asking for a per-repository value costs one query, not N.
 */
import type { Caller } from "../api/auth";

/** GitHub's `RateLimit` object for this request (`Query.rateLimit`). */
export interface RateLimitInfo {
	cost: number;
	nodeCount: number;
	limit: number;
	used: number;
	remaining: number;
	resetAt: string;
}

export interface GraphQLContext {
	request: Request;
	caller: Caller;
	/** Null when the limiter failed open (rate-limit.ts). */
	rateLimit: RateLimitInfo | null;
	/**
	 * The request's loader named `name`: `load(key)` calls are collected until
	 * the next macrotask and answered by a single `batch(keys)` call. Keys are
	 * compared by value (strings and numbers).
	 */
	loader<K extends string | number, V>(
		name: string,
		batch: (keys: K[]) => Promise<Map<K, V>>,
	): Loader<K, V>;
	/** Request-scoped memo: `fn` runs once per key per request. */
	memo<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

export interface Loader<K, V> {
	load(key: K): Promise<V | undefined>;
}

function createLoader<K, V>(
	batch: (keys: K[]) => Promise<Map<K, V>>,
): Loader<K, V> {
	const results = new Map<K, Promise<V | undefined>>();
	let pending: {
		key: K;
		resolve: (value: V | undefined) => void;
		reject: (error: unknown) => void;
	}[] = [];
	const flush = async () => {
		const queue = pending;
		pending = [];
		try {
			const values = await batch([...new Set(queue.map((item) => item.key))]);
			for (const item of queue) item.resolve(values.get(item.key));
		} catch (error) {
			for (const item of queue) item.reject(error);
		}
	};
	return {
		load(key) {
			const known = results.get(key);
			if (known) return known;
			const promise = new Promise<V | undefined>((resolve, reject) => {
				if (pending.length === 0) setImmediate(() => void flush());
				pending.push({ key, resolve, reject });
			});
			results.set(key, promise);
			return promise;
		},
	};
}

export function createContext(
	request: Request,
	caller: Caller,
	rateLimit: RateLimitInfo | null,
): GraphQLContext {
	const loaders = new Map<string, Loader<never, unknown>>();
	const memos = new Map<string, Promise<unknown>>();
	return {
		request,
		caller,
		rateLimit,
		loader<K extends string | number, V>(
			name: string,
			batch: (keys: K[]) => Promise<Map<K, V>>,
		) {
			let loader = loaders.get(name) as Loader<K, V> | undefined;
			if (!loader) {
				loader = createLoader(batch);
				loaders.set(name, loader as Loader<never, unknown>);
			}
			return loader;
		},
		memo<T>(key: string, fn: () => Promise<T>) {
			let value = memos.get(key) as Promise<T> | undefined;
			if (!value) {
				value = fn();
				memos.set(key, value);
			}
			return value;
		},
	};
}
