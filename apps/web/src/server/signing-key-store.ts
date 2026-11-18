/**
 * Signing keys users register for commit and tag verification: OpenPGP keys
 * (`/user/gpg_keys`) and SSH signing keys (`/user/ssh_signing_keys`). Only
 * public keys are persisted; a private key is rejected at the door.
 */
import { and, count, eq, inArray } from "drizzle-orm";
import type * as OpenPgp from "openpgp";
import { db } from "#/db";
import { gpgKeys, sshSigningKeys } from "#/db/app-schema";
import {
	MAX_GPG_KEY_CHARS,
	MAX_SIGNING_KEY_TITLE_CHARS,
	MAX_SIGNING_KEYS_PER_USER,
	MAX_SSH_SIGNING_KEY_CHARS,
} from "#/lib/limits";
import { ApiError } from "./api/http";
import { openpgp } from "./openpgp";
import { isSshSigningKey, sshFingerprint } from "./signature-verify";

type GpgKeyRow = typeof gpgKeys.$inferSelect;
type SshSigningKeyRow = typeof sshSigningKeys.$inferSelect;

interface GpgEmail {
	email: string;
	verified: boolean;
}

interface GpgSubkeyShape {
	id: number;
	primary_key_id: number;
	key_id: string;
	public_key: string;
	emails: GpgEmail[];
	subkeys: GpgSubkeyShape[];
	can_sign: boolean;
	can_encrypt: boolean;
	can_certify: boolean;
	can_authenticate: boolean;
	created_at: string;
	expires_at: string | null;
}

/** GitHub's GPG key object; `public_key` is the base64 binary key packet. */
export interface GpgKeyShape extends GpgSubkeyShape {
	raw_key: string | null;
	revoked: boolean;
}

export interface SshSigningKeyShape {
	id: number;
	key: string;
	title: string;
	created_at: string;
}

const iso = (date: Date) => date.toISOString();

/**
 * Parse an armored public key and the fields verification and the API need
 * from it. Throws ApiError(422) for a private key or anything unparseable.
 */
async function parseGpgKey(armored: string) {
	const pgp = await openpgp();
	let key: OpenPgp.PublicKey;
	try {
		key = await pgp.readKey({ armoredKey: armored.trim() });
	} catch {
		throw new ApiError(422, "Invalid GPG key");
	}
	if (key.isPrivate()) throw new ApiError(422, "Private keys are not accepted");
	const subkeys = key.getSubkeys();
	const signing = await hasCapability(() => key.getSigningKey());
	const encrypting = await hasCapability(() => key.getEncryptionKey());
	const keyIds = [key.getKeyID(), ...subkeys.map((subkey) => subkey.getKeyID())]
		.map((keyId) => keyId.toHex().toUpperCase())
		.filter((keyId) => keyId.length > 0);
	const expires = await key.getExpirationTime();
	return {
		primaryKeyId: key.getKeyID().toHex().toUpperCase(),
		keyIds,
		emails: key.getUserIDs().flatMap((userID) => {
			const match = userID.match(/<([^<>]+)>/);
			return match?.[1] ? [match[1].toLowerCase()] : [];
		}),
		canSign: signing,
		canEncrypt: encrypting,
		createdAt: key.getCreationTime(),
		expiresAt:
			expires instanceof Date && Number.isFinite(expires.getTime())
				? expires
				: null,
		subkeys,
	};
}

async function hasCapability(check: () => Promise<unknown>): Promise<boolean> {
	try {
		await check();
		return true;
	} catch {
		return false;
	}
}

/** The binary packet base64 GitHub serves as `public_key`. */
async function armoredToBinary(armored: string): Promise<string> {
	const pgp = await openpgp();
	const key = await pgp.readKey({ armoredKey: armored });
	return Buffer.from(key.write()).toString("base64");
}

async function gpgKeyShape(
	row: GpgKeyRow,
	verifiedEmail: string | null,
): Promise<GpgKeyShape> {
	const parsed = await parseGpgKey(row.publicKey).catch(() => null);
	const emails = (parsed?.emails ?? row.emails).map((email) => ({
		email,
		verified: verifiedEmail !== null && email === verifiedEmail.toLowerCase(),
	}));
	const publicKey = await armoredToBinary(row.publicKey).catch(
		() => row.publicKey,
	);
	const createdAt = parsed?.createdAt ?? row.createdAt;
	const common = {
		key_id: row.primaryKeyId,
		public_key: publicKey,
		emails,
		can_sign: row.canSign,
		can_encrypt: parsed?.canEncrypt ?? false,
		can_certify: row.canSign,
		can_authenticate: false,
		created_at: iso(createdAt),
		expires_at: row.expiresAt ? iso(row.expiresAt) : null,
	};
	const subkeys: GpgSubkeyShape[] = (parsed?.subkeys ?? []).map(
		(subkey, index) => ({
			id: row.id * 1000 + index + 1,
			primary_key_id: row.id,
			key_id: subkey.getKeyID().toHex().toUpperCase(),
			public_key: Buffer.from(subkey.keyPacket.write()).toString("base64"),
			emails: [],
			subkeys: [],
			can_sign: false,
			can_encrypt: false,
			can_certify: false,
			can_authenticate: false,
			created_at: iso(subkey.getCreationTime()),
			expires_at: null,
		}),
	);
	return {
		id: row.id,
		primary_key_id: row.id,
		...common,
		subkeys,
		raw_key: row.publicKey,
		revoked: false,
	};
}

