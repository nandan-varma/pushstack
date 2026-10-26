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
const { call, patch, post, mintToken } = await import("../../test/api-client");
const { graphql } = await import("../../test/graphql-client");
const { db } = await import("#/db");
const { pullRequestReviews } = await import("#/db/app-schema");
const { encodeNodeId } = await import("../graphql/node-id");
const { findPullRequestByNumber } = await import("../thread-store");
const files = await import("../files");
const { MAX_SEARCH_QUERY_CHARS, MAX_LIST_SKIP } = await import("#/lib/limits");
const { encodeCursor } = await import("../graphql/connection");

const users = await createUsers("alice", "bob", "carol");
let alice: string;
let bob: string;
let repoRestId: number;

/** A submitted review by `authorId` on pull request `number`, at a fixed time. */
async function review(
	number: number,
	authorId: string,
	state: "approved" | "changes_requested" | "commented",
	second: number,
) {
	const pr = await findPullRequestByNumber(repoRestId, number);
	if (!pr) throw new Error(`pull request ${number} missing`);
	await db.insert(pullRequestReviews).values({
		repoId: repoRestId,
		pullRequestId: pr.id,
		authorId,
		state,
		submittedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, second)),
		createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, second)),
	});
}

const decisionOf = async (number: number) => {
	const { body } = await graphql(
		alice,
		`query($number: Int!) { repository(owner:"alice",name:"proj") { pullRequest(number:$number) { reviewDecision latestReviews(first:10) { totalCount nodes { state author { login } } } } } }`,
		{ number },
	);
	expect(body.errors).toBeUndefined();
	return body.data.repository.pullRequest;
};

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	bob = await mintToken(users.bob, ["repo:write"]);
	signIn(users.alice);
	const repo = await call(
		"/user/repos",
		post(alice, { name: "proj", auto_init: true }),
	);
	expect(repo.status).toBe(201);
	repoRestId = repo.body.id;
	const ref = await call("/repos/alice/proj/git/ref/heads/main");
	for (const branch of ["feature", "second"]) {
		await call(
			"/repos/alice/proj/git/refs",
			post(alice, { ref: `refs/heads/${branch}`, sha: ref.body.object.sha }),
		);
		await files.uploadFile({
			data: {
				repoId: repoRestId,
				branchName: branch,
				path: `${branch}.txt`,
				content: btoa(`${branch}\n`),
				commitMessage: branch,
			},
		});
	}
	for (const [head, title, draft] of [
		["feature", "First", false],
		["second", "Draft", true],
	] as const) {
		const created = await graphql(
			alice,
			`mutation($input: CreatePullRequestInput!) { createPullRequest(input: $input) { pullRequest { number } } }`,
			{
				input: {
					repositoryId: encodeNodeId("Repository", repoRestId),
					headRefName: head,
					baseRefName: "main",
					title,
					draft,
				},
			},
		);
		expect(created.body.errors).toBeUndefined();
	}
});

