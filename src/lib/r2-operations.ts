import {
	DeleteObjectCommand,
	DeleteObjectsCommand,
	GetObjectCommand,
	HeadObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
	isRetryableError,
	R2DownloadError,
	R2UploadError,
} from "#/server/git-errors";
import { getR2Client, getR2Config } from "./r2";

export interface R2File {
	key: string;
	size: number;
	lastModified: Date;
	etag: string;
}

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 100; // ms
const MAX_RETRY_DELAY = 5000; // ms

// ponytail: circuit breaker state as plain module vars, no class needed
const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_TIMEOUT = 30000;
let cbFailures = 0;
let cbLastFailureTime = 0;
let cbState: "closed" | "open" | "half-open" = "closed";

async function circuitBreakerExecute<T>(fn: () => Promise<T>): Promise<T> {
	if (cbState === "open") {
		if (Date.now() - cbLastFailureTime < CIRCUIT_BREAKER_TIMEOUT) {
			throw new R2UploadError("Circuit breaker is open, R2 unavailable", false);
		}
		cbState = "half-open";
	}
	try {
		const result = await fn();
		if (cbState === "half-open") {
			cbState = "closed";
			cbFailures = 0;
		}
		return result;
	} catch (error) {
		cbFailures++;
		cbLastFailureTime = Date.now();
		if (cbFailures >= CIRCUIT_BREAKER_THRESHOLD) cbState = "open";
		throw error;
	}
}

/**
 * Retry with exponential backoff and jitter
 */
async function withRetry<T>(
	fn: () => Promise<T>,
	operation: string,
	maxRetries = MAX_RETRIES,
): Promise<T> {
	let lastError: any;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await circuitBreakerExecute(fn);
		} catch (error) {
			lastError = error;

			// Don't retry if error is not retryable
			if (!isRetryableError(error)) {
				throw error;
			}

			// Don't retry on last attempt
			if (attempt === maxRetries) {
				break;
			}

			// Calculate delay with exponential backoff and jitter
			const baseDelay = Math.min(
				INITIAL_RETRY_DELAY * 2 ** attempt,
				MAX_RETRY_DELAY,
			);
			const jitter = Math.random() * baseDelay * 0.3;
			const delay = baseDelay + jitter;

			console.log(
				`${operation} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${Math.round(delay)}ms...`,
			);

			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}

	throw lastError;
}

/**
 * Upload a file to R2 with retry logic
 */
