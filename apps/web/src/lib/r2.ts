import { AwsClient } from "aws4fetch";
import { env } from "#/server/env";

/**
 * Presigned URLs. The repository store is the `GIT_BUCKET` binding
 * (src/server/git-fs.ts), but a binding cannot hand a browser a URL: a client
 * uploads a large file straight to R2 with a URL signed against R2's S3 API,
 * which needs the bucket's S3 credentials. Those are the only R2 credentials
 * the Worker holds.
 */

/**
 * A presigned `PUT` URL for `key` (SigV4 in the query string), valid for
 * `ttlSeconds`: the client uploads the bytes straight to R2, so they never
 * pass through the Worker. The URL does not bind a size or content type: the
 * caller verifies the object afterwards. Null when the S3 credentials are not
 * configured (local development, where the bucket is simulated).
 */
export async function presignR2Put(
	key: string,
	ttlSeconds: number,
): Promise<string | null> {
	const {
		R2_ENDPOINT,
		R2_BUCKET_NAME,
		R2_ACCESS_KEY_ID,
		R2_SECRET_ACCESS_KEY,
	} = env;
	if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) return null;
	const client = new AwsClient({
		accessKeyId: R2_ACCESS_KEY_ID,
		secretAccessKey: R2_SECRET_ACCESS_KEY,
		service: "s3",
		region: "auto",
	});
	const url = new URL(
		`${R2_ENDPOINT.replace(/\/+$/, "")}/${encodeURIComponent(R2_BUCKET_NAME)}/${key
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
