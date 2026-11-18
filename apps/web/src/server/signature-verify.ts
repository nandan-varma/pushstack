/**
 * The crypto half of commit and tag signature verification: pull the signed
 * payload and the signature out of a raw Git object, and check a signature
 * with a registered key. No database access and no HTTP shapes here — see
 * `commit-verification.ts` for which key belongs to whom and GitHub's reasons.
 *
 * OpenPGP parsing and verification are `openpgp`'s. SSH signatures are
 * verified with Node's `crypto`: the npm `sshsig` package hardcodes the `file`
 * namespace, so it cannot verify Git's `git` namespace signatures. Server-only:
 * none of this is needed in the browser.
 */
import {
	createHash,
	createPublicKey,
	verify as verifyBytes,
} from "node:crypto";
import * as openpgp from "openpgp";

/** The signature types Git can attach to a commit or tag. */
export type SignatureType = "gpg" | "ssh" | "unknown";

export interface SignedObject {
	/** The object without its signature header, exactly the bytes signed. */
	payload: string;
	/** The ASCII-armored signature. */
	signature: string;
	type: SignatureType;
}

const GPG_SIGNATURE_MARKERS = ["-----BEGIN PGP SIGNATURE-----"];
const SSH_SIGNATURE_MARKERS = ["-----BEGIN SSH SIGNATURE-----"];

function signatureType(signature: string): SignatureType {
	if (GPG_SIGNATURE_MARKERS.some((marker) => signature.includes(marker)))
		return "gpg";
	if (SSH_SIGNATURE_MARKERS.some((marker) => signature.includes(marker)))
		return "ssh";
	return "unknown";
}

/**
 * Split a commit object's `gpgsig` (or `gpgsig-sha256`) header out. The
 * payload is the commit content with that header removed: the bytes Git signed.
 */
export function splitCommitSignature(raw: string): SignedObject | null {
	const boundary = raw.indexOf("\n\n");
	if (boundary === -1) return null;
	const lines = raw.slice(0, boundary).split("\n");
	const message = raw.slice(boundary + 2);
	const headers: string[] = [];
	let signature: string | null = null;
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		if (line.startsWith("gpgsig ") || line.startsWith("gpgsig-sha256 ")) {
			// Continuation lines are indented by one space; the value is the
			// armor without that indentation.
			const parts = [line.slice(line.indexOf(" ") + 1)];
			while (
				index + 1 < lines.length &&
				(lines[index + 1] ?? "").startsWith(" ")
			) {
				index += 1;
				parts.push((lines[index] ?? "").slice(1));
			}
			signature = parts.join("\n");
			continue;
		}
		headers.push(line);
	}
	if (signature === null) return null;
	return {
		payload: `${headers.join("\n")}\n\n${message}`,
		signature,
		type: signatureType(signature),
	};
}

/**
 * Split an annotated tag's appended signature. Git signs the tag object up to
 * the signature, so everything before the armor is the payload.
 */
export function splitTagSignature(raw: string): SignedObject | null {
	for (const marker of [...GPG_SIGNATURE_MARKERS, ...SSH_SIGNATURE_MARKERS]) {
		const at = raw.lastIndexOf(marker);
		if (at === -1) continue;
		const signature = raw.slice(at).trimEnd();
		return {
			payload: raw.slice(0, at),
			signature,
			type: signatureType(signature),
		};
	}
	return null;
}

/** A commit or tag's signature, or null when it is unsigned. */
export function splitSignature(
	kind: "commit" | "tag",
	raw: string,
): SignedObject | null {
	return kind === "commit" ? splitCommitSignature(raw) : splitTagSignature(raw);
}

export interface GpgKeyMaterial {
	armored: string;
}

export interface GpgVerification {
	/** True when the signature verified with this key. */
	valid: boolean;
	/** The signature packet's creation time, GitHub's `verified_at`. */
	signedAt: Date | null;
	expired: boolean;
}

/**
 * The key ids a GPG signature names. Parsing is where a malformed signature
 * fails, so callers treat a throw as `malformed_signature`.
 */
export async function gpgSignatureKeyIds(signature: string): Promise<string[]> {
	const parsed = await openpgp.readSignature({ armoredSignature: signature });
	return parsed.getSigningKeyIDs().map((keyId) => keyId.toHex().toUpperCase());
}

