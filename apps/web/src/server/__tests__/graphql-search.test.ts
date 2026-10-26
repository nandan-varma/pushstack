/** @vitest-environment node */
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
const { call, mintToken, post } = await import("../../test/api-client");
const { graphql } = await import("../../test/graphql-client");

const users = await createUsers("alice", "bob");
let alice: string;
let bob: string;

/** A search selecting only the count of its own type (the other count is an error). */
const search = (token: string | null, query: string, type: string) =>
	graphql(
		token,
		`query($query: String!, $type: SearchType!) { search(query:$query, type:$type, first:10) { ${type === "REPOSITORY" ? "repositoryCount" : "issueCount"} pageInfo { hasNextPage } nodes { __typename ... on Repository { nameWithOwner } ... on Issue { title } ... on PullRequest { title } } } }`,
		{ query, type },
	);

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	bob = await mintToken(users.bob, ["repo:write"]);
	signIn(users.alice);
	expect(
		(
			await call(
				"/user/repos",
				post(alice, {
					name: "hello",
					description: "Hello search",
					auto_init: true,
				}),
			)
		).status,
	).toBe(201);
	expect(
		(await call("/user/repos", post(alice, { name: "secret", private: true })))
			.status,
	).toBe(201);
	expect(
		(
			await call(
				"/repos/alice/hello/issues",
				post(alice, { title: "Broken build" }),
			)
		).status,
	).toBe(201);
	expect(
		(
			await call(
				"/repos/alice/secret/issues",
				post(alice, { title: "Secret bug" }),
			)
		).status,
	).toBe(201);
});

describe("Query.search(type: REPOSITORY)", () => {
	it("finds the repositories a query names, with repositoryCount and pageInfo", async () => {
		const { body } = await search(alice, "hello", "REPOSITORY");
		expect(body.errors).toBeUndefined();
		expect(body.data.search).toEqual({
			repositoryCount: 1,
			pageInfo: { hasNextPage: false },
			nodes: [{ __typename: "Repository", nameWithOwner: "alice/hello" }],
		});
	});

	it("hides a private repository from a caller who cannot read it", async () => {
		const { body } = await search(bob, "secret", "REPOSITORY");
		expect(body.errors).toBeUndefined();
		expect(body.data.search.repositoryCount).toBe(0);
		expect(body.data.search.nodes).toEqual([]);
	});

	it("refuses issueCount, which is served for ISSUE searches", async () => {
		const { body } = await graphql(
			alice,
			`query { search(query:"hello", type:REPOSITORY, first:1) { issueCount } }`,
		);
		expect(body.errors?.[0]).toMatchObject({ type: "UNPROCESSABLE" });
	});

	it("refuses a repository query with an unserved qualifier", async () => {
		const { body } = await graphql(
			alice,
			`query { search(query:"language:go", type:REPOSITORY, first:1) { repositoryCount } }`,
		);
		expect(body.errors[0]).toMatchObject({ type: "UNPROCESSABLE" });
	});
});

describe("Query.search(type: ISSUE) across repositories", () => {
	it("spans every repository the caller can read, and counts issues", async () => {
		const { body } = await search(alice, "state:open", "ISSUE");
		expect(body.errors).toBeUndefined();
		expect(body.data.search.issueCount).toBe(2);
		expect(
			body.data.search.nodes.map((n: { title: string }) => n.title).sort(),
		).toEqual(["Broken build", "Secret bug"]);
		expect(
			body.data.search.nodes.every(
				(n: { __typename: string }) => n.__typename === "Issue",
			),
		).toBe(true);
	});

	it("keeps a private repository\x27s issues from a reader who cannot see it", async () => {
		const { body } = await search(bob, "state:open", "ISSUE");
		expect(body.data.search.issueCount).toBe(1);
		expect(
			body.data.search.nodes.map((n: { title: string }) => n.title),
		).toEqual(["Broken build"]);
	});

	it("refuses repositoryCount, and ISSUE_ADVANCED, which is not served", async () => {
		const counted = await graphql(
			alice,
			`query { search(query:"state:open", type:ISSUE, first:1) { repositoryCount } }`,
		);
		expect(counted.body.data).toBeNull();
		const { body } = await graphql(
			alice,
			`query { search(query:"x", type:ISSUE_ADVANCED, first:1) { issueCount } }`,
		);
		expect(body.errors[0]).toMatchObject({ type: "UNPROCESSABLE" });
	});

	it("refuses an unserved qualifier with UNPROCESSABLE, not an empty answer", async () => {
		const { body } = await search(alice, "is:locked", "ISSUE");
		expect(body.errors[0]).toMatchObject({ type: "UNPROCESSABLE" });
	});
});
