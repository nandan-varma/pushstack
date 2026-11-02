import type {
	ListOptions,
	ListResult,
	ObjectStat,
	ObjectStore,
} from "../types.js";

/**
 * The slice of Cloudflare's `R2Bucket` binding this store uses. Declared
 * structurally so the package needs no `@cloudflare/workers-types`: the real
 * binding satisfies it, and so can a test double.
 */
export interface R2BucketLike {
	get(
		key: string,
		options?: { range?: { offset: number; length: number } },
	): Promise<{
		body: ReadableStream<Uint8Array>;
		arrayBuffer(): Promise<ArrayBuffer>;
	} | null>;
	put(
		key: string,
		value: Uint8Array | ReadableStream<Uint8Array>,
		options?: { httpMetadata?: { contentType?: string } },
	): Promise<unknown>;
	delete(key: string): Promise<void>;
	head(key: string): Promise<{ size: number } | null>;
	list(options: {
		prefix?: string;
		delimiter?: string;
		limit?: number;
		cursor?: string;
	}): Promise<{
		objects: { key: string; size: number }[];
		delimitedPrefixes: string[];
		truncated: boolean;
		cursor?: string;
	}>;
}

/** R2 returns at most this many entries per `list` call. */
const LIST_PAGE_SIZE = 1000;

export interface R2ObjectStore extends ObjectStore {
	/**
	 * Copy within the bucket. R2 bindings have no server-side copy, so the body
	 * is streamed from the source straight into the destination: it is never
	 * held in memory, which matters on a 128 MB isolate.
	 */
	copy(fromKey: string, toKey: string): Promise<void>;
	/** Always served: R2 reads accept a byte range natively. */
	getRange(key: string, start: number, end: number): Promise<Uint8Array | null>;
}

/**
 * An {@link ObjectStore} over a Cloudflare R2 *binding*: no credentials, no
 * request signing, no HTTP round trip through the S3 API. A Worker's reads and
 * writes stay on Cloudflare's network. Use `createFetchS3Store` (`git-fs-s3/fetch-s3`) instead
 * when the code runs outside Cloudflare.
 *
 * Errors surface as the binding throws them; R2 retries transient failures
 * itself, so this store is not wrapped in `createRetryStore`.
 */
export function createR2Store(
	bucket: R2BucketLike,
	options?: { contentType?: (key: string) => string | undefined },
): R2ObjectStore {
	const metadata = (key: string) => {
		const contentType = options?.contentType?.(key);
		return contentType ? { httpMetadata: { contentType } } : undefined;
	};
	return {
		async get(key) {
			const object = await bucket.get(key);
			return object ? new Uint8Array(await object.arrayBuffer()) : null;
		},

		async getRange(key, start, end) {
			const object = await bucket.get(key, {
				range: { offset: start, length: end - start + 1 },
			});
			return object ? new Uint8Array(await object.arrayBuffer()) : null;
		},

		async put(key, data) {
			await bucket.put(key, data, metadata(key));
		},

		// R2's delete resolves for a missing key, as ObjectStore requires.
		delete: (key) => bucket.delete(key),

		async head(key): Promise<ObjectStat | null> {
			const object = await bucket.head(key);
			return object ? { size: object.size } : null;
		},

		async list(prefix, options?: ListOptions): Promise<ListResult> {
			const limit = options?.limit ?? Number.POSITIVE_INFINITY;
			const objects: ListResult["objects"] = [];
			const prefixes: string[] = [];
			let cursor: string | undefined;
			do {
				const remaining = limit - (objects.length + prefixes.length);
				const page = await bucket.list({
					prefix,
					delimiter: options?.delimiter,
					limit: Math.min(LIST_PAGE_SIZE, remaining),
					cursor,
				});
				for (const { key, size } of page.objects) objects.push({ key, size });
				prefixes.push(...page.delimitedPrefixes);
				cursor = page.truncated ? page.cursor : undefined;
			} while (cursor && objects.length + prefixes.length < limit);
			return { objects, prefixes };
		},

		async copy(fromKey, toKey) {
			const source = await bucket.get(fromKey);
			if (!source) throw new Error(`R2 copy: ${fromKey} does not exist`);
			await bucket.put(toKey, source.body, metadata(toKey));
		},
	};
}
