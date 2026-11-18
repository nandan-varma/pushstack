import { AwsClient } from "aws4fetch";
import { XMLParser } from "fast-xml-parser";
import type {
	ListOptions,
	ListResult,
	ObjectStat,
	ObjectStore,
} from "../types.js";

/**
 * An S3-compatible store (AWS S3, Cloudflare R2, MinIO, …) over the REST API,
 * signed with `aws4fetch` (optional peer dependency) and sent with plain
 * `fetch` — no AWS SDK, so it runs on any runtime with Web APIs (Node, Vercel
 * Functions, Workers). Node's built-in fetch pools keep-alive connections.
 *
 * Retries and the circuit breaker are not here: wrap the store in
 * `createRetryStore`. Every failed request throws an {@link S3HttpError}
 * carrying the status in the `$metadata.httpStatusCode` shape that
 * `isRetryableError` classifies (5xx/429 retry); a stalled request aborts with
 * a `TimeoutError`, which is retried too.
 */

/** A non-2xx response (404s never throw — they map to `null`). */
export class S3HttpError extends Error {
	readonly $metadata: { httpStatusCode: number };

	constructor(operation: string, key: string, status: number, detail: string) {
		super(
			`S3 ${operation} ${key} failed: HTTP ${status}${detail ? ` — ${detail}` : ""}`,
		);
		this.name = status === 429 ? "SlowDown" : "S3HttpError";
		this.$metadata = { httpStatusCode: status };
	}
}

export interface FetchS3ObjectStore extends ObjectStore {
	/** Server-side copy within the bucket: no bytes pass through this process. */
	copy(fromKey: string, toKey: string): Promise<void>;
	/**
	 * Required, not optional as on {@link ObjectStore}: this store always serves
	 * ranges (S3's `Range` header). Declaring it required is what makes a wrapper
	 * that forgets to forward it a compile error — dropping it does not fail
	 * loudly, it makes `getObjectSize` answer "unknown", so every size gate would
	 * quietly read the whole object instead of refusing it.
	 */
	getRange(key: string, start: number, end: number): Promise<Uint8Array | null>;
}

function encodeKey(key: string): string {
	return key.split("/").map(encodeURIComponent).join("/");
}

/** Keys and continuation tokens are opaque: keep tag text as strings, untrimmed. */
const parser = new XMLParser({
	ignoreAttributes: true,
	parseTagValue: false,
	parseAttributeValue: false,
	htmlEntities: true,
	trimValues: false,
	isArray: (name) => name === "Contents" || name === "CommonPrefixes",
});

interface ListBucketResult {
	Prefix?: string;
	Contents?: { Key?: string; Size?: string }[];
	CommonPrefixes?: { Prefix?: string }[];
	IsTruncated?: string;
	NextContinuationToken?: string;
}

export function parseListObjectsV2(xml: string): {
	objects: ListResult["objects"];
	prefixes: string[];
	nextToken: string | undefined;
} {
	const { ListBucketResult: page = {} } = parser.parse(xml) as {
		ListBucketResult?: ListBucketResult;
	};
	const objects = (page.Contents ?? []).map((entry) => ({
		key: entry.Key ?? "",
		size: Number(entry.Size ?? 0),
	}));
	const prefixes = (page.CommonPrefixes ?? []).flatMap((entry) =>
		entry.Prefix === undefined ? [] : [entry.Prefix],
	);
	const truncated = page.IsTruncated === "true";
	const nextToken = truncated ? page.NextContinuationToken : undefined;
	return { objects, prefixes, nextToken };
}

