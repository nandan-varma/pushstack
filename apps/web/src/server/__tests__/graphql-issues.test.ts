/**
 * @vitest-environment node
 *
 * GraphQL issues: `Repository.issue`, `issues` and `issueOrPullRequest`,
 * `Issue` and `node(id:)`, as `gh issue list` and `view` read them. Unreadable
 * repositories answer null with NOT_FOUND, and an unknown number does too.
 */
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

const { createUsers } = await import("../../test/app-harness");
const { call, mintToken, post } = await import("../../test/api-client");
const { graphql } = await import("../../test/graphql-client");
const { createIssueForUser } = await import("../issue-store");
const { db } = await import("#/db");

const users = await createUsers("alice", "bob");
let alice: string;
let bob: string;
let repoId: number;

const LIST = `query IssueList($owner: String!, $name: String!, $first: Int, $states: [IssueState!], $orderBy: IssueOrder) {
  repository(owner: $owner, name: $name) {
    issues(first: $first, states: $states, orderBy: $orderBy) {
      totalCount
      nodes { number title state stateReason closed body author { login } }
      pageInfo { hasNextPage }
    }
  }
}`;

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	bob = await mintToken(users.bob, ["repo:write"]);
	await call("/user/repos", post(alice, { name: "proj", auto_init: true }));
	const repo = await db.query.repositories.findFirst({
		where: { name: "proj" },
	});
	if (!repo) throw new Error("alice/proj missing");
	repoId = repo.id;
	for (const title of ["first", "second", "third"]) {
		await createIssueForUser(repo.id, users.alice.id, {
			title,
			body: `${title} body`,
			labels: [],
		});
	}
	await call("/repos/alice/proj/milestones", post(alice, { title: "v1" }));
	await call(
		"/repos/alice/proj/milestones",
		post(alice, { title: "v2", state: "closed" }),
	);
});

describe("Repository.issues", () => {
	it("lists newest first and bounds the page", async () => {
		const { body } = await graphql(bob, LIST, {
			owner: "alice",
			name: "proj",
			first: 2,
			orderBy: { field: "CREATED_AT", direction: "DESC" },
		});
		expect(body.errors).toBeUndefined();
		const connection = body.data.repository.issues;
		expect(connection.totalCount).toBe(3);
		expect(connection.nodes.map((n: { title: string }) => n.title)).toEqual([
			"third",
			"second",
		]);
		expect(connection.nodes[0]).toMatchObject({
			state: "OPEN",
			stateReason: null,
			closed: false,
			author: { login: "alice" },
		});
		expect(connection.pageInfo.hasNextPage).toBe(true);
	});

	it("rejects a page without first or last", async () => {
		const { body } = await graphql(bob, LIST, { owner: "alice", name: "proj" });
		expect(body.errors?.[0]?.type).toBe("MISSING_PAGINATION_BOUNDARIES");
	});

	it("an empty states list matches nothing", async () => {
		const { body } = await graphql(bob, LIST, {
			owner: "alice",
			name: "proj",
			first: 10,
			states: [],
		});
		expect(body.data.repository.issues).toMatchObject({
			totalCount: 0,
			nodes: [],
		});
	});

	it("reports a repository the caller cannot read as null with NOT_FOUND", async () => {
		const { body } = await graphql(bob, LIST, {
			owner: "nobody",
			name: "missing",
			first: 1,
		});
		expect(body.data.repository).toBeNull();
		expect(body.errors?.map((e: { type?: string }) => e.type)).toEqual([
			"NOT_FOUND",
		]);
	});
});

const MILESTONES = `query($states: [MilestoneState!], $first: Int, $query: String) {
  repository(owner: "alice", name: "proj") {
    milestones(states: $states, first: $first, query: $query) {
      totalCount
      nodes { id number title state }
      pageInfo { hasNextPage }
    }
  }
}`;

describe("Repository.milestones", () => {
	it("lists both states by default, and one state when asked", async () => {
		const all = await graphql(bob, MILESTONES, { first: 10 });
		expect(all.body.errors).toBeUndefined();
		expect(
			all.body.data.repository.milestones.nodes.map(
				(n: { title: string }) => n.title,
			),
		).toEqual(["v1", "v2"]);
		const open = await graphql(bob, MILESTONES, {
			first: 10,
			states: ["OPEN"],
		});
		expect(open.body.data.repository.milestones).toMatchObject({
			totalCount: 1,
			nodes: [{ title: "v1", state: "OPEN" }],
		});
	});

	it("an empty states list matches nothing", async () => {
		const { body } = await graphql(bob, MILESTONES, { first: 10, states: [] });
		expect(body.data.repository.milestones).toMatchObject({
			totalCount: 0,
			nodes: [],
		});
	});

	it("filters on the title and bounds the page", async () => {
		const searched = await graphql(bob, MILESTONES, { first: 10, query: "v2" });
		expect(
			searched.body.data.repository.milestones.nodes.map(
				(n: { number: number }) => n.number,
			),
		).toEqual([2]);
		const page = await graphql(bob, MILESTONES, { first: 1 });
		expect(page.body.data.repository.milestones).toMatchObject({
			totalCount: 2,
			pageInfo: { hasNextPage: true },
		});
	});

	it("answers each milestone's id, which issue mutations accept", async () => {
		const { body } = await graphql(
			bob,
			`{ repository(owner: "alice", name: "proj") { id milestones(first: 10) { nodes { id } } } }`,
		);
		const { id: repositoryId, milestones } = body.data.repository;
		const id = milestones.nodes[0].id as string;
		const made = await graphql(
			alice,
			`mutation($repo: ID!, $id: ID!) { createIssue(input: {repositoryId: $repo, title: "Milestoned", milestoneId: $id}) { issue { milestone { number title } } } }`,
			{ repo: repositoryId, id },
		);
		expect(made.body.errors).toBeUndefined();
		expect(made.body.data.createIssue.issue.milestone).toEqual({
			number: 1,
			title: "v1",
		});
		const node = await graphql(
			bob,
			`query($id: ID!) { node(id: $id) { ... on Milestone { number title state } } }`,
			{ id },
		);
		expect(node.body.data.node).toEqual({
			number: 1,
			title: "v1",
			state: "OPEN",
		});
	});
});