describe("pull request status fields", () => {
	it("reports the base ref, a draft's merge state and no branch protection", async () => {
		const { body } = await graphql(
			alice,
			`query { repository(owner:"alice",name:"proj") {
				a: pullRequest(number:1) { mergeStateStatus baseRef { name branchProtectionRule { requiresStrictStatusChecks } } }
				b: pullRequest(number:2) { mergeStateStatus isDraft }
			} }`,
		);
		expect(body.errors).toBeUndefined();
		expect(body.data.repository.a).toEqual({
			mergeStateStatus: "UNKNOWN",
			baseRef: { name: "main", branchProtectionRule: null },
		});
		expect(body.data.repository.b).toEqual({
			mergeStateStatus: "DRAFT",
			isDraft: true,
		});
	});

	it("has no review decision or latest reviews before anyone reviews", async () => {
		expect(await decisionOf(1)).toEqual({
			reviewDecision: null,
			latestReviews: { totalCount: 0, nodes: [] },
		});
	});

	it("takes each author's latest opinionated review, and changes requested beats approval", async () => {
		const bobId = users.bob.id;
		const carolId = users.carol.id;
		await review(1, bobId, "approved", 1);
		await review(1, carolId, "approved", 2);
		await review(1, bobId, "changes_requested", 3);
		const pr = await decisionOf(1);
		expect(pr.reviewDecision).toBe("CHANGES_REQUESTED");
		expect(pr.latestReviews.totalCount).toBe(2);
		expect(
			pr.latestReviews.nodes.map(
				(node: { author: { login: string }; state: string }) =>
					`${node.author.login}:${node.state}`,
			),
		).toEqual(["carol:APPROVED", "bob:CHANGES_REQUESTED"]);
	});

	it("is APPROVED when every author's latest opinionated review approves", async () => {
		await review(2, users.carol.id, "commented", 1);
		await review(2, users.bob.id, "approved", 2);
		const pr = await decisionOf(2);
		expect(pr.reviewDecision).toBe("APPROVED");
		expect(pr.latestReviews.totalCount).toBe(2);
	});

	it("keeps the decision through a later comment by the same author", async () => {
		// Approve, then comment (PR 2): still approved. Request changes, then comment (PR 1): still changes requested.
		await review(2, users.bob.id, "commented", 3);
		await review(1, users.bob.id, "commented", 4);
		const approved = await decisionOf(2);
		expect(approved.reviewDecision).toBe("APPROVED");
		expect(
			approved.latestReviews.nodes.map((n: { state: string }) => n.state),
		).toEqual(["COMMENTED", "COMMENTED"]);
		const changed = await decisionOf(1);
		expect(changed.reviewDecision).toBe("CHANGES_REQUESTED");
		expect(changed.latestReviews.totalCount).toBe(2);
	});

	it("serves no project items: an empty connection, not an error", async () => {
		const { body } = await graphql(
			alice,
			`query { repository(owner:"alice",name:"proj") { pullRequest(number:1) { projectItems(first:100) { totalCount nodes { id } pageInfo { hasNextPage endCursor } } } } }`,
		);
		expect(body.errors).toBeUndefined();
		expect(body.data.repository.pullRequest.projectItems).toEqual({
			totalCount: 0,
			nodes: [],
			pageInfo: { hasNextPage: false, endCursor: null },
		});
	});

	it("refuses a skip past MAX_LIST_SKIP, whatever the total", async () => {
		const past = encodeCursor(MAX_LIST_SKIP + 1);
		const reviews = await graphql(
			alice,
			`query($after: String) { repository(owner:"alice",name:"proj") { pullRequest(number:1) { latestReviews(first:1, after:$after) { nodes { state } } } } }`,
			{ after: past },
		);
		expect(reviews.body.errors?.[0]).toMatchObject({
			type: "UNPROCESSABLE",
			message: "Pagination offset exceeds the maximum",
		});
		const found = await graphql(
			alice,
			`query($after: String) { search(query:"repo:alice/proj", type:ISSUE, first:1, after:$after) { issueCount } }`,
			{ after: past },
		);
		expect(found.body.errors?.[0]).toMatchObject({
			type: "UNPROCESSABLE",
			message: "Pagination offset exceeds the maximum",
		});
	});

	it("pages latestReviews and bounds its skip", async () => {
		const { body } = await graphql(
			alice,
			`query { repository(owner:"alice",name:"proj") { pullRequest(number:1) { latestReviews(first:1) { nodes { state } pageInfo { hasNextPage } } } } }`,
		);
		expect(body.errors).toBeUndefined();
		expect(body.data.repository.pullRequest.latestReviews).toEqual({
			nodes: [{ state: "APPROVED" }],
			pageInfo: { hasNextPage: true },
		});
	});
});

