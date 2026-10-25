/**
 * @vitest-environment node
 *
 * GraphQL issues: `Repository.issue`, `issues` and `issueOrPullRequest`,
 * `Issue` and `node(id:)`, as `gh issue list` and `view` read them. Unreadable
 * repositories answer null with NOT_FOUND, and an unknown number does too.
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
const { createIssueForUser } = await import("../issue-store");
const { db } = await import("#/db");

const users = await createUsers("alice", "bob");
let alice: string;
let bob: string;

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
	for (const title of ["first", "second", "third"]) {
		await createIssueForUser(repo.id, users.alice.id, {
			title,
			body: `${title} body`,
			labels: [],
		});
	}
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
