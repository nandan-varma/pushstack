/**
 * @vitest-environment node
 *
 * `Commit.signature` in GraphQL: null for an unsigned commit, and GitHub's
 * `SshSignature` shape (state, isValid, payload, signature) for a signed one.
 * Commits are written as raw objects with the fixed SSH fixture signature.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

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
const git = (await import("isomorphic-git")).default;
const { repoFor } = await import("../git-repo");
const fixtures = await import("../../test/signing-fixtures");
const { call, mintToken, post } = await import("../../test/api-client");
const { graphql } = await import("../../test/graphql-client");

const EMAIL = "sig@pushstack.test";

const users = await createUsers("sig");
let token: string;
let signedOid: string;
let unsignedOid: string;

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

beforeAll(async () => {
	await db.update(user).set({ email: EMAIL }).where(eq(user.username, "sig"));
	signIn(users.sig);
	token = await mintToken(users.sig, ["repo:write"]);
	const created = await call(
		"/user/repos",
		post(token, { name: "gsigned", auto_init: true }),
	);
	expect(created.status).toBe(201);
	await call(
		"/user/ssh_signing_keys",
		post(token, { title: "Laptop", key: fixtures.SSH_PUBLIC_KEY }),
	);
	const repo = repoFor("sig", "gsigned");
	const write = (content: string) =>
		git.writeObject({
			...repo,
			type: "commit",
			object: Buffer.from(content),
			format: "content",
		});
	signedOid = await write(
		withSignatureHeader(fixtures.SSH_SIGNED_PAYLOAD, fixtures.SSH_SIGNATURE),
	);
	unsignedOid = await call("/repos/sig/gsigned/git/refs/heads/main").then(
		(result) => result.body.object.sha,
	);
});

async function signatureOf(oid: string) {
	const result = await graphql(
		token,
		`query($owner: String!, $name: String!, $oid: GitObjectID!) {
			repository(owner: $owner, name: $name) {
				object(oid: $oid) {
					... on Commit {
						oid
						signature {
							__typename
							email
							isValid
							state
							payload
							signature
							verifiedAt
							wasSignedByGitHub
							... on SshSignature { keyFingerprint }
						}
					}
				}
			}
		}`,
		{ owner: "sig", name: "gsigned", oid },
	);
	expect(result.body.errors).toBeUndefined();
	return result.body.data.repository.object;
}

describe("Commit.signature", () => {
	it("is null for an unsigned commit", async () => {
		const commit = await signatureOf(unsignedOid);
		expect(commit.oid).toBe(unsignedOid);
		expect(commit.signature).toBeNull();
	});

	it("serves GitHub's SSH signature shape", async () => {
		const commit = await signatureOf(signedOid);
		expect(commit.signature).toMatchObject({
			__typename: "SshSignature",
			email: EMAIL,
			isValid: true,
			state: "VALID",
			payload: fixtures.SSH_SIGNED_PAYLOAD,
			signature: fixtures.SSH_SIGNATURE,
			verifiedAt: null,
			wasSignedByGitHub: false,
			keyFingerprint: expect.stringMatching(/^SHA256:/),
		});
	});
});
