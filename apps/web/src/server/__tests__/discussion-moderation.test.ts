/**
 * @vitest-environment node
 *
 * Discussion moderation: lock and pin by write collaborators, and converting
 * an issue into a discussion and back on the same `#N`, with its comments and
 * timeline events.
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
const { issues, pullRequests, repositories } = await import("#/db/app-schema");
const { eq } = await import("drizzle-orm");
const { createCommentForUser } = await import("../comment-store");
const { createDiscussionForUser, findDiscussion } = await import(
	"../discussion-store"
);
const { createIssueForUser } = await import("../issue-store");
const discussionsApi = await import("../discussions");
const issuesApi = await import("../issues");
const { findThread } = await import("../thread-store");
const { listTimeline } = await import("../timeline-store");
const { claimNextIssueOrPrNumber } = await import("../repository-lookup");

const users = await createUsers("alice", "reader");
let token: string;
let repoId: number;
let quietRepoId: number;

async function createDiscussion(title: string, categoryId: number) {
	const issue = await createDiscussionForUser(repoId, users.alice.id, {
		title,
		categoryId,
	});
	const discussion = await findDiscussion(repoId, issue.number, users.alice.id);
	if (!discussion) throw new Error("discussion missing after insert");
	return discussion;
}

beforeAll(async () => {
	token = await mintToken(users.alice, ["repo:write"]);
	signIn(users.alice);
	const repos = await import("../repositories");
	repoId = (await repos.createRepository({ data: { name: "forum" } })).id;
	quietRepoId = (await repos.createRepository({ data: { name: "quiet" } })).id;
	await db
		.update(repositories)
		.set({ hasDiscussions: false })
		.where(eq(repositories.id, quietRepoId));
});

describe("locking", () => {
	it("refuses new comments and replies, but not upvotes", async () => {
		const categories = await discussionsApi.getDiscussionCategories({
			data: { repoId },
		});
		const categoryId = categories[0]?.id ?? 0;
		const discussion = await createDiscussion("Locked topic", categoryId);
		await discussionsApi.lockDiscussion({
			data: { discussionId: discussion.issue.id, locked: true },
		});

		const locked = await findDiscussion(
			repoId,
			discussion.issue.number,
			users.alice.id,
		);
		expect(locked?.locked).toBe(true);

		await expect(
			discussionsApi.commentOnDiscussion({
				data: { discussionId: discussion.issue.id, body: "too late" },
			}),
		).rejects.toThrow(/locked/);

		const { body } = await graphql(
			token,
			`query ($owner: String!, $name: String!, $number: Int!) {
				repository(owner: $owner, name: $name) {
					discussion(number: $number) { locked }
				}
			}`,
			{ owner: "alice", name: "forum", number: discussion.issue.number },
		);
		expect(body.errors).toBeUndefined();
		expect(body.data.repository.discussion.locked).toBe(true);

		await discussionsApi.toggleDiscussionUpvote({
			data: { discussionId: discussion.issue.id, upvoted: true },
		});
		const upvoted = await findDiscussion(
			repoId,
			discussion.issue.number,
			users.alice.id,
		);
		expect(upvoted?.upvoteCount).toBe(1);
	});

	it("keeps a reader from locking or unlocking", async () => {
		const categories = await discussionsApi.getDiscussionCategories({
			data: { repoId },
		});
		const discussion = await createDiscussion(
			"Reader cannot lock",
			categories[0]?.id ?? 0,
		);
		signIn(users.reader);
		await expect(
			discussionsApi.lockDiscussion({
				data: { discussionId: discussion.issue.id, locked: true },
			}),
		).rejects.toThrow(/write access/);
		signIn(users.alice);
	});
});

describe("pinning", () => {
	it("leads the category and Repository.discussions", async () => {
		const categories = await discussionsApi.getDiscussionCategories({
			data: { repoId },
		});
		const general = categories.find((row) => row.slug === "general");
		if (!general) throw new Error("general category missing");
		const older = await createDiscussion("Pin me", general.id);
		await createDiscussion("Newer", general.id);

		await discussionsApi.pinDiscussion({
			data: { discussionId: older.issue.id, pinned: true },
		});
		const page = await discussionsApi.getDiscussions({
			data: { repoId, category: general.slug },
		});
		expect(page.discussions[0]?.id).toBe(older.issue.id);
		expect(page.discussions[0]?.pinnedAt).not.toBeNull();

		const { body } = await graphql(
			token,
			`query ($owner: String!, $name: String!) {
				repository(owner: $owner, name: $name) {
					discussionCategories(first: 15) {
						nodes { id slug }
					}
				}
			}`,
			{ owner: "alice", name: "forum" },
		);
		const categoryNode = body.data.repository.discussionCategories.nodes.find(
			(node: { slug: string }) => node.slug === general.slug,
		);
		const listed = await graphql(
			token,
			`query ($owner: String!, $name: String!, $categoryId: ID!) {
				repository(owner: $owner, name: $name) {
					discussions(first: 5, categoryId: $categoryId) {
						nodes { number }
					}
				}
			}`,
			{ owner: "alice", name: "forum", categoryId: categoryNode.id },
		);
		expect(listed.body.data.repository.discussions.nodes[0].number).toBe(
			older.issue.number,
		);

		await discussionsApi.pinDiscussion({
			data: { discussionId: older.issue.id, pinned: false },
		});
		const unpinned = await findDiscussion(
			repoId,
			older.issue.number,
			users.alice.id,
		);
		expect(unpinned?.pinnedAt).toBeNull();
		expect(body.errors).toBeUndefined();
	});
});

describe("converting", () => {
	it("turns an issue into a discussion on the same #N and back", async () => {
		const issue = await createIssueForUser(repoId, users.alice.id, {
			title: "Convert me",
			body: "Same thread",
			labels: [],
		});
		const thread = await findThread(repoId, issue.number, "issue");
		if (!thread) throw new Error("issue thread missing");
		await createCommentForUser(thread, users.alice.id, "A comment");
		const categories = await discussionsApi.getDiscussionCategories({
			data: { repoId },
		});
		const categoryId = categories[0]?.id ?? 0;

		await issuesApi.convertIssueToDiscussion({
			data: { issueId: issue.id, categoryId },
		});

		const discussion = await findDiscussion(
			repoId,
			issue.number,
			users.alice.id,
		);
		expect(discussion?.issue.number).toBe(issue.number);
		expect(discussion?.commentsCount).toBe(1);
		const converted = await discussionsApi.getDiscussionComments({
			data: { discussionId: issue.id, skip: 0 },
		});
		expect(converted.map((comment) => comment.body)).toEqual(["A comment"]);
		expect(
			(await listTimeline(issue.id)).map((entry) => entry.event),
		).toContain("converted_to_discussion");

		await discussionsApi.convertDiscussionToIssue({
			data: { discussionId: issue.id },
		});
		expect(
			await findDiscussion(repoId, issue.number, users.alice.id),
		).toBeNull();
		expect((await findThread(repoId, issue.number, "issue"))?.id).toBe(
			issue.id,
		);
		expect((await listTimeline(issue.id)).map((entry) => entry.event)).toEqual(
			expect.arrayContaining(["converted_to_discussion", "converted_to_issue"]),
		);
	});

	it("refuses a pull request and a repository without discussions", async () => {
		const [pull] = await db
			.insert(issues)
			.values({
				repoId,
				number: await claimNextIssueOrPrNumber(repoId),
				kind: "pull_request",
				authorId: users.alice.id,
				title: "A pull request",
			})
			.returning();
		if (!pull) throw new Error("pull insert returned no row");
		await db.insert(pullRequests).values({
			issueId: pull.id,
			sourceBranch: "feature",
			targetBranch: "main",
		});
		const categories = await discussionsApi.getDiscussionCategories({
			data: { repoId },
		});
		await expect(
			issuesApi.convertIssueToDiscussion({
				data: { issueId: pull.id, categoryId: categories[0]?.id ?? 0 },
			}),
		).rejects.toBeDefined();

		const quietIssue = await createIssueForUser(quietRepoId, users.alice.id, {
			title: "Quiet",
			labels: [],
		});
		await expect(
			issuesApi.convertIssueToDiscussion({
				data: { issueId: quietIssue.id, categoryId: categories[0]?.id ?? 0 },
			}),
		).rejects.toThrow(/disabled/);
	});
});
