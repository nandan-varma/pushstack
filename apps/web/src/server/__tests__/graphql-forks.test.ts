/**
 * @vitest-environment node
 *
 * Fork fields on GraphQL `Repository`: `isFork`, `parent`, `forkCount` and
 * `forks`, with the same visibility as REST. A parent or fork the viewer
 * cannot read is null or absent, and never counted.
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
const { call, mintToken, post } = await import("../../test/api-client");
const { graphql } = await import("../../test/graphql-client");
const { db } = await import("#/db");
const { repositoryCollaborators } = await import("#/db/app-schema");
const { invalidateRepositoryAccess } = await import("../repo-access");

const users = await createUsers("alice", "bob", "carol");
let alice: string;
let bob: string;
let carol: string;

const REPO = `isFork forkCount parent { nameWithOwner } forks(first: 10, orderBy: {field: NAME, direction: ASC}) { totalCount nodes { nameWithOwner isFork } }`;
const repo = (token: string | null, owner: string, name: string) =>
	graphql(
		token,
		`query($owner: String!, $name: String!) { repository(owner:$owner, name:$name) { ${REPO} } }`,
		{ owner, name },
	);

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	bob = await mintToken(users.bob, ["repo:write"]);
	carol = await mintToken(users.carol, ["repo:write"]);
	await call("/user/repos", post(alice, { name: "lib", auto_init: true }));
	const secret = await call(
		"/user/repos",
		post(alice, { name: "secret-lib", auto_init: true, private: true }),
	);
	await db.insert(repositoryCollaborators).values({
		repoId: secret.body.id,
		userId: users.bob.id,
		role: "read",
	});
	invalidateRepositoryAccess(secret.body.id);
	for (const [token, name] of [
		[bob, "lib"],
		[carol, "lib"],
		[bob, "secret-lib"],
	] as const) {
		expect(
			(await call(`/repos/alice/${name}/forks`, post(token, {}))).status,
		).toBe(202);
	}
});

describe("Repository fork fields", () => {
	it("a fork names its parent and is a fork", async () => {
		const { body } = await repo(carol, "bob", "lib");
		expect(body.errors).toBeUndefined();
		expect(body.data.repository).toMatchObject({
			isFork: true,
			parent: { nameWithOwner: "alice/lib" },
			forkCount: 0,
		});
	});

	it("a parent lists and counts its readable forks", async () => {
		const { body } = await repo(carol, "alice", "lib");
		expect(body.data.repository).toMatchObject({
			isFork: false,
			parent: null,
			forkCount: 2,
			forks: {
				totalCount: 2,
				nodes: [
					{ nameWithOwner: "bob/lib", isFork: true },
					{ nameWithOwner: "carol/lib", isFork: true },
				],
			},
		});
	});

	it("a private fork is neither listed nor counted for someone who cannot read it", async () => {
		const bobView = await repo(bob, "alice", "secret-lib");
		expect(bobView.body.data.repository.forkCount).toBe(1);
		// The parent's owner cannot read bob's private fork, so it is not counted.
		const aliceView = await repo(alice, "alice", "secret-lib");
		expect(aliceView.body.data.repository.forkCount).toBe(0);
		expect(aliceView.body.data.repository.forks.totalCount).toBe(0);
	});

	it("a fork's parent is null when the viewer cannot read the parent", async () => {
		// Carol cannot read bob/secret-lib at all: the fork itself is unreadable.
		const { body } = await repo(carol, "bob", "secret-lib");
		expect(body.data.repository).toBeNull();
	});

	it("filters User.repositories by isFork", async () => {
		const { body } = await graphql(
			carol,
			`query { user(login: "bob") { forks: repositories(isFork: true, first: 10) { nodes { nameWithOwner } } own: repositories(isFork: false, first: 10) { totalCount } } }`,
		);
		expect(
			body.data.user.forks.nodes.map(
				(n: { nameWithOwner: string }) => n.nameWithOwner,
			),
		).toEqual(["bob/lib"]);
		expect(body.data.user.own.totalCount).toBe(0);
	});
});
