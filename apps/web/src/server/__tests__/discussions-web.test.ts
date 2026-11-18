/**
 * @vitest-environment node
 *
 * The discussion server functions behind the web pages: list with categories,
 * create, comment and reply, answer, upvote, and what a signed-out reader sees.
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

const { createUsers, signIn, signOut } = await import("../../test/app-harness");
const repositories = await import("../repositories");
const discussions = await import("../discussions");
const { listDiscussionCategories } = await import("../discussion-store");

const users = await createUsers("owner", "reader");
let repoId: number;
let qaId: number;

beforeAll(async () => {
	signIn(users.owner);
	repoId = (await repositories.createRepository({ data: { name: "forum" } }))
		.id;
	const categories = await listDiscussionCategories(repoId);
	qaId = categories.find((row) => row.format === "q_and_a")?.id ?? 0;
});

describe("discussion pages", () => {
	it("lists categories and an empty forum", async () => {
		const page = await discussions.getDiscussions({ data: { repoId } });
		expect(page.categories.map((row) => row.slug)).toEqual([
			"general",
			"ideas",
			"q-a",
			"announcements",
			"show-and-tell",
		]);
		expect(page.discussions).toEqual([]);
		expect(page.viewer.canParticipate).toBe(true);
	});

	it("creates, comments, replies and marks the answer", async () => {
		const created = await discussions.createDiscussion({
			data: { repoId, categoryId: qaId, title: "How?", body: "Help" },
		});
		expect(created.number).toBe(1);

		const detail = await discussions.getDiscussionByNumber({
			data: { owner: users.owner.username, name: "forum", number: 1 },
		});
		expect(detail.discussion).toMatchObject({
			title: "How?",
			isAnswered: false,
			category: { slug: "q-a" },
		});

		const top = await discussions.commentOnDiscussion({
			data: { discussionId: detail.discussion.id, body: "An answer" },
		});
		const reply = await discussions.commentOnDiscussion({
			data: {
				discussionId: detail.discussion.id,
				body: "A reply",
				replyToId: top.id,
			},
		});
		const page = await discussions.getDiscussionComments({
			data: { discussionId: detail.discussion.id, skip: 0 },
		});
		expect(page).toHaveLength(1);
		expect(page[0]?.replies.map((item) => item.id)).toEqual([reply.id]);

		await discussions.markDiscussionAnswer({
			data: { commentId: reply.id, answered: true },
		});
		const answered = await discussions.getDiscussionByNumber({
			data: { owner: users.owner.username, name: "forum", number: 1 },
		});
		expect(answered.discussion).toMatchObject({
			isAnswered: true,
			answerCommentId: reply.id,
		});

		await discussions.toggleDiscussionUpvote({
			data: { discussionId: detail.discussion.id, upvoted: true },
		});
		const upvoted = await discussions.getDiscussions({ data: { repoId } });
		expect(upvoted.discussions[0]).toMatchObject({
			upvoteCount: 1,
			viewerHasUpvoted: true,
			isAnswered: true,
		});
	});

	it("lets a signed-out visitor read but not post", async () => {
		signOut();
		const page = await discussions.getDiscussions({ data: { repoId } });
		expect(page.viewer.canParticipate).toBe(false);
		expect(page.discussions).toHaveLength(1);
		await expect(
			discussions.createDiscussion({
				data: { repoId, categoryId: qaId, title: "No", body: "" },
			}),
		).rejects.toThrow();
		signIn(users.owner);
	});

	it("refuses a reply to a reply", async () => {
		const detail = await discussions.getDiscussionByNumber({
			data: { owner: users.owner.username, name: "forum", number: 1 },
		});
		const page = await discussions.getDiscussionComments({
			data: { discussionId: detail.discussion.id, skip: 0 },
		});
		const reply = page[0]?.replies[0];
		if (!reply) throw new Error("missing reply");
		await expect(
			discussions.commentOnDiscussion({
				data: {
					discussionId: detail.discussion.id,
					body: "too deep",
					replyToId: reply.id,
				},
			}),
		).rejects.toThrow(/top-level/);
	});
});
