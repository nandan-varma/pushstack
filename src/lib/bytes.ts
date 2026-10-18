/**
 * Byte/encoding helpers on Web APIs only (atob/btoa, TextDecoder, WebCrypto)
 * — the portable replacements for Node's `Buffer` and `node:crypto` in
 * server code.
 */

/** Decodes standard base64 (padding optional) to bytes. */
export function base64ToBytes(base64: string): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

/** Decodes base64 whose payload is UTF-8 text (e.g. HTTP Basic credentials). */
export function base64ToUtf8(base64: string): string {
	return new TextDecoder().decode(base64ToBytes(base64));
}

/** Encodes bytes as unpadded base64url. */
export function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

/** `count` cryptographically random bytes. */
export function randomBytes(count: number): Uint8Array {
	return crypto.getRandomValues(new Uint8Array(count));
}

/** Lowercase hex SHA-256 of a UTF-8 string. */
export async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(text),
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}
