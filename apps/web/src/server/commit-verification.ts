/**
 * GitHub's signature verdict for a commit or tag: which key signed it, whether
 * that key belongs to the committer's verified email, and the `reason` string
 * (`valid`, `unknown_key`, `bad_email`, …) REST serves.
 *
 * The crypto lives in `signature-verify.ts`; this module resolves the signer
 * account and its keys from Postgres and caches one verdict per object oid.
 * Key mutations call {@link clearVerificationCache} so a newly added key
 * applies immediately on the instance that handled the write; other instances
 * converge within the cache TTL.
 */
import { inArray, or, sql } from "drizzle-orm";
import type { CommitInfo } from "git-fs-s3/ops";
import { db } from "#/db";
import { gpgKeys, sshSigningKeys } from "#/db/app-schema";
import { user } from "#/db/schema";
import { MAX_VERIFICATION_CACHE_ENTRIES } from "#/lib/limits";
import { getRawObject } from "./git-read";
import {
	gpgSignatureKeyIds,
	type SignedObject,
	splitSignature,
	sshSignatureFingerprint,
	verifyGpgSignature,
	verifySshSignature,
} from "./signature-verify";
import type { GpgKeyRecord, SshSigningKeyRecord } from "./signing-key-store";
import { createTtlCoalescedCache } from "./ttl-cache";

/** GitHub's REST `verification.reason` values. */
export type VerificationReason =
	| "valid"
	| "unsigned"
	| "unknown_key"
	| "bad_email"
	| "unverified_email"
	| "no_user"
	| "invalid"
	| "malformed_signature"
	| "unknown_signature_type"
	| "expired_key"
	| "not_signing_key";

/** The REST `verification` object on commits and annotated tags. */
export interface Verification {
	verified: boolean;
	reason: VerificationReason;
	signature: string | null;
	payload: string | null;
	verified_at: string | null;
	/** The signing key, for GraphQL's `GpgSignature.keyId`. Not served by REST. */
	keyId?: string | null;
	/** The SSH key fingerprint, for GraphQL's `SshSignature.keyFingerprint`. */
	keyFingerprint?: string | null;
	/** The armored signature's type, for GraphQL's object type. */
	signatureType?: "gpg" | "ssh" | "unknown";
}

export const UNSIGNED: Verification = {
	verified: false,
	reason: "unsigned",
	signature: null,
	payload: null,
	verified_at: null,
};

type Account = { id: string; email: string; emailVerified: boolean };

const cache = createTtlCoalescedCache<Verification>({
	ttlMs: 5 * 60 * 1000,
	maxEntries: MAX_VERIFICATION_CACHE_ENTRIES,
});

/** The REST `verification` shape: internal key details are not served. */
export function restVerification(verification: Verification) {
	return {
		verified: verification.verified,
		reason: verification.reason,
		signature: verification.signature,
		payload: verification.payload,
		verified_at: verification.verified_at,
	};
}

/** Forget every cached verdict: a signing key was added or removed. */
export function clearVerificationCache(): void {
	cache.deletePrefix("");
}

function withSignature(
	reason: VerificationReason,
	signed: SignedObject,
): Verification {
	return {
		verified: false,
		reason,
		signature: signed.signature,
		payload: signed.payload,
		verified_at: null,
		signatureType: signed.type,
	};
}

function accountFor(accounts: Account[], email: string): Account | undefined {
	const lower = email.toLowerCase();
	return accounts.find((account) => account.email.toLowerCase() === lower);
}

function gpgKeyFor(
	rows: GpgKeyRecord[],
	keyIds: string[],
): GpgKeyRecord | undefined {
	return rows.find((row) =>
		row.keyIds.some((keyId) => keyIds.includes(keyId.toUpperCase())),
	);
}

/**
 * The verdict for one signature: key → owner account → email match → crypto.
 * `accounts` holds the committer's account (when one exists) and every key
 * owner's account touched by the batch.
 */