export async function uploadToR2(
	key: string,
	body: Buffer | string,
	contentType?: string,
) {
	return withRetry(async () => {
		const client = getR2Client();
		const { bucketName } = getR2Config();

		try {
			await client.send(
				new PutObjectCommand({
					Bucket: bucketName,
					Key: key,
					Body: body,
					ContentType: contentType,
				}),
			);

			return { key, bucketName };
		} catch (error) {
			throw new R2UploadError(
				`Failed to upload ${key}: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}
	}, `Upload ${key}`);
}

/**
 * Download a file from R2 with retry logic
 */
export async function downloadFromR2(key: string) {
	return withRetry(async () => {
		const client = getR2Client();
		const { bucketName } = getR2Config();

		try {
			const response = await client.send(
				new GetObjectCommand({
					Bucket: bucketName,
					Key: key,
				}),
			);

			if (!response.Body) {
				throw new Error("No body returned from R2");
			}

			const content = await response.Body.transformToByteArray();
			return {
				content: Buffer.from(content),
				contentType: response.ContentType,
				size: response.ContentLength,
				etag: response.ETag,
			};
		} catch (error: any) {
			if (
				error.$metadata?.httpStatusCode === 404 ||
				error.name === "NoSuchKey"
			) {
				// Don't wrap 404 errors, just rethrow
				throw error;
			}
			throw new R2DownloadError(
				`Failed to download ${key}: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}
	}, `Download ${key}`);
}

/**
 * Get a file from R2 (alias for downloadFromR2)
 */
export async function getFileFromR2(key: string) {
	const result = await downloadFromR2(key);
	return result.content;
}

/**
 * List files in R2 bucket
 */
export async function listR2Files(
	prefix?: string,
	maxKeys = 100,
): Promise<R2File[]> {
	const client = getR2Client();
	const { bucketName } = getR2Config();
	const files: R2File[] = [];
	let continuationToken: string | undefined;

	while (files.length < maxKeys) {
		const response = await client.send(
			new ListObjectsV2Command({
				Bucket: bucketName,
				Prefix: prefix,
				MaxKeys: Math.min(maxKeys - files.length, 1000),
				ContinuationToken: continuationToken,
			}),
		);

		files.push(
			...(response.Contents?.map((obj) => ({
				key: obj.Key || "",
				size: obj.Size || 0,
				lastModified: obj.LastModified || new Date(),
				etag: obj.ETag || "",
			})) || []),
		);

		if (!response.IsTruncated || !response.NextContinuationToken) {
			break;
		}

		continuationToken = response.NextContinuationToken;
	}

	return files;
}

export async function listAllR2Files(prefix?: string): Promise<R2File[]> {
	const client = getR2Client();
	const { bucketName } = getR2Config();
	const files: R2File[] = [];
	let continuationToken: string | undefined;

	do {
		const response = await client.send(
			new ListObjectsV2Command({
				Bucket: bucketName,
				Prefix: prefix,
				MaxKeys: 1000,
				ContinuationToken: continuationToken,
			}),
		);

		files.push(
			...(response.Contents?.map((obj) => ({
				key: obj.Key || "",
				size: obj.Size || 0,
				lastModified: obj.LastModified || new Date(),
				etag: obj.ETag || "",
			})) || []),
		);

		continuationToken = response.NextContinuationToken;
	} while (continuationToken);

	return files;
}

/**
 * Delete a file from R2
 */
export async function deleteFromR2(key: string) {
	const client = getR2Client();
	const { bucketName } = getR2Config();

	await client.send(
		new DeleteObjectCommand({
			Bucket: bucketName,
			Key: key,
		}),
	);

	return { deleted: true, key };
}

/**
 * Check if a file exists in R2
 */
export async function fileExistsInR2(key: string): Promise<boolean> {
	const client = getR2Client();
	const { bucketName } = getR2Config();

	try {
		await client.send(
			new HeadObjectCommand({
				Bucket: bucketName,
				Key: key,
			}),
		);
		return true;
	} catch (error) {
		return false;
	}
}

/**
 * Generate a presigned URL for downloading a file
 * @param key - The file key in R2
 * @param expiresIn - URL validity in seconds (default: 1 hour)
 */
export async function getPresignedDownloadUrl(key: string, expiresIn = 3600) {
	const client = getR2Client();
	const { bucketName } = getR2Config();

	return await getSignedUrl(
		client,
		new GetObjectCommand({
			Bucket: bucketName,
			Key: key,
		}),
		{ expiresIn },
	);
}

/**
 * Generate a presigned URL for uploading a file
 * @param key - The file key in R2
 * @param contentType - Required content type for the upload
 * @param expiresIn - URL validity in seconds (default: 1 hour)
 */
export async function getPresignedUploadUrl(
	key: string,
	contentType: string,
	expiresIn = 3600,
) {
	const client = getR2Client();
	const { bucketName } = getR2Config();

	return await getSignedUrl(
		client,
		new PutObjectCommand({
			Bucket: bucketName,
			Key: key,
			ContentType: contentType,
		}),
		{ expiresIn },
	);
}

/**
 * Get public URL for a file (if bucket has public access)
 * Note: R2 buckets are private by default. Use presigned URLs instead.
 */
export function getPublicUrl(key: string): string {
	const { endpoint, bucketName } = getR2Config();
	return `${endpoint}/${bucketName}/${key}`;
}

/**
 * Bulk upload multiple files to R2
 */
export async function bulkUploadToR2(
	uploads: Array<{ key: string; data: Buffer | string; contentType?: string }>,
): Promise<Array<{ key: string; success: boolean; error?: string }>> {
	const results = await Promise.allSettled(
		uploads.map(({ key, data, contentType }) =>
			uploadToR2(key, data, contentType).then(() => ({ key, success: true })),
		),
	);

	return results.map((result, index) => {
		if (result.status === "fulfilled") {
			return result.value;
		}
		return {
			key: uploads[index].key,
			success: false,
			error:
				result.reason instanceof Error
					? result.reason.message
					: "Unknown error",
		};
	});
}

/**
 * Bulk delete multiple files from R2
 */
export async function bulkDeleteFromR2(
	keys: string[],
): Promise<{ deleted: number; errors: number }> {
	const client = getR2Client();
	const { bucketName } = getR2Config();

	// R2 supports batch delete of up to 1000 objects
	const chunks: string[][] = [];
	for (let i = 0; i < keys.length; i += 1000) {
		chunks.push(keys.slice(i, i + 1000));
	}

	let deleted = 0;
	let errors = 0;

	for (const chunk of chunks) {
		try {
			await withRetry(async () => {
				const response = await client.send(
					new DeleteObjectsCommand({
						Bucket: bucketName,
						Delete: {
							Objects: chunk.map((key) => ({ Key: key })),
						},
					}),
				);

				deleted += response.Deleted?.length || 0;
				errors += response.Errors?.length || 0;
			}, `Bulk delete ${chunk.length} objects`);
		} catch (error) {
			errors += chunk.length;
			console.error("Bulk delete failed:", error);
		}
	}

	return { deleted, errors };
}

export function getCircuitBreakerState() {
	return { state: cbState, failures: cbFailures, lastFailureTime: cbLastFailureTime };
}
