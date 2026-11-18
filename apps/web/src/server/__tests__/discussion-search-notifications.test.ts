/**
 * @vitest-environment node
 *
 * Discussion search and notifications: `is:discussion` narrows a search to
 * discussions, a DISCUSSION GraphQL search answers `discussionCount`, a
 * repository the caller cannot read matches nothing, and the inbox names a
 * discussion thread with its `/discussions/{n}` link.
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
const { mintToken } = await import("../../test/api-client");
const { graphql } = await import("../../test/graphql-client");
const { db } = await import("#/db");
const { issues, pullRequests } = await import("#/db/app-schema");
const { parseSearchQuery } = await import("#/lib/search-query");
const { createCommentForUser } = await import("../comment-store");
const { createDiscussionForUser, findDiscussion } = await import(
	"../discussion-store"
);
const { createIssueForUser } = await import("../issue-store");
const { markThreadViewed, getNotifications } = await import("../notifications");
const { claimNextIssueOrPrNumber } = await import("../repository-lookup");

const users = await createUsers("alice", "bob");
let alice: string;
let repoId: number;
let secretRepoId: number;
let totalId: number;

const SEARCH = `query($query: String!, $type: SearchType!) {
  search(query: $query, type: $type, first: 10) {
    discussionCount
    nodes { __typename ... on Discussion { number } ... on Issue { number } ... on PullRequest { number } }
  }
}`;

async function insertPullRequest(repo: number, title: string) {
	const [pull] = await db
		.insert(issues)
		.values({
			repoId: repo,
			number: await claimNextIssueOrPrNumber(repo),
			kind: "pull_request",
			authorId: users.alice.id,
			title,
		})
		.returning();
	if (!pull) throw new Error("pull insert returned no row");
	await db.insert(pullRequests).values({
		issueId: pull.id,
		sourceBranch: "feature",
		targetBranch: "main",
	});
	return pull;
}

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	signIn(users.alice);
	const repos = await import("../repositories");
	const repo = await repos.createRepository({
		data: { name: "forum", visibility: "public" },
	});
	repoId = repo.id;
	const categories = await (await import("../discussion-store"))
		.listDiscussionCategories;
	const categoryId = (await categories(repoId))[0]?.id ?? 0;
	const discussion = await createDiscussionForUser(repoId, users.alice.id, {
		title: "Auth alpha",
		body: "same words",
		categoryId,
	});
	totalId = discussion.id;
	await createIssueForUser(repoId, users.alice.id, {
		title: "Auth alpha",
		labels: [],
	});
	await insertPullRequest(repoId, "Auth alpha");

	signIn(users.bob);
	secretRepoId = (
		await repos.createRepository({
			data: { name: "secret", visibility: "private" },
		})
	).id;
	const bobCategories = await categories(secretRepoId);
	await createDiscussionForUser(secretRepoId, users.bob.id, {
		title: "Auth alpha",
		categoryId: bobCategories[0]?.id ?? 0,
	});
	signIn(users.alice);
});

describe("is:discussion", () => {
	it("sets the type and contradicts another kind", () => {
		expect(parseSearchQuery("is:discussion").type).toBe("discussion");
		expect(parseSearchQuery("type:discussion").type).toBe("discussion");
		expect(parseSearchQuery("is:discussion is:pr").matchesNothing).toBe(true);
		expect(parseSearchQuery("is:discussion is:issue").matchesNothing).toBe(
			true,
		);
	});

	it("returns only discussions from a DISCUSSION search", async () => {
		const { body } = await graphql(alice, SEARCH, {
			query: "repo:alice/forum is:open auth",
			type: "DISCUSSION",
		});
		expect(body.errors).toBeUndefined();
		expect(body.data.search.discussionCount).toBe(1);
		expect(
			body.data.search.nodes.map(
				(node: { __typename: string }) => node.__typename,
			),
		).toEqual(["Discussion"]);
	});

	it("matches nothing when the query names another kind", async () => {
		const { body } = await graphql(alice, SEARCH, {
			query: "repo:alice/forum is:discussion is:pr",
			type: "DISCUSSION",
		});
		expect(body.errors).toBeUndefined();
		expect(body.data.search.discussionCount).toBe(0);
		expect(body.data.search.nodes).toEqual([]);
	});

	it("matches nothing in a private repository the caller cannot read", async () => {
		const { body } = await graphql(alice, SEARCH, {
			query: "repo:bob/secret is:open auth",
			type: "DISCUSSION",
		});
		expect(body.errors).toBeUndefined();
		expect(body.data.search.discussionCount).toBe(0);
		expect(body.data.search.nodes).toEqual([]);
	});
});

describe("discussion notifications", () => {
	it("notifies subscribers with a discussion subject that reading marks read", async () => {
		const discussion = await findDiscussion(repoId, 1, users.alice.id);
		if (!discussion) throw new Error("discussion missing");
		signIn(users.bob);
		await createCommentForUser(
			{ ...discussion.issue, kind: "discussion" },
			users.bob.id,
			"A comment",
		);
		signIn(users.alice);

		const inbox = await getNotifications({
			data: { all: false, participating: false, page: 1, per_page: 50 },
		});
		const notification = inbox.find((item) => item.issueId === totalId);
		expect(notification).toMatchObject({
			reason: "author",
			unread: true,
			subject: { type: "Discussion", number: 1, title: "Auth alpha" },
		});

		expect(
			await markThreadViewed({
				data: { repoId, number: discussion.issue.number },
			}),
		).toBe(true);
		const after = await getNotifications({
			data: { all: false, participating: false, page: 1, per_page: 50 },
		});
		expect(after.some((item) => item.issueId === totalId)).toBe(false);
	});
});
