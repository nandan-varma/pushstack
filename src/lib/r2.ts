import { S3Client } from "@aws-sdk/client-s3";

// Extract account ID from endpoint
// Format: https://<ACCOUNT_ID>.r2.cloudflarestorage.com
function getAccountIdFromEndpoint(endpoint: string): string {
	const match = endpoint.match(/https:\/\/([^.]+)\.r2\.cloudflarestorage\.com/);
	return match?.[1] || "";
}

// Create R2 client using S3-compatible API
export function getR2Client() {
	const endpoint = process.env.R2_ENDPOINT;
	const accessKeyId = process.env.R2_ACCESS_KEY_ID;
	const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

	if (!endpoint || !accessKeyId || !secretAccessKey) {
		throw new Error(
			"R2 credentials not configured. Check your environment variables.",
		);
	}

	return new S3Client({
		region: "auto", // Required by AWS SDK, not used by R2
		endpoint,
		credentials: {
			accessKeyId,
			secretAccessKey,
		},
	});
}

export function isR2Configured() {
	return Boolean(
		process.env.R2_BUCKET_NAME &&
			process.env.R2_ENDPOINT &&
			process.env.R2_ACCESS_KEY_ID &&
			process.env.R2_SECRET_ACCESS_KEY,
	);
}

export function getR2Config() {
	return {
		bucketName: process.env.R2_BUCKET_NAME || "",
		endpoint: process.env.R2_ENDPOINT || "",
		accountId: getAccountIdFromEndpoint(process.env.R2_ENDPOINT || ""),
	};
}