export async function verifyGpgSignature(
	payload: string,
	signature: string,
	key: GpgKeyMaterial,
): Promise<GpgVerification> {
	const parsedSignature = await openpgp.readSignature({
		armoredSignature: signature,
	});
	const verificationKey = await openpgp.readKey({ armoredKey: key.armored });
	const message = await openpgp.createMessage({ text: payload });
	const result = await openpgp.verify({
		message,
		signature: parsedSignature,
		verificationKeys: verificationKey,
	});
	// openpgp resolves each `verified` only for a matching digest; an invalid
	// one rejects. One valid signature is enough.
	let valid = false;
	for (const checked of result.signatures) {
		try {
			valid = (await checked.verified) === true;
		} catch {
			valid = false;
		}
		if (valid) break;
	}
	const signedAt = parsedSignature.packets[0]?.created ?? null;
	const expires = await verificationKey.getExpirationTime();
	const expired = expires instanceof Date && expires.getTime() < Date.now();
	return { valid, signedAt, expired };
}

/** The key type prefixes Git accepts for SSH signing. */
const SSH_KEY_TYPES = [
	"ssh-ed25519",
	"ssh-rsa",
	"ecdsa-sha2-nistp256",
	"ecdsa-sha2-nistp384",
	"ecdsa-sha2-nistp521",
];

/** A big-endian SSH wire reader: uint32 lengths and length-prefixed strings. */
class SshReader {
	private offset = 0;

	constructor(private readonly bytes: Buffer) {}

	uint32(): number {
		if (this.offset + 4 > this.bytes.length) throw new Error("truncated SSH");
		const value = this.bytes.readUInt32BE(this.offset);
		this.offset += 4;
		return value;
	}

	string(): Buffer {
		const length = this.uint32();
		const end = this.offset + length;
		if (end > this.bytes.length) throw new Error("truncated SSH");
		const value = this.bytes.subarray(this.offset, end);
		this.offset = end;
		return value;
	}

	get done(): boolean {
		return this.offset === this.bytes.length;
	}
}

const base64url = (bytes: Buffer) => bytes.toString("base64url");

function stripLeadingZeros(bytes: Buffer): Buffer {
	let start = 0;
	while (start < bytes.length - 1 && bytes[start] === 0) start += 1;
	return bytes.subarray(start);
}

interface SshPublicKey {
	type: string;
	jwk: Record<string, string>;
	/** The hash ECDSA signatures of this curve use. */
	ecdsaHash?: string;
}

function parseSshPublicKey(blob: Buffer): SshPublicKey {
	const reader = new SshReader(blob);
	const type = reader.string().toString();
	if (type === "ssh-ed25519") {
		return {
			type,
			jwk: {
				kty: "OKP",
				crv: "Ed25519",
				x: base64url(reader.string()),
			},
		};
	}
	if (type === "ssh-rsa") {
		const exponent = stripLeadingZeros(reader.string());
		const modulus = stripLeadingZeros(reader.string());
		return {
			type,
			jwk: {
				kty: "RSA",
				n: base64url(modulus),
				e: base64url(exponent),
			},
		};
	}
	if (type.startsWith("ecdsa-sha2-nistp")) {
		reader.string(); // curve name, implied by the type
		const point = reader.string();
		if (point[0] !== 0x04) throw new Error("unsupported ECDSA point");
		const size = (point.length - 1) / 2;
		const crv = { 32: "P-256", 48: "P-384", 66: "P-521" }[size];
		const hash = { 32: "sha256", 48: "sha384", 66: "sha512" }[size];
		if (!crv || !hash) throw new Error("unsupported ECDSA curve");
		return {
			type,
			jwk: {
				kty: "EC",
				crv,
				x: base64url(point.subarray(1, 1 + size)),
				y: base64url(point.subarray(1 + size)),
			},
			ecdsaHash: hash,
		};
	}
	throw new Error("unsupported SSH key type");
}

function decodeArmor(armor: string, label: string): Buffer {
	const lines = armor.trim().split("\n");
	const begin = lines.findIndex((line) =>
		line.startsWith(`-----BEGIN ${label}-----`),
	);
	if (begin === -1) throw new Error(`missing ${label} armor`);
	const body = lines
		.slice(begin + 1)
		.filter((line) => !line.startsWith(`-----END ${label}-----`))
		.join("");
	return Buffer.from(body, "base64");
}

interface SshSignature {
	publicKey: Buffer;
	namespace: string;
	reserved: Buffer;
	hashAlgorithm: string;
	signatureAlgorithm: string;
	signature: Buffer;
}

