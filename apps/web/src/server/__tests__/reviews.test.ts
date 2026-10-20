/**
 * @vitest-environment node
 *
 * Pull request reviews: line comments in a private pending review, threaded
 * replies, resolve/unresolve, the three submit states, permissions, the
 * `reviewed` timeline events, and the diff anchor validation.
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
const files = await import("../files");
const pulls = await import("../pull-requests");
const reviews = await import("../reviews");
const timeline = await import("../timeline");

const users = await createUsers("owner", "writer", "writer2", "reader");
let repoId: number;
let prSeq = 0;

/** A fresh branch off main that modifies a.txt and adds fN.txt, and its PR. */
async function makePr(): Promise<{ id: number; number: number }> {
	signIn(users.owner);
	prSeq += 1;
	const branch = `feature-${prSeq}`;
	await files.createBranch({ data: { repoId, name: branch } });
	await files.uploadFile({
		data: {
			repoId,
			branchName: branch,
			path: `f${prSeq}.txt`,
			content: btoa("hello\n"),
			commitMessage: `Add f${prSeq}`,
		},
	});
	await files.uploadFile({
		data: {
			repoId,
			branchName: branch,
			path: "a.txt",
			content: btoa(`one\nTWO${prSeq}\nthree\n`),
			commitMessage: `Change a on ${branch}`,
		},
	});
	return pulls.createPullRequest({
		data: {
			repoId,
			title: branch,
			sourceBranchName: branch,
			targetBranchName: "main",
		},
	});
}

beforeAll(async () => {
	signIn(users.owner);
	repoId = (await repositories.createRepository({ data: { name: "t" } })).id;
	await files.uploadFile({
		data: {
			repoId,
			branchName: "main",
			path: "a.txt",
			content: btoa("one\ntwo\nthree\n"),
			commitMessage: "Initial",
		},
	});
	await repositories.addCollaboratorByUsername({
		data: { repoId, username: "writer", role: "write" },
	});
	await repositories.addCollaboratorByUsername({
		data: { repoId, username: "writer2", role: "write" },
	});
});

describe("review comments and pending reviews", () => {
	it("anchors a line comment to the diff and hides the pending review", async () => {
		const pr = await makePr();
		signIn(users.reader);

		// Outside the diff: a path the PR never touched, a line past the hunk,
		// and the left side of a file the PR only added.
		await expect(
			reviews.createReviewComment({
				data: { prId: pr.id, body: "x", path: "nope.txt", line: 1 },
			}),
		).rejects.toThrow(/isn't part of this pull request's diff/);
		await expect(
			reviews.createReviewComment({
				data: { prId: pr.id, body: "x", path: "a.txt", line: 99 },
			}),
		).rejects.toThrow(/isn't part of this pull request's diff/);
		await expect(
			reviews.createReviewComment({
				data: {
					prId: pr.id,
					body: "x",
					path: `f${prSeq}.txt`,
					line: 1,
					side: "LEFT",
				},
			}),
		).rejects.toThrow(/isn't part of this pull request's diff/);

		const comment = await reviews.createReviewComment({
			data: {
				prId: pr.id,
				body: "Please fix",
				path: "a.txt",
				line: 2,
				side: "RIGHT",
			},
		});
		expect(comment).toMatchObject({ path: "a.txt", line: 2, side: "RIGHT" });

		const pending = await reviews.getMyPendingReview({ data: { prId: pr.id } });
		expect(pending?.state).toBe("pending");
		expect(pending?.comments.map((row) => row.body)).toEqual(["Please fix"]);

		// The owner can read the pull request but not the reader's draft.
		signIn(users.owner);
		expect(
			await reviews.getPullRequestReviewThreads({ data: { prId: pr.id } }),
		).toEqual([]);
	});

	it("rejects anonymous callers", async () => {
		const pr = await makePr();
		signOut();
		await expect(
			reviews.createReviewComment({
				data: { prId: pr.id, body: "x", path: "a.txt", line: 2 },
			}),
		).rejects.toThrow();
		await expect(
			reviews.getMyPendingReview({ data: { prId: pr.id } }),
		).rejects.toThrow();
	});

	it("discards a pending review and its comments", async () => {
		const pr = await makePr();
		signIn(users.reader);
		await reviews.createReviewComment({
			data: { prId: pr.id, body: "temp", path: "a.txt", line: 2 },
		});
		await reviews.discardPendingReview({ data: { prId: pr.id } });
		expect(
			await reviews.getMyPendingReview({ data: { prId: pr.id } }),
		).toBeNull();
		signIn(users.owner);
		expect(
			await reviews.getPullRequestReviewThreads({ data: { prId: pr.id } }),
		).toEqual([]);
	});
});

