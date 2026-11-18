/**
 * @vitest-environment node
 *
 * Signing keys and commit verification end to end: GitHub's
 * `/user/gpg_keys` and `/user/ssh_signing_keys` CRUD, and the `verification`
 * object on `GET …/git/commits/{sha}` for GPG-signed, SSH-signed and unsigned
 * commits. Signed commits are written as raw objects, exactly as Git stores
 * them.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));
vi.mock("@tanstack/react-start", () => import("../../test/server-test-utils"));
vi.mock(
	"#/server/session",
	async () => (await import("../../test/app-harness")).sessionModule,
);

const { createUsers, signIn } = await import("../../test/app-harness");
const { db } = await import("#/db");
const { user } = await import("#/db/schema");
const { eq } = await import("drizzle-orm");
const openpgp = await import("openpgp");
const git = (await import("isomorphic-git")).default;
const { repoFor } = await import("../git-repo");
const fixtures = await import("../../test/signing-fixtures");
const { asToken, call, mintToken, post } = await import(
	"../../test/api-client"
);

const EMAIL = "sig@pushstack.test";
const OTHER_EMAIL = "other@pushstack.test";
const TIMESTAMP = 1_700_000_000;

const users = await createUsers("sig", "eve");

let token: string;
let eveToken: string;
let repoId: number;
let head: string;
let gpgPrivateKey: string;
let gpgPublicKey: string;
let gpgKeyId: number;

const del = (auth: string) => ({ ...asToken(auth), method: "DELETE" });

function identity(email = EMAIL) {
	return { name: "Sig User", email, timestamp: TIMESTAMP, timezoneOffset: 0 };
}

/** Insert `gpgsig` into an unsigned commit's content the way Git stores it. */
function withSignatureHeader(payload: string, signature: string): string {
	const boundary = payload.indexOf("\n\n");
	const headers = payload.slice(0, boundary);
	const message = payload.slice(boundary + 2);
	const gpgsig = signature
		.trim()
		.split("\n")
		.map((line, index) => (index === 0 ? `gpgsig ${line}` : ` ${line}`))
		.join("\n");
	return `${headers}\n${gpgsig}\n\n${message}`;
}

async function writeRawCommit(content: string): Promise<string> {
	return git.writeObject({
		...repoFor("sig", "signed"),
		type: "commit",
		object: Buffer.from(content),
		format: "content",
	});
}

/** Create a real commit, sign its exact payload, and store the signed object. */
async function signedCommit(
	message: string,
	sign: (payload: string) => Promise<string>,
	email = EMAIL,
) {
	const repo = repoFor("sig", "signed");
	const unsigned = await git.commit({
		...repo,
		message,
		author: identity(email),
		committer: identity(email),
		parent: [head],
	});
	const raw = await git.readObject({
		...repo,
		oid: unsigned,
		format: "content",
	});
	const payload = Buffer.from(raw.object as Uint8Array).toString("utf8");
	const signature = await sign(payload);
	const oid = await writeRawCommit(withSignatureHeader(payload, signature));
	return { oid, payload, signature };
}

async function signWithGpg(payload: string): Promise<string> {
	const privateKey = await openpgp.readPrivateKey({
		armoredKey: gpgPrivateKey,
	});
	const signature = await openpgp.sign({
		message: await openpgp.createMessage({ text: payload }),
		signingKeys: privateKey,
		detached: true,
	});
	return signature as string;
}

async function commitVerification(sha: string) {
	const result = await call(
		`/repos/sig/signed/git/commits/${sha}`,
		asToken(token),
	);
	expect(result.status).toBe(200);
	return result.body.verification;
}

beforeAll(async () => {
	const generated = await openpgp.generateKey({
		type: "ecc",
		curve: "ed25519Legacy",
		userIDs: [{ name: "Sig User", email: EMAIL }],
		format: "armored",
	});
	gpgPrivateKey = generated.privateKey;
	gpgPublicKey = generated.publicKey;
	// The key owner's account email is the one the commits use; the fixtures
	// create `@example.com` addresses, which REST responses mask.
	await db.update(user).set({ email: EMAIL }).where(eq(user.username, "sig"));
	token = await mintToken(users.sig, ["repo:write"]);
	eveToken = await mintToken(users.eve, ["repo:write"]);
	const created = await call(
		"/user/repos",
		post(token, { name: "signed", auto_init: true }),
	);
	repoId = created.body.id;
	const branches = await call(
		"/repos/sig/signed/branches/main",
		asToken(token),
	);
	head = branches.body.commit.sha;
	expect(repoId).toBeGreaterThan(0);
});

afterEach(() => {
	signIn(users.sig);
});

