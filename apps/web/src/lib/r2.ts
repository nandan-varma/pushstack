import { AwsClient } from "aws4fetch";
import {
	createFetchS3Store,
	type FetchS3ObjectStore,
} from "git-fs-s3/fetch-s3";

/**
 * The app's Cloudflare R2 wiring: the env-var contract around git-fs-s3's
 * fetch-based S3 store (`git-fs-s3/fetch-s3`). The store itself, its errors
 * and its retry classification live in the library.
 */

export function isR2Configured() {
	return Boolean(
		process.env.R2_BUCKET_NAME &&
			process.env.R2_ENDPOINT &&
			process.env.R2_ACCESS_KEY_ID &&
			process.env.R2_SECRET_ACCESS_KEY,
	);
}

/**
 * An R2 store from the R2_* env vars (throws when they're unset). The app's
 * one instance lives in src/server/git-fs.ts — go through that rather than
 * constructing another.
 */
export function createR2ObjectStoreFromEnv(
	contentType?: (key: string) => string | undefined,
): FetchS3ObjectStore {
	const endpoint = process.env.R2_ENDPOINT;
	const accessKeyId = process.env.R2_ACCESS_KEY_ID;
	const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
	const bucket = process.env.R2_BUCKET_NAME;
	if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
		throw new Error(
			"R2 credentials not configured. Check your environment variables.",
		);
	}
	return createFetchS3Store({
		endpoint,
		bucket,
		accessKeyId,
		secretAccessKey,
		contentType,
	});
}

/**
 * A presigned `PUT` URL for `key` (SigV4 in the query string), valid for
 * `ttlSeconds`: the client uploads the bytes straight to R2, so they never
 * pass through a function (Vercel caps request bodies at 4.5 MB). The URL does
 * not bind a size or content type: the caller verifies the object afterwards.
 */
export async function presignR2Put(
	key: string,
	ttlSeconds: number,
): Promise<string> {
	const endpoint = process.env.R2_ENDPOINT;
	const bucket = process.env.R2_BUCKET_NAME;
	const accessKeyId = process.env.R2_ACCESS_KEY_ID;
	const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
	if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
		throw new Error("R2 credentials not configured");
	}
	const client = new AwsClient({
		accessKeyId,
		secretAccessKey,
		service: "s3",
		region: "auto",
	});
	const url = new URL(
		`${endpoint.replace(/\/+$/, "")}/${encodeURIComponent(bucket)}/${key
			.split("/")
			.map(encodeURIComponent)
			.join("/")}`,
	);
	url.searchParams.set("X-Amz-Expires", String(ttlSeconds));
	const signed = await client.sign(url.toString(), {
		method: "PUT",
		aws: { signQuery: true },
	});
	return signed.url;
}
