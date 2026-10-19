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