describe("Query.search over issues and pull requests", () => {
	const search = (token: string, query: string, type = "ISSUE") =>
		graphql(
			token,
			`query($query: String!, $type: SearchType!) { search(query:$query, type:$type, first:10) { issueCount nodes { __typename ... on PullRequest { number } ... on Issue { number } } } }`,
			{ query, type },
		);

	it("finds the pull requests a repo-scoped query names, with gh's state and author qualifiers", async () => {
		const open = await search(
			alice,
			"repo:alice/proj state:open is:pr author:alice",
		);
		expect(open.body.errors).toBeUndefined();
		expect(open.body.data.search).toEqual({
			issueCount: 2,
			nodes: [
				{ __typename: "PullRequest", number: 2 },
				{ __typename: "PullRequest", number: 1 },
			],
		});
		const closed = await search(alice, "repo:alice/proj state:closed");
		expect(closed.body.data.search).toEqual({ issueCount: 0, nodes: [] });
	});

	it("answers none for a contradictory query, and for a repository the caller cannot read", async () => {
		const contradictory = await search(
			alice,
			"repo:alice/proj is:open is:closed",
		);
		expect(contradictory.body.errors).toBeUndefined();
		expect(contradictory.body.data.search.issueCount).toBe(0);

		await call("/user/repos", post(alice, { name: "secret", private: true }));
		const hidden = await search(bob, "repo:alice/secret");
		expect(hidden.body.errors).toBeUndefined();
		expect(hidden.body.data.search).toEqual({ issueCount: 0, nodes: [] });
	});

	it("returns issues as Issue nodes", async () => {
		const created = await call(
			"/repos/alice/proj/issues",
			post(alice, { title: "Broken" }),
		);
		expect(created.status).toBe(201);
		const { body } = await search(alice, "repo:alice/proj is:issue");
		expect(body.data.search).toEqual({
			issueCount: 1,
			nodes: [{ __typename: "Issue", number: created.body.number }],
		});
	});

	it.each([
		"in:title broken",
		"comments:>3 is:open",
		"created:>2020-01-01 is:open",
		"is:locked",
		"no:project",
		"-label:bug",
		"label: is:open",
		"sort:bogus",
		"draft:maybe",
		"is:public",
	])(
		"refuses the unserved qualifier in %j as UNPROCESSABLE",
		async (qualifier) => {
			const { body } = await search(alice, `repo:alice/proj ${qualifier}`);
			expect(body.data).toBeNull();
			expect(body.errors[0].type).toBe("UNPROCESSABLE");
			expect(body.errors[0].message).toMatch(/is not served$/);
		},
	);

	it("reads a quoted qualifier-looking phrase as text, and served qualifiers as served", async () => {
		const quoted = await search(alice, 'repo:alice/proj "in:title" is:pr');
		expect(quoted.body.errors).toBeUndefined();
		expect(quoted.body.data.search.issueCount).toBe(0);
	});

	it("refuses what it does not serve, with errors rather than empty results", async () => {
		// Without a repo: qualifier the search spans every readable repository.
		const everywhere = await search(alice, "is:pr author:alice");
		expect(everywhere.body.errors).toBeUndefined();
		const twoRepos = await search(alice, "repo:alice/proj repo:alice/x");
		expect(twoRepos.body.errors[0].type).toBe("UNPROCESSABLE");
		const userSearch = await search(alice, "repo:alice/proj", "USER");
		expect(userSearch.body.errors[0]).toMatchObject({
			type: "UNPROCESSABLE",
			message: "USER search is not served (ISSUE and REPOSITORY are)",
		});
		const long = await search(
			alice,
			`repo:alice/proj ${"x".repeat(MAX_SEARCH_QUERY_CHARS)}`,
		);
		expect(long.body.errors[0].type).toBe("UNPROCESSABLE");
	});
});

describe("merge state of a closed draft", () => {
	it("is UNKNOWN once the draft is closed: DRAFT is for an open draft only", async () => {
		expect(
			(
				await call(
					"/repos/alice/proj/pulls/2",
					patch(alice, { state: "closed" }),
				)
			).status,
		).toBe(200);
		const { body } = await graphql(
			alice,
			`query { repository(owner:"alice",name:"proj") { pullRequest(number:2) { state isDraft mergeStateStatus } } }`,
		);
		expect(body.errors).toBeUndefined();
		expect(body.data.repository.pullRequest).toEqual({
			state: "CLOSED",
			isDraft: true,
			mergeStateStatus: "UNKNOWN",
		});
	});
});
