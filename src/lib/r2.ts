import https from "node:https";
import { S3Client } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";

// ponytail: without an explicit keep-alive agent, the SDK's default request
// handler doesn't reuse TCP/TLS connections across calls — every R2 GET/HEAD
// pays a fresh handshake. A single tree-page load fires 100s of these
// sequentially-dependent object reads (commit chain walk, tree lookups), so
// handshake overhead was a large, avoidable chunk of the measured latency.
const keepAliveAgent = new https.Agent({ keepAlive: true, maxSockets: 100 });

// Extract account ID from endpoint
// Format: https://<ACCOUNT_ID>.r2.cloudflarestorage.com
function getAccountIdFromEndpoint(endpoint: string): string {
	const match = endpoint.match(/https:\/\/([^.]+)\.r2\.cloudflarestorage\.com/);
	return match?.[1] || "";
}

let _client: S3Client | null = null;

// Create R2 client using S3-compatible API
export function getR2Client() {
	if (_client) return _client;

	const endpoint = process.env.R2_ENDPOINT;
	const accessKeyId = process.env.R2_ACCESS_KEY_ID;
	const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

	if (!endpoint || !accessKeyId || !secretAccessKey) {
		throw new Error(
			"R2 credentials not configured. Check your environment variables.",
		);
	}

	_client = new S3Client({
		region: "auto", // Required by AWS SDK, not used by R2
		endpoint,
		credentials: {
			accessKeyId,
			secretAccessKey,
		},
		requestHandler: new NodeHttpHandler({ httpsAgent: keepAliveAgent }),
	});
	return _client;
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
