/**
 * @vitest-environment node
 *
 * Reactions: per-user toggles on issues, pull requests and comments, GitHub's
 * `reactions` rollup with `total_count`, and who may react.
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
const issues = await import("../issues");
const pulls = await import("../pull-requests");
const comments = await import("../comments");
const { getThreadReactions, toggleReaction } = await import("../reactions");

const users = await createUsers("owner", "reader", "stranger");
let repoId: number;
let privateRepoId: number;
let issueNumber: number;
let issueId: number;
let commentId: number;
let prNumber: number;

beforeAll(async () => {
	signIn(users.owner);
	repoId = (await repositories.createRepository({ data: { name: "r" } })).id;
	privateRepoId = (
		await repositories.createRepository({
			data: { name: "p", visibility: "private" },
		})
	).id;
	await files.uploadFile({
		data: {
			repoId,
			branchName: "main",
			path: "a.txt",
			content: btoa("a\n"),
			commitMessage: "Initial",
		},
	});
	await files.createBranch({
		data: { repoId, name: "feature", fromBranch: "main" },
	});
	await files.uploadFile({
		data: {
			repoId,
			branchName: "feature",
			path: "b.txt",
			content: btoa("b\n"),
			commitMessage: "Feature",
		},
	});
	const issue = await issues.createIssue({
		data: { repoId, title: "Bug", body: "" },
	});
	issueNumber = issue.number;
	issueId = issue.id;
	commentId = (
		await comments.createComment({ data: { issueId, body: "first" } })
	).id;
	prNumber = (
		await pulls.createPullRequest({
			data: {
				repoId,
				title: "Feature",
				sourceBranchName: "feature",
				targetBranchName: "main",
			},
		})
	).number;
});

const react = (
	data: Partial<Parameters<typeof toggleReaction>[0]["data"]> & {
		content: Parameters<typeof toggleReaction>[0]["data"]["content"];
	},
) => toggleReaction({ data: { repoId, number: issueNumber, ...data } });

describe("reactions", () => {
	it("toggles one reaction per user and content, with GitHub's rollup", async () => {
		signIn(users.owner);
		expect(await react({ content: "+1" })).toEqual({ reacted: true });
		expect(await react({ content: "heart" })).toEqual({ reacted: true });
		signIn(users.reader);
		expect(await react({ content: "+1" })).toEqual({ reacted: true });
		// `reacted: true` is idempotent, like GitHub's create.
		expect(await react({ content: "+1", reacted: true })).toEqual({
			reacted: true,
		});

		const { issue } = await getThreadReactions({
			data: { repoId, number: issueNumber },
		});
		expect(issue.reactions).toEqual({
			total_count: 3,
			"+1": 2,
			"-1": 0,
			laugh: 0,
			hooray: 0,
			confused: 0,
			heart: 1,
			rocket: 0,
			eyes: 0,
		});
		expect(issue.viewerReactions).toEqual(["+1"]);

		expect(await react({ content: "+1" })).toEqual({ reacted: false });
		expect(await react({ content: "+1", reacted: false })).toEqual({
			reacted: false,
		});
		const after = await getThreadReactions({
			data: { repoId, number: issueNumber },
		});
		expect(after.issue.reactions["+1"]).toBe(1);
		expect(after.issue.reactions.total_count).toBe(2);
		expect(after.issue.viewerReactions).toEqual([]);
	});

	it("keeps comment reactions apart from the thread's", async () => {
		signIn(users.reader);
		await react({ commentId, content: "rocket" });
		const thread = await getThreadReactions({
			data: { repoId, number: issueNumber },
		});
		expect(thread.comments[commentId]?.reactions).toMatchObject({
			total_count: 1,
			rocket: 1,
		});
		expect(thread.comments[commentId]?.viewerReactions).toEqual(["rocket"]);
		expect(thread.issue.reactions.rocket).toBe(0);
	});

	it("reacts to pull requests", async () => {
		signIn(users.reader);
		await toggleReaction({
			data: { repoId, number: prNumber, content: "hooray" },
		});
		const { issue } = await getThreadReactions({
			data: { repoId, number: prNumber },
		});
		expect(issue.reactions.hooray).toBe(1);
	});

	it("rejects a comment from another thread and unknown contents", async () => {
		signIn(users.reader);
		await expect(
			toggleReaction({
				data: { repoId, number: prNumber, commentId, content: "eyes" },
			}),
		).rejects.toBeTruthy();
		await expect(
			toggleReaction({
				data: {
					repoId,
					number: issueNumber,
					// @ts-expect-error not one of GitHub's contents
					content: "thumbsup",
				},
			}),
		).rejects.toThrow();
	});

	it("shows rollups anonymously but needs a signed-in reader to react", async () => {
		signOut();
		const { issue } = await getThreadReactions({
			data: { repoId, number: issueNumber },
		});
		expect(issue.reactions.total_count).toBeGreaterThan(0);
		expect(issue.viewerReactions).toEqual([]);
		await expect(react({ content: "eyes" })).rejects.toThrow();

		signIn(users.stranger);
		await expect(
			toggleReaction({
				data: { repoId: privateRepoId, number: 1, content: "eyes" },
			}),
		).rejects.toThrow();
		await expect(
			getThreadReactions({ data: { repoId: privateRepoId, number: 1 } }),
		).rejects.toBeTruthy();
	});

	it("drops a comment's reactions with the comment", async () => {
		signIn(users.owner);
		const extra = await comments.createComment({
			data: { issueId, body: "temp" },
		});
		await react({ commentId: extra.id, content: "laugh" });
		await comments.deleteComment({ data: { commentId: extra.id } });
		const thread = await getThreadReactions({
			data: { repoId, number: issueNumber },
		});
		expect(thread.comments[extra.id]).toBeUndefined();
	});
});