function parseSshSignature(armor: string): SshSignature {
	const bytes = decodeArmor(armor, "SSH SIGNATURE");
	if (bytes.subarray(0, 6).toString() !== "SSHSIG") {
		throw new Error("not an SSHSIG signature");
	}
	const reader = new SshReader(bytes.subarray(6));
	if (reader.uint32() !== 1) throw new Error("unsupported SSHSIG version");
	const publicKey = reader.string();
	const namespace = reader.string().toString();
	const reserved = reader.string();
	const hashAlgorithm = reader.string().toString();
	const signed = new SshReader(reader.string());
	const signatureAlgorithm = signed.string().toString();
	const signature = signed.string();
	if (!reader.done) throw new Error("trailing SSHSIG bytes");
	return {
		publicKey,
		namespace,
		reserved,
		hashAlgorithm,
		signatureAlgorithm,
		signature,
	};
}

function sshString(value: Buffer | string): Buffer {
	const bytes = typeof value === "string" ? Buffer.from(value) : value;
	const length = Buffer.alloc(4);
	length.writeUInt32BE(bytes.length);
	return Buffer.concat([length, bytes]);
}

/** The bytes an SSHSIG signature covers, per OpenSSH's PROTOCOL.sshsig. */
function sshSignedData(parsed: SshSignature, payload: string): Buffer {
	const hash = parsed.hashAlgorithm.replace("-", "").toLowerCase();
	const digest = createHash(hash).update(payload, "utf8").digest();
	return Buffer.concat([
		Buffer.from("SSHSIG"),
		sshString(parsed.namespace),
		sshString(parsed.reserved),
		sshString(parsed.hashAlgorithm),
		sshString(digest),
	]);
}

/** OpenSSH's SHA256 fingerprint of a public key line, e.g. `SHA256:…`. */
export function sshFingerprint(publicKeyLine: string): string | null {
	const [type, blob] = publicKeyLine.trim().split(/\s+/);
	if (!type || !blob || !SSH_KEY_TYPES.includes(type)) return null;
	const bytes = Buffer.from(blob, "base64");
	if (bytes.length === 0) return null;
	return `SHA256:${createHash("sha256").update(bytes).digest("base64").replace(/=+$/, "")}`;
}

/** A public key line accepted for signing (known algorithm, parseable blob). */
export function isSshSigningKey(publicKeyLine: string): boolean {
	const [type, blob] = publicKeyLine.trim().split(/\s+/);
	if (!type || !blob || sshFingerprint(publicKeyLine) === null) return false;
	try {
		return parseSshPublicKey(Buffer.from(blob, "base64")).type === type;
	} catch {
		return false;
	}
}

/**
 * The fingerprint of the public key embedded in an SSHSIG signature. The
 * signature carries its own key; matching that fingerprint against a
 * registered key is what decides *whose* key signed, before the bytes are
 * checked.
 */
export function sshSignatureFingerprint(signature: string): string | null {
	try {
		const parsed = parseSshSignature(signature);
		return `SHA256:${createHash("sha256").update(parsed.publicKey).digest("base64").replace(/=+$/, "")}`;
	} catch {
		return null;
	}
}

/**
 * Check an SSHSIG signature over `payload`. The namespace must be Git's: a
 * signature made for another purpose (a file, say) is not a commit signature.
 * `sshsig` (the npm package) is not used here because it hardcodes the `file`
 * namespace, so it cannot verify Git's signatures.
 */
export async function verifySshSignature(
	payload: string,
	signature: string,
): Promise<boolean> {
	try {
		const parsed = parseSshSignature(signature);
		if (parsed.namespace !== "git") return false;
		const publicKey = parseSshPublicKey(parsed.publicKey);
		const key = createPublicKey({ key: publicKey.jwk, format: "jwk" });
		const data = sshSignedData(parsed, payload);
		if (publicKey.type === "ssh-ed25519") {
			return verifyBytes(null, data, key, parsed.signature);
		}
		if (publicKey.type === "ssh-rsa") {
			const algorithm =
				parsed.signatureAlgorithm === "rsa-sha2-512" ? "sha512" : "sha256";
			return verifyBytes(algorithm, data, key, parsed.signature);
		}
		if (!publicKey.ecdsaHash) return false;
		return verifyBytes(
			publicKey.ecdsaHash,
			data,
			{ key, dsaEncoding: "ieee-p1363" },
			parsed.signature,
		);
	} catch {
		return false;
	}
}