export function createFetchS3Store(options: {
	/** Service endpoint, e.g. `https://<account>.r2.cloudflarestorage.com`. */
	endpoint: string;
	bucket: string;
	accessKeyId: string;
	secretAccessKey: string;
	/** Signing region. Default `"auto"` (R2); use e.g. `"us-east-1"` for AWS. */
	region?: string;
	/** Per-attempt timeout for body transfers (get/put/copy). Default 30 000 ms. */
	bodyTimeoutMs?: number;
	/** Per-attempt timeout for metadata calls (head/list/range). Default 10 000 ms. */
	metadataTimeoutMs?: number;
	/** Derive a Content-Type for uploads from the key. */
	contentType?: (key: string) => string | undefined;
	/** Custom `fetch` (tests, proxies). Default: the global one. */
	fetch?: typeof fetch;
}): FetchS3ObjectStore {
	const BODY_TIMEOUT_MS = options.bodyTimeoutMs ?? 30_000;
	const METADATA_TIMEOUT_MS = options.metadataTimeoutMs ?? 10_000;
	const client = new AwsClient({
		accessKeyId: options.accessKeyId,
		secretAccessKey: options.secretAccessKey,
		service: "s3",
		region: options.region ?? "auto",
		// createRetryStore owns retries; aws4fetch's own would stack under it.
		retries: 0,
	});
	const doFetch = options.fetch ?? fetch;
	const bucketUrl = `${options.endpoint.replace(/\/+$/, "")}/${encodeURIComponent(options.bucket)}`;

	async function send(
		url: string,
		init: RequestInit,
		timeoutMs: number,
	): Promise<Response> {
		const request = await client.sign(url, init);
		return doFetch(request, { signal: AbortSignal.timeout(timeoutMs) });
	}

	async function fail(
		operation: string,
		key: string,
		response: Response,
	): Promise<never> {
		const detail = (await response.text().catch(() => "")).slice(0, 300);
		throw new S3HttpError(operation, key, response.status, detail);
	}

	const objectUrl = (key: string) => `${bucketUrl}/${encodeKey(key)}`;

	return {
		async get(key) {
			const response = await send(
				objectUrl(key),
				{ method: "GET" },
				BODY_TIMEOUT_MS,
			);
			if (response.status === 404) {
				await response.body?.cancel();
				return null;
			}
			if (!response.ok) return fail("GET", key, response);
			return new Uint8Array(await response.arrayBuffer());
		},

		async getRange(key, start, end) {
			const response = await send(
				objectUrl(key),
				{ method: "GET", headers: { Range: `bytes=${start}-${end}` } },
				METADATA_TIMEOUT_MS,
			);
			if (response.status === 404) {
				await response.body?.cancel();
				return null;
			}
			if (!response.ok) return fail("GET range", key, response);
			return new Uint8Array(await response.arrayBuffer());
		},

		async put(key, data) {
			const headers: Record<string, string> = {};
			const type = options.contentType?.(key);
			if (type) headers["Content-Type"] = type;
			const response = await send(
				objectUrl(key),
				{ method: "PUT", headers, body: data as Uint8Array<ArrayBuffer> },
				BODY_TIMEOUT_MS,
			);
			if (!response.ok) return fail("PUT", key, response);
			await response.body?.cancel();
		},

		async delete(key) {
			const response = await send(
				objectUrl(key),
				{ method: "DELETE" },
				METADATA_TIMEOUT_MS,
			);
			// S3 answers 204 for a missing key; tolerate 404 from compatibles.
			if (!response.ok && response.status !== 404) {
				return fail("DELETE", key, response);
			}
			await response.body?.cancel();
		},

		async head(key): Promise<ObjectStat | null> {
			const response = await send(
				objectUrl(key),
				{ method: "HEAD" },
				METADATA_TIMEOUT_MS,
			);
			if (response.status === 404) return null;
			if (!response.ok) return fail("HEAD", key, response);
			return { size: Number(response.headers.get("content-length") ?? 0) };
		},

		async list(prefix, listOptions?: ListOptions): Promise<ListResult> {
			const limit = listOptions?.limit;
			const objects: ListResult["objects"] = [];
			const prefixes = new Set<string>();
			let token: string | undefined;

			do {
				const params = new URLSearchParams({ "list-type": "2", prefix });
				if (listOptions?.delimiter)
					params.set("delimiter", listOptions.delimiter);
				if (limit !== undefined)
					params.set("max-keys", String(Math.min(limit, 1000)));
				if (token) params.set("continuation-token", token);
				const response = await send(
					`${bucketUrl}?${params}`,
					{ method: "GET" },
					METADATA_TIMEOUT_MS,
				);
				if (!response.ok) return fail("LIST", prefix, response);
				const page = parseListObjectsV2(await response.text());
				objects.push(...page.objects);
				for (const p of page.prefixes) prefixes.add(p);
				if (limit !== undefined && objects.length + prefixes.size >= limit)
					break;
				token = page.nextToken;
			} while (token);

			return { objects, prefixes: [...prefixes] };
		},

		async copy(fromKey, toKey) {
			const response = await send(
				objectUrl(toKey),
				{
					method: "PUT",
					headers: {
						"x-amz-copy-source": `/${encodeURIComponent(options.bucket)}/${encodeKey(fromKey)}`,
					},
				},
				BODY_TIMEOUT_MS,
			);
			if (!response.ok) return fail("COPY", toKey, response);
			// A copy can answer 200 with an <Error> body (S3 semantics).
			const body = await response.text();
			if (body.includes("<Error>")) {
				throw new S3HttpError("COPY", toKey, 500, body.slice(0, 300));
			}
		},
	};
}
