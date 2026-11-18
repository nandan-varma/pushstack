/**
 * @vitest-environment node
 *
 * Three thread kinds on one `#N` sequence: an issue, a pull request and a
 * discussion get consecutive numbers, and every list that predates
 * discussions keeps returning only its own kinds.
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
const { discussions, issues, pullRequests } = await import("#/db/app-schema");
const { listDiscussionCategories } = await import("../discussion-store");
const { claimNextIssueOrPrNumber } = await import("../repository-lookup");
const { findThread } = await import("../thread-store");

const users = await createUsers("alice");
let token: string;
let repoId: number;

async function insertThread(kind: string, title: string) {
	const [issue] = await db
		.insert(issues)
		.values({
			repoId,
			number: await claimNextIssueOrPrNumber(repoId),
			kind: kind as "issue" | "pull_request" | "discussion",
			authorId: users.alice.id,
			title,
		})
		.returning();
	if (!issue) throw new Error("thread insert returned no row");
	return issue;
}

beforeAll(async () => {
	token = await mintToken(users.alice, ["repo:write"]);
	const created = await call("/user/repos", post(token, { name: "proj" }));
	repoId = created.body.id;

	await insertThread("issue", "an issue");
	const pull = await insertThread("pull_request", "a pull request");
	await db.insert(pullRequests).values({
		issueId: pull.id,
		sourceBranch: "feature",
		targetBranch: "main",
	});
	const [category] = await listDiscussionCategories(repoId);
	const discussion = await insertThread("discussion", "a discussion");
	await db
		.insert(discussions)
		.values({ issueId: discussion.id, categoryId: category.id });
});

describe("one shared sequence", () => {
	it("numbers the three kinds #1, #2 and #3", async () => {
		const rows = await db
			.select({ number: issues.number, kind: issues.kind })
			.from(issues)
			.orderBy(issues.number);
		expect(rows).toEqual([
			{ number: 1, kind: "issue" },
			{ number: 2, kind: "pull_request" },
			{ number: 3, kind: "discussion" },
		]);
	});

	it("finds each kind by its own number and filter", async () => {
		expect((await findThread(repoId, 1, "issue"))?.kind).toBe("issue");
		expect((await findThread(repoId, 2, "pull_request"))?.kind).toBe(
			"pull_request",
		);
		expect((await findThread(repoId, 3, "discussion"))?.kind).toBe(
			"discussion",
		);
		expect(await findThread(repoId, 3, "issue")).toBeNull();
	});
});

describe("lists that predate discussions", () => {
	it("GET /repos/{o}/{r}/issues leaves the discussion out", async () => {
		const response = await call("/repos/alice/proj/issues", {
			authorization: `Bearer ${token}`,
		});
		expect(response.status).toBe(200);
		expect(
			response.body.map((issue: { number: number }) => issue.number),
		).not.toContain(3);
		expect(
			response.body.map((issue: { number: number }) => issue.number),
		).toContain(1);
	});

	it("Repository.issues and Repository.pullRequests leave it out", async () => {
		const { body } = await graphql(
			token,
			`query ($owner: String!, $name: String!) {
				repository(owner: $owner, name: $name) {
					issues(first: 10) { nodes { number } }
					pullRequests(first: 10) { nodes { number } }
				}
			}`,
			{ owner: "alice", name: "proj" },
		);
		expect(body.errors).toBeUndefined();
		expect(
			body.data.repository.issues.nodes.map(
				(node: { number: number }) => node.number,
			),
		).toEqual([1]);
		expect(
			body.data.repository.pullRequests.nodes.map(
				(node: { number: number }) => node.number,
			),
		).toEqual([2]);
	});
});