async function verdictFor(
	signed: SignedObject,
	committerEmail: string,
	accounts: Account[],
	gpg: GpgKeyRecord[],
	ssh: SshSigningKeyRecord[],
): Promise<Verification> {
	if (signed.type === "unknown") {
		return withSignature("unknown_signature_type", signed);
	}

	let keyIds: string[] = [];
	let fingerprint: string | null = null;
	if (signed.type === "gpg") {
		try {
			keyIds = await gpgSignatureKeyIds(signed.signature);
		} catch {
			return withSignature("malformed_signature", signed);
		}
	} else {
		fingerprint = sshSignatureFingerprint(signed.signature);
		if (!fingerprint) return withSignature("malformed_signature", signed);
	}

	const gpgKey = signed.type === "gpg" ? gpgKeyFor(gpg, keyIds) : undefined;
	const sshKey =
		signed.type === "ssh" && fingerprint
			? ssh.find((row) => row.fingerprint === fingerprint)
			: undefined;
	const key = gpgKey ?? sshKey;
	if (!key) {
		const account = accountFor(accounts, committerEmail);
		if (!account) return withSignature("no_user", signed);
		if (!account.emailVerified) {
			return withSignature("unverified_email", signed);
		}
		return withSignature("unknown_key", signed);
	}

	const owner = accounts.find((account) => account.id === key.userId);
	if (!owner) return withSignature("no_user", signed);
	if (!owner.emailVerified) {
		return withSignature("unverified_email", signed);
	}
	if (owner.email.toLowerCase() !== committerEmail.toLowerCase()) {
		return withSignature("bad_email", signed);
	}
	if (gpgKey) {
		if (!gpgKey.canSign) return withSignature("not_signing_key", signed);
		if (gpgKey.expiresAt && gpgKey.expiresAt < new Date()) {
			return withSignature("expired_key", signed);
		}
	}

	if (gpgKey) {
		const checked = await verifyGpgSignature(signed.payload, signed.signature, {
			armored: gpgKey.publicKey,
		}).catch(() => null);
		if (!checked) return withSignature("invalid", signed);
		if (checked.expired) return withSignature("expired_key", signed);
		if (!checked.valid) return withSignature("invalid", signed);
		return {
			verified: true,
			reason: "valid",
			signature: signed.signature,
			payload: signed.payload,
			verified_at: checked.signedAt?.toISOString() ?? null,
			keyId: gpgKey.keyIds[0] ?? null,
			signatureType: "gpg",
		};
	}
	const valid = await verifySshSignature(signed.payload, signed.signature);
	if (!valid) return withSignature("invalid", signed);
	return {
		verified: true,
		reason: "valid",
		signature: signed.signature,
		payload: signed.payload,
		verified_at: null,
		keyFingerprint: sshKey?.fingerprint ?? null,
		signatureType: "ssh",
	};
}

/** The accounts a batch may need: the signers and the keys' owners. */
async function loadAccounts(emails: string[], ids: string[]) {
	const clauses = [
		...(emails.length > 0
			? [
					inArray(
						sql`lower(${user.email})`,
						emails.map((email) => email.toLowerCase()),
					),
				]
			: []),
		...(ids.length > 0 ? [inArray(user.id, ids)] : []),
	];
	if (clauses.length === 0) return [];
	return db
		.select({
			id: user.id,
			email: user.email,
			emailVerified: user.emailVerified,
		})
		.from(user)
		.where(clauses.length === 1 ? clauses[0] : or(...clauses));
}

/** Every GPG/SSH key matching the batch's signatures. */
async function loadKeys(gpgIds: string[], sshFingerprints: string[]) {
	const gpgClauses = gpgIds.map(
		(keyId) => sql`${gpgKeys.keyIds} @> ${JSON.stringify([keyId])}::jsonb`,
	);
	const [gpg, ssh] = await Promise.all([
		gpgClauses.length > 0
			? db
					.select()
					.from(gpgKeys)
					.where(gpgClauses.length === 1 ? gpgClauses[0] : or(...gpgClauses))
			: Promise.resolve([] as GpgKeyRecord[]),
		sshFingerprints.length > 0
			? db
					.select()
					.from(sshSigningKeys)
					.where(inArray(sshSigningKeys.fingerprint, sshFingerprints))
			: Promise.resolve([] as SshSigningKeyRecord[]),
	]);
	return { gpg, ssh };
}

interface PendingCommit {
	oid: string;
	email: string;
	signed: SignedObject;
}

/**
 * Verdicts for a batch of commits, keyed by oid. Unsigned commits cost no
 * query; signed ones share their account and key reads across the batch. A
 * signed commit is read once from object storage for its exact bytes.
 */