describe("response and query budgets", () => {
	it("refuses an issue page whose bodies exceed the response budget", async () => {
		const body = "x".repeat(65_536);
		for (let i = 0; i < 16; i++) {
			await createIssueForUser(repoId, users.alice.id, {
				title: `big ${i}`,
				body,
				labels: [],
			});
		}
		const query = `query($first: Int!) { repository(owner: "alice", name: "proj") { issues(first: $first) { nodes { body } } } }`;
		const over = await graphql(bob, query, { first: 16 });
		expect(over.body.data.repository).toBeNull();
		expect(over.body.errors?.[0]?.type).toBe("UNPROCESSABLE");
		const under = await graphql(bob, query, { first: 10 });
		expect(under.body.errors).toBeUndefined();
		expect(under.body.data.repository.issues.nodes).toHaveLength(10);
	});

	it("looks up each comment author's association once per page", async () => {
		for (const text of ["one", "two", "three"]) {
			const posted = await call(
				"/repos/alice/proj/issues/1/comments",
				post(bob, { body: text }),
			);
			expect(posted.status).toBe(201);
		}
		// Comment reads: one collaborator lookup for the viewer, however many
		// comments (all by one non-owner author) the page holds.
		const lookups = async (last: number) => {
			queries.length = 0;
			const { body } = await graphql(
				bob,
				`{ repository(owner: "alice", name: "proj") { issue(number: 1) { comments(last: ${last}) { nodes { authorAssociation } } } } }`,
			);
			expect(body.errors).toBeUndefined();
			return queries.filter((q) => q.includes('"repository_collaborators"'))
				.length;
		};
		expect(await lookups(10)).toBe(await lookups(1));
	});
});

describe("private repositories", () => {
	it("answers NOT_FOUND to a non-collaborator for every issue read", async () => {
		await call("/user/repos", post(alice, { name: "secret", private: true }));
		const repo = await db.query.repositories.findFirst({
			where: { name: "secret" },
		});
		if (!repo) throw new Error("alice/secret missing");
		await createIssueForUser(repo.id, users.alice.id, {
			title: "private",
			labels: [],
		});
		const issue = await graphql(
			alice,
			`{ repository(owner: "alice", name: "secret") { issue(number: 1) { id } } }`,
		);
		const id = issue.body.data.repository.issue.id;
		const reads = [
			`{ repository(owner: "alice", name: "secret") { issue(number: 1) { id } } }`,
			`{ repository(owner: "alice", name: "secret") { issues(first: 5) { totalCount } } }`,
			`{ repository(owner: "alice", name: "secret") { issueOrPullRequest(number: 1) { __typename } } }`,
		];
		for (const query of reads) {
			const { body } = await graphql(bob, query);
			expect(body.data.repository).toBeNull();
			expect(body.errors?.map((e: { type?: string }) => e.type)).toEqual([
				"NOT_FOUND",
			]);
		}
		const { body } = await graphql(
			bob,
			`query($id: ID!) { node(id: $id) { ... on Issue { number } } }`,
			{ id },
		);
		expect(body.data.node).toBeNull();
	});
});

describe("Repository.issue and issueOrPullRequest", () => {
	it("reads an issue by number with its author and body", async () => {
		const { body } = await graphql(
			bob,
			`query($number: Int!) { repository(owner: "alice", name: "proj") { issue(number: $number) { title body url closed issueType { id } parent { id } subIssuesSummary { total } } } }`,
			{ number: 1 },
		);
		expect(body.errors).toBeUndefined();
		expect(body.data.repository.issue).toMatchObject({
			title: "first",
			body: "first body",
			closed: false,
			issueType: null,
			parent: null,
			subIssuesSummary: { total: 0 },
		});
	});

	it("answers NOT_FOUND for an unknown issue number", async () => {
		const { body } = await graphql(
			bob,
			`{ repository(owner: "alice", name: "proj") { issue(number: 99) { id } } }`,
		);
		expect(body.data.repository.issue).toBeNull();
		expect(body.errors?.[0]?.type).toBe("NOT_FOUND");
	});

	it("resolves node(id:) for an issue to the same record", async () => {
		const { body: listed } = await graphql(
			bob,
			`{ repository(owner: "alice", name: "proj") { issue(number: 1) { id } } }`,
		);
		const id = listed.data.repository.issue.id;
		const { body } = await graphql(
			bob,
			`query($id: ID!) { node(id: $id) { ... on Issue { number title } } }`,
			{ id },
		);
		expect(body.data.node).toEqual({ number: 1, title: "first" });
	});
});