function sshKeyShape(row: SshSigningKeyRow): SshSigningKeyShape {
	return {
		id: row.id,
		key: row.key,
		title: row.title,
		created_at: iso(row.createdAt),
	};
}

async function keyCount(
	userId: string,
	table: typeof gpgKeys | typeof sshSigningKeys,
) {
	const [row] = await db
		.select({ total: count() })
		.from(table)
		.where(eq(table.userId, userId));
	return row?.total ?? 0;
}

/** The caller's GPG keys, oldest first (GitHub's order). */
export async function listGpgKeys(
	userId: string,
	verifiedEmail: string | null,
): Promise<GpgKeyShape[]> {
	const rows = await db
		.select()
		.from(gpgKeys)
		.where(eq(gpgKeys.userId, userId))
		.orderBy(gpgKeys.id);
	return Promise.all(rows.map((row) => gpgKeyShape(row, verifiedEmail)));
}

export async function getGpgKey(
	userId: string,
	id: number,
	verifiedEmail: string | null,
): Promise<GpgKeyShape> {
	const [row] = await db
		.select()
		.from(gpgKeys)
		.where(and(eq(gpgKeys.userId, userId), eq(gpgKeys.id, id)));
	if (!row) throw new ApiError(404, "Not Found");
	return gpgKeyShape(row, verifiedEmail);
}

/** `POST /user/gpg_keys`: parse, cap the collection, then insert. */
export async function createGpgKey(
	userId: string,
	armored: string,
	verifiedEmail: string | null,
): Promise<GpgKeyShape> {
	if (armored.length > MAX_GPG_KEY_CHARS)
		throw new ApiError(422, "GPG key is too large");
	if ((await keyCount(userId, gpgKeys)) >= MAX_SIGNING_KEYS_PER_USER) {
		throw new ApiError(422, "Too many GPG keys");
	}
	const parsed = await parseGpgKey(armored);
	const [row] = await db
		.insert(gpgKeys)
		.values({
			userId,
			primaryKeyId: parsed.primaryKeyId,
			keyIds: parsed.keyIds,
			publicKey: armored.trim(),
			emails: parsed.emails,
			canSign: parsed.canSign,
			createdAt: parsed.createdAt,
			expiresAt: parsed.expiresAt,
		})
		.returning();
	if (!row) throw new Error("GPG key insert returned no row");
	return gpgKeyShape(row, verifiedEmail);
}

export async function deleteGpgKey(userId: string, id: number): Promise<void> {
	const deleted = await db
		.delete(gpgKeys)
		.where(and(eq(gpgKeys.userId, userId), eq(gpgKeys.id, id)))
		.returning({ id: gpgKeys.id });
	if (deleted.length === 0) throw new ApiError(404, "Not Found");
}

export async function listSshSigningKeys(
	userId: string,
): Promise<SshSigningKeyShape[]> {
	const rows = await db
		.select()
		.from(sshSigningKeys)
		.where(eq(sshSigningKeys.userId, userId))
		.orderBy(sshSigningKeys.id);
	return rows.map(sshKeyShape);
}

export async function getSshSigningKey(
	userId: string,
	id: number,
): Promise<SshSigningKeyShape> {
	const [row] = await db
		.select()
		.from(sshSigningKeys)
		.where(and(eq(sshSigningKeys.userId, userId), eq(sshSigningKeys.id, id)));
	if (!row) throw new ApiError(404, "Not Found");
	return sshKeyShape(row);
}

export async function createSshSigningKey(
	userId: string,
	title: string,
	key: string,
): Promise<SshSigningKeyShape> {
	if (key.length > MAX_SSH_SIGNING_KEY_CHARS)
		throw new ApiError(422, "SSH signing key is too large");
	if (title.length > MAX_SIGNING_KEY_TITLE_CHARS)
		throw new ApiError(422, "Title is too long");
	const fingerprint = sshFingerprint(key);
	if (!fingerprint || !isSshSigningKey(key)) {
		throw new ApiError(422, "Invalid SSH signing key");
	}
	if ((await keyCount(userId, sshSigningKeys)) >= MAX_SIGNING_KEYS_PER_USER) {
		throw new ApiError(422, "Too many SSH signing keys");
	}
	const [row] = await db
		.insert(sshSigningKeys)
		.values({ userId, title, key: key.trim(), fingerprint })
		.returning();
	if (!row) throw new Error("SSH signing key insert returned no row");
	return sshKeyShape(row);
}

export async function deleteSshSigningKey(
	userId: string,
	id: number,
): Promise<void> {
	const deleted = await db
		.delete(sshSigningKeys)
		.where(and(eq(sshSigningKeys.userId, userId), eq(sshSigningKeys.id, id)))
		.returning({ id: sshSigningKeys.id });
	if (deleted.length === 0) throw new ApiError(404, "Not Found");
}

/** Every signing key (GPG and SSH) of the given users, for verification. */
export async function keysForUsers(userIds: string[]) {
	if (userIds.length === 0) return { gpg: [], ssh: [] };
	const [gpg, ssh] = await Promise.all([
		db.select().from(gpgKeys).where(inArray(gpgKeys.userId, userIds)),
		db
			.select()
			.from(sshSigningKeys)
			.where(inArray(sshSigningKeys.userId, userIds)),
	]);
	return { gpg, ssh };
}

export type GpgKeyRecord = GpgKeyRow;
export type SshSigningKeyRecord = SshSigningKeyRow;