describe("submitting and threading", () => {
	it("threads replies and resolves / unresolves the conversation", async () => {
		const pr = await makePr();
		signIn(users.reader);
		const root = await reviews.createReviewComment({
			data: { prId: pr.id, body: "Root", path: "a.txt", line: 2 },
		});
		await reviews.submitReview({
			data: { prId: pr.id, event: "comment", body: "A review" },
		});

		// A reply inherits the parent's review, so it's public immediately.
		signIn(users.owner);
		await reviews.createReviewComment({
			data: { prId: pr.id, body: "Reply", inReplyToId: root.id },
		});
		let threads = await reviews.getPullRequestReviewThreads({
			data: { prId: pr.id },
		});
		expect(threads).toHaveLength(1);
		expect(threads[0]?.comments.map((row) => row.body)).toEqual([
			"Root",
			"Reply",
		]);
		expect(threads[0]?.resolved).toBe(false);

		await reviews.resolveReviewThread({
			data: { commentId: root.id, resolved: true },
		});
		threads = await reviews.getPullRequestReviewThreads({
			data: { prId: pr.id },
		});
		expect(threads[0]?.resolved).toBe(true);

		await reviews.resolveReviewThread({
			data: { commentId: root.id, resolved: false },
		});
		threads = await reviews.getPullRequestReviewThreads({
			data: { prId: pr.id },
		});
		expect(threads[0]?.resolved).toBe(false);
	});

	it("submits all three states and records a reviewed event for each", async () => {
		const pr = await makePr();

		// A signed-in reader may submit a comment review but not approve.
		signIn(users.reader);
		await reviews.submitReview({ data: { prId: pr.id, event: "comment" } });
		await expect(
			reviews.submitReview({ data: { prId: pr.id, event: "approve" } }),
		).rejects.toThrow(/write access/);

		// The author may not review their own pull request.
		signIn(users.owner);
		await expect(
			reviews.submitReview({ data: { prId: pr.id, event: "approve" } }),
		).rejects.toThrow(/your own pull request/);

		signIn(users.writer);
		await reviews.submitReview({ data: { prId: pr.id, event: "approve" } });
		signIn(users.writer2);
		await reviews.submitReview({
			data: { prId: pr.id, event: "request_changes" },
		});

		const prDetail = await pulls.getPullRequestByNumber({
			data: { owner: "owner", name: "t", number: pr.number },
		});
		expect(prDetail.review.summary).toMatchObject({
			approved: 1,
			changesRequested: 1,
			commented: 1,
			state: "changes_requested",
			blocksMerge: true,
		});

		const events = await timeline.getTimeline({
			data: { repoId, number: pr.number },
		});
		expect(
			events
				.filter((event) => event.event === "reviewed")
				.map((event) => (event as { state: string }).state),
		).toEqual(["commented", "approved", "changes_requested"]);
	});

	it("blocks a non-admin merge while changes are requested, and lets an admin override", async () => {
		const pr = await makePr();
		signIn(users.writer2);
		await reviews.submitReview({
			data: { prId: pr.id, event: "request_changes" },
		});

		signIn(users.writer);
		await expect(
			pulls.mergePullRequest({ data: { prId: pr.id } }),
		).rejects.toThrow(/Changes were requested/);

		signIn(users.owner);
		await pulls.mergePullRequest({ data: { prId: pr.id } });
	});

	it("rejects a reply to a comment on another pull request", async () => {
		const first = await makePr();
		const second = await makePr();
		signIn(users.reader);
		const root = await reviews.createReviewComment({
			data: { prId: first.id, body: "Root", path: "a.txt", line: 2 },
		});
		await expect(
			reviews.createReviewComment({
				data: { prId: second.id, body: "Wrong PR", inReplyToId: root.id },
			}),
		).rejects.toThrow(/isn't on this pull request/);
	});

	it("rejects a reply to another user's unsubmitted draft", async () => {
		const pr = await makePr();
		signIn(users.reader);
		const root = await reviews.createReviewComment({
			data: { prId: pr.id, body: "Draft", path: "a.txt", line: 2 },
		});
		signIn(users.writer);
		await expect(
			reviews.createReviewComment({
				data: { prId: pr.id, body: "Sneaky", inReplyToId: root.id },
			}),
		).rejects.toThrow(/isn't on this pull request/);
	});
});
