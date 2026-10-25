/**
 * @vitest-environment node
 *
 * The Neon HTTP driver has no transactions, so multi-step writes undo
 * themselves on failure. Failures are injected by SQL text in the query
 * logger (it runs before the statement, so a throw fails that statement).
 * Covers: a comment, a pull request and a merge record that die midway leave
 * nothing half-made, and a retry works; a pull request holds a bounded number
 * of review comments.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

let failOn: RegExp | undefined;
let failCleanup: RegExp | undefined;

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb({
		onQuery: (query) => {
			if (failCleanup?.test(query)) throw new Error("cleanup failure");
			if (failOn?.test(query)) throw new Error("injected failure");
		},
	}),
}));
vi.mock("@tanstack/react-start", () => import("../../test/server-test-utils"));
vi.mock(
	"#/server/session",
	async () => (await import("../../test/app-harness")).sessionModule,
);
vi.mock("#/lib/limits", async (importOriginal) => ({
	...(await importOriginal<typeof import("#/lib/limits")>()),
	MAX_REVIEW_COMMENTS_PER_PULL_REQUEST: 2,
}));

const { createUsers, signIn } = await import("../../test/app-harness");
const repositories = await import("../repositories");
const files = await import("../files");
const pulls = await import("../pull-requests");
const issues = await import("../issues");
const comments = await import("../comments");
const reviews = await import("../reviews");

const { db } = await import("#/db");
const schema = await import("#/db/app-schema");
const perfLog = await import("../perf-log");
const { insertPullRequest } = await import("../pull-request-store");
const users = await createUsers("atom-owner", "atom-reader");

afterEach(async () => {
	failOn = undefined;
	failCleanup = undefined;
	vi.restoreAllMocks();
	// Deliberate cleanup failures leave malformed PRs; isolate later reads.
	await db
		.delete(schema.issues)
		.where(eq(schema.issues.title, "Cleanup failure"));
});
let repoId: number;
let branchSeq = 0;

async function branchWithChange() {
	branchSeq += 1;
	const branch = `topic-${branchSeq}`;
	await files.createBranch({ data: { repoId, name: branch } });
	await files.uploadFile({
		data: {
			repoId,
			branchName: branch,
			path: `n${branchSeq}.txt`,
			content: btoa("x\n"),
			commitMessage: `Add n${branchSeq}`,
		},
	});
	return branch;
}

const openPull = (branch: string) =>
	pulls.createPullRequest({
		data: {
			repoId,
			title: branch,
			sourceBranchName: branch,
			targetBranchName: "main",
		},
	});

const notificationWrites = /insert into "(notifications?|activit[a-z_]*)"/i;

beforeAll(async () => {
	signIn(users["atom-owner"]);
	repoId = (await repositories.createRepository({ data: { name: "atom" } })).id;
	await files.uploadFile({
		data: {
			repoId,
			branchName: "main",
			path: "a.txt",
			content: btoa("one\ntwo\nthree\n"),
			commitMessage: "Initial",
		},
	});
});

describe("multi-step writes undo themselves", () => {
	it.each([
		["pull request insert", /insert into "pull_requests"/i],
		["pull request follow-up", /insert into "activities"/i],
	])(
		"preserves the %s error and logs a failed cleanup",
		async (_stage, failure) => {
			const logged = vi.spyOn(perfLog, "logError").mockImplementation(() => {});
			failOn = failure;
			failCleanup = /delete from "issues"/i;
			await expect(
				insertPullRequest(repoId, users["atom-owner"].id, {
					title: "Cleanup failure",
					sourceBranch: "main",
					targetBranch: "main",
				}),
			).rejects.toThrow("injected failure");
			expect(logged).toHaveBeenCalledWith(
				"pull-request-store",
				expect.stringMatching(/Issue row \d+ was left behind/),
				expect.objectContaining({ message: "cleanup failure" }),
			);
		},
	);

	it("preserves an issue write error when deleting its row also fails", async () => {
		const logged = vi.spyOn(perfLog, "logError").mockImplementation(() => {});
		failOn = /insert into "activities"/i;
		failCleanup = /delete from "issues"/i;
		await expect(
			issues.createIssue({ data: { repoId, title: "Cleanup fails" } }),
		).rejects.toThrow("injected failure");
		expect(logged).toHaveBeenCalledWith(
			"issue-store",
			expect.stringMatching(/Issue \d+ was not removed/),
			expect.objectContaining({ message: "cleanup failure" }),
		);
	});

	it("preserves a comment write error when deleting its row also fails", async () => {
		const issue = await issues.createIssue({
			data: { repoId, title: "Comment cleanup fails" },
		});
		const logged = vi.spyOn(perfLog, "logError").mockImplementation(() => {});
		failOn = /insert into "activities"/i;
		failCleanup = /delete from "comments"/i;
		await expect(
			comments.createComment({ data: { issueId: issue.id, body: "hi" } }),
		).rejects.toThrow("injected failure");
		expect(logged).toHaveBeenCalledWith(
			"comment-store",
			expect.stringMatching(/Comment \d+ was not removed/),
			expect.objectContaining({ message: "cleanup failure" }),
		);
	});

	it("removes a failed comment's cross-reference without notifying a mentioned reader", async () => {
		const target = await issues.createIssue({
			data: { repoId, title: "Reference target" },
		});
		const source = await issues.createIssue({
			data: { repoId, title: "Reference source" },
		});
		const body = `See #${target.number} @atom-reader`;
		failOn = /insert into "activities"/i;
		await expect(
			comments.createComment({ data: { issueId: source.id, body } }),
		).rejects.toThrow("injected failure");
		failOn = undefined;
		const refs = () =>
			db
				.select()
				.from(schema.timelineEvents)
				.where(eq(schema.timelineEvents.issueId, target.id));
		const notices = () =>
			db
				.select()
				.from(schema.notifications)
				.where(eq(schema.notifications.issueId, source.id));
		expect(await refs()).toHaveLength(0);
		expect(await notices()).toHaveLength(0);
		await comments.createComment({ data: { issueId: source.id, body } });
		expect(await refs()).toHaveLength(1);
		expect(await notices()).toHaveLength(1);
	});

	it("a comment whose follow-up writes fail is removed, and a retry posts one", async () => {
		const issue = await issues.createIssue({
			data: { repoId, title: "Commented" },
		});
		const count = async () =>
			(await comments.getComments({ data: { issueId: issue.id } })).length;
		failOn = notificationWrites;
		await expect(
			comments.createComment({ data: { issueId: issue.id, body: "hi" } }),
		).rejects.toThrow("injected failure");
		failOn = undefined;
		expect(await count()).toBe(0);
		await comments.createComment({ data: { issueId: issue.id, body: "hi" } });
		expect(await count()).toBe(1);
	});

	it("a pull request whose follow-up writes fail is removed, and a retry opens one", async () => {
		const branch = await branchWithChange();
		const open = async () =>
			(
				await pulls.getPullRequests({
					data: { repoId, limit: 100, skip: 0, query: "is:all" },
				})
			).length;
		const before = await open();
		failOn = notificationWrites;
		await expect(openPull(branch)).rejects.toThrow("injected failure");
		failOn = undefined;
		expect(await open()).toBe(before);
		await openPull(branch);
		expect(await open()).toBe(before + 1);
	});

	it("a merge whose record fails reopens the pull request, and a retry merges", async () => {
		const branch = await branchWithChange();
		const pr = await openPull(branch);
		failOn = /update "pull_requests"/i;
		await expect(
			pulls.mergePullRequest({ data: { prId: pr.id } }),
		).rejects.toThrow("injected failure");
		failOn = undefined;
		const after = await pulls.getPullRequestByNumber({
			data: { owner: "atom-owner", name: "atom", number: pr.number },
		});
		expect(after.status).toBe("open");
		expect(after.mergedAt).toBeNull();
		await pulls.mergePullRequest({ data: { prId: pr.id } });
		const merged = await pulls.getPullRequestByNumber({
			data: { owner: "atom-owner", name: "atom", number: pr.number },
		});
		expect(merged.mergedAt).not.toBeNull();
	});
});

describe("review comment bound", () => {
	it("refuses a comment past the per-pull-request cap", async () => {
		const branch = await branchWithChange();
		const pr = await openPull(branch);
		const post = (body: string) =>
			reviews.createReviewComment({
				data: { prId: pr.id, body, path: `n${branchSeq}.txt`, line: 1 },
			});
		await post("one");
		await post("two");
		await expect(post("three")).rejects.toThrow(/at most 2 review comments/);
	});
});
