import { AwsClient } from "aws4fetch";
import type {
	ListOptions,
	ListResult,
	ObjectStat,
	ObjectStore,
} from "git-fs-s3";

/**
 * R2 over its S3-compatible API, signed with aws4fetch and sent with plain
 * `fetch` — no AWS SDK, no `node:https` agent, so it runs on any runtime with
 * Web APIs (Node, Vercel Functions, Workers). Node's built-in fetch pools
 * keep-alive connections on its own, which is what the old explicit
 * `https.Agent` existed for: a page load fires hundreds of object reads.
 *
 * Retries and the circuit breaker are not here: git-fs.ts wraps this store in
 * git-fs-s3's `createRetryStore`, the app's one retry policy. Every failed
 * request throws an {@link R2HttpError} carrying the status in the
 * `$metadata.httpStatusCode` shape that retry policy classifies (5xx/429
 * retry); a stalled request aborts with a `TimeoutError`, which it retries too.
 */

/** A non-2xx R2 response (404s never throw — they map to `null`). */
export class R2HttpError extends Error {
	readonly $metadata: { httpStatusCode: number };

	constructor(operation: string, key: string, status: number, detail: string) {
		super(
			`R2 ${operation} ${key} failed: HTTP ${status}${detail ? ` — ${detail}` : ""}`,
		);
		this.name = status === 429 ? "SlowDown" : "R2HttpError";
		this.$metadata = { httpStatusCode: status };
	}
}

export interface R2ObjectStore extends ObjectStore {
	/** Server-side copy within the bucket: no bytes pass through this process. */
	copy(fromKey: string, toKey: string): Promise<void>;
}

// Per attempt. Bodies (pack files) can be tens of MB; metadata calls are tiny.
const BODY_TIMEOUT_MS = 30_000;
const METADATA_TIMEOUT_MS = 10_000;

export function isR2Configured() {
	return Boolean(
		process.env.R2_BUCKET_NAME &&
			process.env.R2_ENDPOINT &&
			process.env.R2_ACCESS_KEY_ID &&
			process.env.R2_SECRET_ACCESS_KEY,
	);
}

function encodeKey(key: string): string {
	return key.split("/").map(encodeURIComponent).join("/");
}

function decodeXml(text: string): string {
	return text
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#(\d+);/g, (_, code: string) =>
			String.fromCodePoint(Number(code)),
		)
		.replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
			String.fromCodePoint(Number.parseInt(code, 16)),
		)
		.replace(/&amp;/g, "&");
}

function xmlValues(xml: string, tag: string): string[] {
	const pattern = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g");
	return [...xml.matchAll(pattern)].map((match) => decodeXml(match[1] ?? ""));
}

/** Parses one ListObjectsV2 response page (exported for tests). */
export function parseListObjectsV2(xml: string): {
	objects: ListResult["objects"];
	prefixes: string[];
	nextToken: string | undefined;
} {
	const objects = xmlValues(xml, "Contents").map((entry) => ({
		key: xmlValues(entry, "Key")[0] ?? "",
		size: Number(xmlValues(entry, "Size")[0] ?? 0),
	}));
	const prefixes = xmlValues(xml, "CommonPrefixes").flatMap((entry) =>
		xmlValues(entry, "Prefix"),
	);
	const truncated = xmlValues(xml, "IsTruncated")[0] === "true";
	const nextToken = truncated
		? xmlValues(xml, "NextContinuationToken")[0]
		: undefined;
	return { objects, prefixes, nextToken };
}

export function createR2ObjectStore(options: {
	endpoint: string;
	bucket: string;
	accessKeyId: string;
	secretAccessKey: string;
	contentType?: (key: string) => string | undefined;
	fetch?: typeof fetch;
}): R2ObjectStore {
	const client = new AwsClient({
		accessKeyId: options.accessKeyId,
		secretAccessKey: options.secretAccessKey,
		service: "s3",
		region: "auto",
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
		throw new R2HttpError(operation, key, response.status, detail);
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
				throw new R2HttpError("COPY", toKey, 500, body.slice(0, 300));
			}
		},
	};
}

/**
 * An R2 store from the R2_* env vars (throws when they're unset). The app's
 * one instance lives in src/server/git-fs.ts — go through that rather than
 * constructing another.
 */
export function createR2ObjectStoreFromEnv(
	contentType?: (key: string) => string | undefined,
): R2ObjectStore {
	const endpoint = process.env.R2_ENDPOINT;
	const accessKeyId = process.env.R2_ACCESS_KEY_ID;
	const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
	const bucket = process.env.R2_BUCKET_NAME;
	if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
		throw new Error(
			"R2 credentials not configured. Check your environment variables.",
		);
	}
	return createR2ObjectStore({
		endpoint,
		bucket,
		accessKeyId,
		secretAccessKey,
		contentType,
	});
}
