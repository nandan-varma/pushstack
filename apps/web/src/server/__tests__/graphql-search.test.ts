/** @vitest-environment node */
import { beforeAll, describe, expect, it, vi } from "vitest";

const { queries } = vi.hoisted(() => ({ queries: [] as string[] }));
vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb({
		onQuery: (query) => queries.push(query),
	}),
}));
vi.mock("@tanstack/react-start", () => import("../../test/server-test-utils"));
vi.mock(
	"#/server/session",
	async () => (await import("../../test/app-harness")).sessionModule,
);

const { createUsers, signIn } = await import("../../test/app-harness");
const { call, mintToken, post } = await import("../../test/api-client");
const { graphql } = await import("../../test/graphql-client");
const { invalidateRepositoryAccess } = await import("../repo-access");
const { evictRepoByName } = await import("../repository-lookup");

const users = await createUsers("alice", "bob");
let alice: string;
let bob: string;
/** The repositories the seeds create, by name, for the query-count test's caches. */
const seeded: { name: string; id: number }[] = [];

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
	const hello = await call(
		"/user/repos",
		post(alice, {
			name: "hello",
			description: "Hello search",
			auto_init: true,
		}),
	);
	expect(hello.status).toBe(201);
	seeded.push({ name: "hello", id: hello.body.id });
	const secret = await call(
		"/user/repos",
		post(alice, { name: "secret", private: true }),
	);
	expect(secret.status).toBe(201);
	seeded.push({ name: "secret", id: secret.body.id });
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
	for (let index = 0; index < 8; index++) {
		const created = await call(
			"/user/repos",
			post(alice, { name: `ranked-${index}`, description: "Ranked target" }),
		);
		expect(created.status).toBe(201);
		seeded.push({ name: `ranked-${index}`, id: created.body.id });
	}
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

	it("pages by after, before and last over the counted windows", async () => {
		const page = async (variables: Record<string, unknown>) => {
			const { body } = await graphql(
				alice,
				`query($first: Int, $last: Int, $after: String, $before: String) {
					search(query:"state:open", type:ISSUE, first:$first, last:$last, after:$after, before:$before) {
						issueCount
						edges { cursor node { ... on Issue { title } } }
						pageInfo { hasNextPage hasPreviousPage }
					}
				}`,
				variables,
			);
			expect(body.errors).toBeUndefined();
			return body.data.search;
		};
		const all = await page({ first: 2 });
		expect(all.issueCount).toBe(2);
		expect(
			all.edges.map((edge: { node: { title: string } }) => edge.node.title),
		).toEqual(["Secret bug", "Broken build"]);
		const first = await page({ first: 1 });
		expect(first.edges).toHaveLength(1);
		expect(first.pageInfo).toMatchObject({
			hasNextPage: true,
			hasPreviousPage: false,
		});
		const after = await page({ first: 5, after: all.edges[0].cursor });
		expect(
			after.edges.map((edge: { node: { title: string } }) => edge.node.title),
		).toEqual(["Broken build"]);
		expect(after.pageInfo.hasNextPage).toBe(false);
		const last = await page({ last: 1 });
		expect(
			last.edges.map((edge: { node: { title: string } }) => edge.node.title),
		).toEqual(["Broken build"]);
		expect(last.pageInfo).toMatchObject({
			hasNextPage: false,
			hasPreviousPage: true,
		});
		const before = await page({ first: 5, before: all.edges[1].cursor });
		expect(
			before.edges.map((edge: { node: { title: string } }) => edge.node.title),
		).toEqual(["Secret bug"]);
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

/** The queries `run` sends, which is what a page costs. */
async function queriesFor(run: () => Promise<unknown>) {
	queries.length = 0;
	await run();
	return queries.length;
}

const windowCountQueries = () =>
	queries.filter(
		(query) => query.includes("count(*) over ()") && query.includes('"issues"'),
	);

/** Cold repository caches, so a per-row lookup cannot hide behind them. */
function coldRepositories() {
	for (const { name, id } of seeded) {
		invalidateRepositoryAccess(id);
		evictRepoByName("alice", name, id);
	}
}

describe("Query.search query counts", () => {
	it("costs the same queries for a one-repository page and a full page", async () => {
		const page = (first: number, request: string) =>
			graphql(
				alice,
				`query($query: String!, $first: Int!) { search(query:$query, type:REPOSITORY, first:$first) { repositoryCount nodes { __typename } } }`,
				{ query: request, first },
			);
		coldRepositories();
		const one = await queriesFor(() => page(1, "ranked"));
		coldRepositories();
		const many = await queriesFor(() => page(8, "ranked"));
		expect(many).toBe(one);
	});

	it("costs the same queries for one issue and a full page of them", async () => {
		const page = (first: number) =>
			graphql(
				alice,
				`query($first: Int!) { search(query:"state:open", type:ISSUE, first:$first) { issueCount nodes { __typename } } }`,
				{ first },
			);
		coldRepositories();
		const one = await queriesFor(() => page(1));
		coldRepositories();
		const many = await queriesFor(() => page(8));

		expect(many).toBe(one);
	});

	it("counts the issue search's total once per page, in the page query", async () => {
		await search(alice, "state:open", "ISSUE");
		queries.length = 0;
		await search(alice, "state:open", "ISSUE");
		expect(windowCountQueries()).toHaveLength(1);
	});
});