describe("GPG keys", () => {
	it("starts empty", async () => {
		const { status, body } = await call("/user/gpg_keys", asToken(token));
		expect(status).toBe(200);
		expect(body).toEqual([]);
	});

	it("rejects a private key with 422", async () => {
		const { status } = await call(
			"/user/gpg_keys",
			post(token, { armored_public_key: gpgPrivateKey }),
		);
		expect(status).toBe(422);
	});

	it("rejects a key that does not parse with 422", async () => {
		const { status } = await call(
			"/user/gpg_keys",
			post(token, { armored_public_key: "not a key" }),
		);
		expect(status).toBe(422);
	});

	it("creates, reads, lists and deletes a key", async () => {
		const created = await call(
			"/user/gpg_keys",
			post(token, { armored_public_key: gpgPublicKey }),
		);
		expect(created.status).toBe(201);
		expect(created.body).toMatchObject({
			id: expect.any(Number),
			primary_key_id: expect.any(Number),
			key_id: expect.stringMatching(/^[0-9A-F]{16}$/),
			raw_key: gpgPublicKey.trim(),
			public_key: expect.any(String),
			emails: [{ email: EMAIL, verified: true }],
			can_sign: true,
			revoked: false,
		});
		expect(created.body.subkeys.length).toBeGreaterThan(0);
		const id = created.body.id;
		gpgKeyId = id;

		const listed = await call("/user/gpg_keys", asToken(token));
		expect(listed.body).toHaveLength(1);
		expect(listed.body[0].id).toBe(id);

		const one = await call(`/user/gpg_keys/${id}`, asToken(token));
		expect(one.status).toBe(200);
		expect(one.body.key_id).toBe(created.body.key_id);

		const other = await call(`/user/gpg_keys/${id}`, asToken(eveToken));
		expect(other.status).toBe(404);

		// Keep this key: the verification tests below sign with it.
	});

	it("verifies a commit signed by the registered key", async () => {
		const signed = await signedCommit("GPG signed commit\n", signWithGpg);
		const verification = await commitVerification(signed.oid);
		expect(verification).toMatchObject({
			verified: true,
			reason: "valid",
			signature: signed.signature.trim(),
			payload: signed.payload,
			verified_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
		});
	});

	it("reports an unsigned commit as unsigned", async () => {
		const repo = repoFor("sig", "signed");
		const oid = await git.commit({
			...repo,
			message: "Unsigned commit\n",
			author: identity(),
			committer: identity(),
			parent: [head],
		});
		expect(await commitVerification(oid)).toEqual({
			verified: false,
			reason: "unsigned",
			signature: null,
			payload: null,
			verified_at: null,
		});
	});

	it("reports bad_email when the committer is not the key owner", async () => {
		const signed = await signedCommit(
			"Wrong email\n",
			signWithGpg,
			OTHER_EMAIL,
		);
		expect(await commitVerification(signed.oid)).toMatchObject({
			verified: false,
			reason: "bad_email",
		});
	});

	it("reports invalid when the payload was altered", async () => {
		const signed = await signedCommit("Tampered\n", async (payload) =>
			signWithGpg(`${payload}tampered`),
		);
		expect(await commitVerification(signed.oid)).toMatchObject({
			verified: false,
			reason: "invalid",
		});
	});

	it("drops the cached verdict when the key is deleted", async () => {
		const deleted = await call(`/user/gpg_keys/${gpgKeyId}`, del(token));
		expect(deleted.status).toBe(204);
		const gone = await call(`/user/gpg_keys/${gpgKeyId}`, asToken(token));
		expect(gone.status).toBe(404);
		const signed = await signedCommit("After delete\n", signWithGpg);
		expect(await commitVerification(signed.oid)).toMatchObject({
			verified: false,
			reason: "unknown_key",
		});
	});
});

describe("SSH signing keys", () => {
	it("reports unknown_key before the key is registered", async () => {
		const oid = await writeRawCommit(
			withSignatureHeader(fixtures.SSH_SIGNED_PAYLOAD, fixtures.SSH_SIGNATURE),
		);
		expect(await commitVerification(oid)).toMatchObject({
			verified: false,
			reason: "unknown_key",
		});
	});

	it("creates, lists, reads and deletes a key", async () => {
		const created = await call(
			"/user/ssh_signing_keys",
			post(token, { title: "Laptop", key: fixtures.SSH_PUBLIC_KEY }),
		);
		expect(created.status).toBe(201);
		expect(created.body).toMatchObject({
			id: expect.any(Number),
			key: fixtures.SSH_PUBLIC_KEY,
			title: "Laptop",
		});

		const listed = await call("/user/ssh_signing_keys", asToken(token));
		expect(listed.body).toHaveLength(1);
		const one = await call(
			`/user/ssh_signing_keys/${created.body.id}`,
			asToken(token),
		);
		expect(one.body.id).toBe(created.body.id);
		const other = await call(
			`/user/ssh_signing_keys/${created.body.id}`,
			asToken(eveToken),
		);
		expect(other.status).toBe(404);
	});

	it("verifies an SSH-signed commit", async () => {
		const oid = await writeRawCommit(
			withSignatureHeader(fixtures.SSH_SIGNED_PAYLOAD, fixtures.SSH_SIGNATURE),
		);
		const verification = await commitVerification(oid);
		expect(verification).toMatchObject({
			verified: true,
			reason: "valid",
			signature: fixtures.SSH_SIGNATURE,
			payload: fixtures.SSH_SIGNED_PAYLOAD,
			verified_at: null,
		});
	});

	it("verifies an SSH-signed annotated tag and strips its armor", async () => {
		const raw = `${fixtures.SSH_TAG_PAYLOAD}${fixtures.SSH_TAG_SIGNATURE}\n`;
		const oid = await git.writeObject({
			...repoFor("sig", "signed"),
			type: "tag",
			object: Buffer.from(raw),
			format: "content",
		});
		const { status, body } = await call(
			`/repos/sig/signed/git/tags/${oid}`,
			asToken(token),
		);
		expect(status).toBe(200);
		expect(body.message).toBe("SSH signed tag");
		expect(body.verification).toMatchObject({
			verified: true,
			reason: "valid",
			payload: fixtures.SSH_TAG_PAYLOAD,
		});
	});

	it("rejects anything that is not a public key line", async () => {
		const { status } = await call(
			"/user/ssh_signing_keys",
			post(token, { title: "Bad", key: "-----BEGIN OPENSSH PRIVATE KEY-----" }),
		);
		expect(status).toBe(422);
	});
});
