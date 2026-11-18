/**
 * A repository webhook's secret at rest: AES-256-GCM under a key derived from
 * `BETTER_AUTH_SECRET`. The API never returns or logs a secret, so opening a
 * sealed one is only for signing a delivery.
 */
import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
} from "node:crypto";

const IV_BYTES = 12;
const TAG_BYTES = 16;

function key(): Buffer {
	const secret = process.env.BETTER_AUTH_SECRET;
	if (!secret) {
		throw new Error("BETTER_AUTH_SECRET environment variable is required");
	}
	return createHash("sha256")
		.update(`pushstack-webhook-secret:${secret}`)
		.digest();
}

/** The sealed form: base64 of `iv ‖ auth tag ‖ ciphertext`. */
export function sealWebhookSecret(secret: string): string {
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv("aes-256-gcm", key(), iv);
	const ciphertext = Buffer.concat([
		cipher.update(secret, "utf8"),
		cipher.final(),
	]);
	return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
		"base64",
	);
}

export function openWebhookSecret(sealed: string): string {
	const bytes = Buffer.from(sealed, "base64");
	if (bytes.length <= IV_BYTES + TAG_BYTES) {
		throw new Error("Malformed sealed webhook secret");
	}
	const decipher = createDecipheriv(
		"aes-256-gcm",
		key(),
		bytes.subarray(0, IV_BYTES),
	);
	decipher.setAuthTag(bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
	const plaintext = Buffer.concat([
		decipher.update(bytes.subarray(IV_BYTES + TAG_BYTES)),
		decipher.final(),
	]);
	return plaintext.toString("utf8");
}
