/**
 * @vitest-environment node
 *
 * `POST /repos/{owner}/{repo}/forks` (`gh repo fork`), end to end over pglite
 * and git-fs.ts's in-memory store. Each successful response is also checked
 * against its contract schema by the test client.
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

const { createUsers } = await import("../../test/app-harness");
const { call, mintToken, post, patch } = await import("../../test/api-client");
const { db } = await import("#/db");
const { repositoryCollaborators } = await import("#/db/app-schema");
const { invalidateRepositoryAccess } = await import("../repo-access");

const users = await createUsers("alice", "bob", "carol");
let alice: string;
let bob: string;
let bobRead: string;
let carol: string;
let privateProject: number;

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	bob = await mintToken(users.bob, ["repo:write"]);
	bobRead = await mintToken(users.bob, ["repo:read"]);
	carol = await mintToken(users.carol, ["repo:write"]);
	await call("/user/repos", post(alice, { name: "proj", auto_init: true }));
	await call("/user/repos", post(alice, { name: "secret", private: true }));
	privateProject = (
		await call(
			"/user/repos",
			post(alice, { name: "priv-proj", auto_init: true, private: true }),
		)
	).body.id;
	await call("/user/repos", post(alice, { name: "arch", auto_init: true }));
	await call("/user/repos", post(bob, { name: "taken" }));
});

describe("POST /repos/{owner}/{repo}/forks", () => {
	it("answers 202 with the fork, its parent and its source", async () => {
		const response = await call("/repos/alice/proj/forks", {
			...post(bob, {}),
		});
		expect(response.status).toBe(202);
		expect(response.body).toMatchObject({
			name: "proj",
			full_name: "bob/proj",
			owner: { login: "bob" },
			private: false,
			fork: true,
			default_branch: "main",
			permissions: { admin: true, push: true, pull: true },
			parent: { full_name: "alice/proj", fork: false },
			source: { full_name: "alice/proj", fork: false },
		});
		expect(response.headers.get("location")).toContain("/repos/bob/proj");
	});

	it("is visible as a fork on the repository itself", async () => {
		const response = await call("/repos/bob/proj");
		expect(response.status).toBe(200);
		expect(response.body.fork).toBe(true);
	});

	it("names the fork after the request's name", async () => {
		const response = await call("/repos/alice/proj/forks", {
			...post(bob, { name: "proj-copy" }),
		});
		expect(response.status).toBe(202);
		expect(response.body.full_name).toBe("bob/proj-copy");
	});

	it("answers the existing fork when the same parent is forked under the same name", async () => {
		const first = await call("/repos/bob/proj");
		const again = await call("/repos/alice/proj/forks", post(bob, {}));
		expect(again.status).toBe(202);
		expect(again.body.id).toBe(first.body.id);
	});

	it("keeps a fork of a fork's source as the root of the network", async () => {
		const response = await call("/repos/bob/proj/forks", post(carol, {}));
		expect(response.status).toBe(202);
		expect(response.body).toMatchObject({
			full_name: "carol/proj",
			parent: { full_name: "bob/proj", fork: true },
			source: { full_name: "alice/proj" },
		});
	});

	it("refuses a name that is another repository of the caller's", async () => {
		const response = await call("/repos/alice/proj/forks", {
			...post(bob, { name: "taken" }),
		});
		expect(response.status).toBe(422);
		expect(response.body.errors).toEqual([
			expect.objectContaining({
				resource: "Repository",
				field: "name",
				code: "custom",
				message: "name already exists on this account",
			}),
		]);
	});

	it("does not reveal a private repository to a user who cannot read it", async () => {
		const response = await call("/repos/alice/priv-proj/forks", post(bob, {}));
		expect(response.status).toBe(404);
	});

	it("forks a private repository for a collaborator who can read it", async () => {
		await db.insert(repositoryCollaborators).values({
			repoId: privateProject,
			userId: users.bob.id,
			role: "read",
		});
		invalidateRepositoryAccess(privateProject);
		const response = await call("/repos/alice/priv-proj/forks", post(bob, {}));
		expect(response.status).toBe(202);
		expect(response.body).toMatchObject({ private: true, fork: true });
	});

	it("refuses an organization other than the caller", async () => {
		const response = await call(
			"/repos/alice/proj/forks",
			post(carol, { organization: "some-org" }),
		);
		expect(response.status).toBe(422);
		expect(response.body.errors).toEqual([
			expect.objectContaining({ field: "organization", code: "invalid" }),
		]);
	});

	it("needs a token with repo:write", async () => {
		const response = await call("/repos/alice/proj/forks", post(bobRead, {}));
		expect(response.status).toBe(403);
	});

	it("forks an archived repository, which stays archived for its owner", async () => {
		const archived = await call(
			"/repos/alice/arch",
			patch(alice, { archived: true }),
		);
		expect(archived.status).toBe(200);
		const response = await call("/repos/alice/arch/forks", post(carol, {}));
		expect(response.status).toBe(202);
		expect(response.body.archived).toBe(false);
	});

	it("answers 404 for an unknown repository", async () => {
		const response = await call("/repos/alice/nope/forks", post(bob, {}));
		expect(response.status).toBe(404);
	});

	it("is limited per user per window", async () => {
		const source = await call("/repos/alice/proj");
		expect(source.status).toBe(200);
		let last = 0;
		for (let i = 0; i < 40; i++) {
			const response = await call(
				"/repos/alice/proj/forks",
				post(alice, { name: `burst-${i}` }),
			);
			last = response.status;
			if (last === 403) break;
		}
		expect(last).toBe(403);
	});

	it("needs a signed-in caller", async () => {
		const response = await call("/repos/alice/proj/forks", {
			method: "POST",
			body: "{}",
		});
		expect(response.status).toBe(401);
	});
});