export async function verifyCommits(
	ownerKey: string,
	repoName: string,
	infos: CommitInfo[],
): Promise<Map<string, Verification>> {
	const result = new Map<string, Verification>();
	const pending: PendingCommit[] = [];
	await Promise.all(
		infos.map(async (info) => {
			const cached = cache.peek(`commit:${info.oid}`);
			if (cached) {
				result.set(info.oid, cached);
				return;
			}
			const headers = info.commit as {
				gpgsig?: string;
				"gpgsig-sha256"?: string;
			};
			if (!headers.gpgsig && !headers["gpgsig-sha256"]) {
				result.set(info.oid, UNSIGNED);
				cache.set(`commit:${info.oid}`, UNSIGNED);
				return;
			}
			const raw = await getRawObject(ownerKey, repoName, info.oid);
			const signed = splitSignature("commit", raw.content);
			if (!signed) {
				result.set(info.oid, UNSIGNED);
				cache.set(`commit:${info.oid}`, UNSIGNED);
				return;
			}
			pending.push({
				oid: info.oid,
				email: info.commit.committer.email,
				signed,
			});
			return;
		}),
	);
	if (pending.length === 0) return result;

	const emails = [...new Set(pending.map((entry) => entry.email))];
	const signatureKeyIds = await Promise.all(
		pending.map((entry) =>
			entry.signed.type === "gpg"
				? gpgSignatureKeyIds(entry.signed.signature).catch(() => [])
				: Promise.resolve([]),
		),
	);
	const fingerprints = pending.flatMap((entry) => {
		if (entry.signed.type !== "ssh") return [];
		const fingerprint = sshSignatureFingerprint(entry.signed.signature);
		return fingerprint ? [fingerprint] : [];
	});
	const keys = await loadKeys(
		[...new Set(signatureKeyIds.flat())],
		fingerprints,
	);
	const ownerIds = [
		...new Set([...keys.gpg, ...keys.ssh].map((row) => row.userId)),
	];
	const signerAccounts = await loadAccounts(emails, []);
	const ownerAccounts = await loadAccounts([], ownerIds);
	const accounts = [...signerAccounts, ...ownerAccounts].filter(
		(account, index, all) =>
			all.findIndex((candidate) => candidate.id === account.id) === index,
	);

	for (const entry of pending) {
		const verdict = await verdictFor(
			entry.signed,
			entry.email,
			accounts,
			keys.gpg,
			keys.ssh,
		);
		result.set(entry.oid, verdict);
		cache.set(`commit:${entry.oid}`, verdict);
	}
	return result;
}

/** One commit's verdict, through the same cache the batch uses. */
export async function verifyCommit(
	ownerKey: string,
	repoName: string,
	info: CommitInfo,
): Promise<Verification> {
	const cached = cache.peek(`commit:${info.oid}`);
	if (cached) return cached;
	const verdicts = await verifyCommits(ownerKey, repoName, [info]);
	return verdicts.get(info.oid) ?? UNSIGNED;
}

/**
 * An annotated tag's verdict. Its signature is appended to the tag object,
 * so the raw content is read for both the payload and the armor.
 */
export async function verifyTag(
	ownerKey: string,
	repoName: string,
	oid: string,
	taggerEmail: string,
): Promise<Verification> {
	const cached = cache.peek(`tag:${oid}`);
	if (cached) return cached;
	const raw = await getRawObject(ownerKey, repoName, oid);
	const signed = splitSignature("tag", raw.content);
	if (!signed) {
		cache.set(`tag:${oid}`, UNSIGNED);
		return UNSIGNED;
	}
	const signatureKeyIds =
		signed.type === "gpg"
			? await gpgSignatureKeyIds(signed.signature).catch(() => [])
			: [];
	const fingerprint =
		signed.type === "ssh" ? sshSignatureFingerprint(signed.signature) : null;
	const keys = await loadKeys(
		signatureKeyIds,
		fingerprint ? [fingerprint] : [],
	);
	const signerAccounts = await loadAccounts([taggerEmail], []);
	const ownerAccounts = await loadAccounts(
		[],
		[...new Set([...keys.gpg, ...keys.ssh].map((row) => row.userId))],
	);
	const accounts = [...signerAccounts, ...ownerAccounts].filter(
		(account, index, all) =>
			all.findIndex((candidate) => candidate.id === account.id) === index,
	);
	const verdict = await verdictFor(
		signed,
		taggerEmail,
		accounts,
		keys.gpg,
		keys.ssh,
	);
	cache.set(`tag:${oid}`, verdict);
	return verdict;
}
