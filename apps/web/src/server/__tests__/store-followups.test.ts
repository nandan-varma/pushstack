/**
 * @vitest-environment node
 *
 * A write whose row is committed keeps its outcome when a follow-up (a timeline
 * event, a notice, a linked issue's close, a restore of another latest release)
 * fails: the request succeeds, the failure is logged, and a retry is not
 * refused or duplicated. Failures are injected by SQL text in the query logger
 * (it runs before the statement, so a throw fails that statement). Compare
 * store-atomicity.test.ts, where the write itself is rolled back.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

let failOn: RegExp | undefined;

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb({
		onQuery: (query) => {
			if (failOn?.test(query)) throw new Error("injected failure");
		},
	}),
}));
vi.mock("@tanstack/react-start", () => import("../../test/server-test-utils"));
vi.mock(
	"#/server/session",
	async () => (await import("../../test/app-harness")).sessionModule,
);

const { createUsers, signIn } = await import("../../test/app-harness");
const repositories = await import("../repositories");
const files = await import("../files");
const pulls = await import("../pull-requests");
const issues = await import("../issues");
const labels = await import("../labels");
const releases = await import("../releases");
const reviews = await import("../reviews");
const perfLog = await import("../perf-log");
const { db } = await import("#/db");
const schema = await import("#/db/app-schema");

const users = await createUsers("follow-owner", "follow-reader");

afterEach(() => {
	failOn = undefined;
	vi.restoreAllMocks();
	signIn(users["follow-owner"]);
});

let repoId: number;
let branchSeq = 0;

async function branchWithChange() {
	branchSeq += 1;
	const branch = `follow-${branchSeq}`;
	await files.createBranch({ data: { repoId, name: branch } });
	await files.uploadFile({
		data: {
			repoId,
			branchName: branch,
			path: `f${branchSeq}.txt`,
			content: btoa("x\n"),
			commitMessage: `Add f${branchSeq}`,
		},
	});
	return branch;
}

const openPull = async (branch: string) =>
	pulls.createPullRequest({
		data: {
			repoId,
			title: branch,
			sourceBranchName: branch,
			targetBranchName: "main",
		},
	});

beforeAll(async () => {
	signIn(users["follow-owner"]);
	repoId = (
		await repositories.createRepository({ data: { name: "followups" } })
	).id;
	await files.uploadFile({
		data: {
			repoId,
			branchName: "main",
			path: "a.txt",
			content: btoa("one\n"),
			commitMessage: "Initial",
		},
	});
});

describe("a committed write survives a failed follow-up", () => {
	it("a review is submitted when its timeline event fails", async () => {
		const pr = await openPull(await branchWithChange());
		const logged = vi.spyOn(perfLog, "logError").mockImplementation(() => {});
		signIn(users["follow-reader"]);
		failOn = /insert into "timeline_events"/i;
		const submitted = await reviews.submitReview({
			data: { prId: pr.id, event: "comment", body: "Looks fine" },
		});
		failOn = undefined;
		expect(submitted.state).toBe("commented");
		const row = await db.query.pullRequestReviews.findFirst({
			where: { id: submitted.id },
		});
		expect(row?.state).toBe("commented");
		expect(logged).toHaveBeenCalledWith(
			"review-store",
			expect.stringMatching(
				/The review event on #\d+ failed after the write committed/,
			),
			expect.objectContaining({ message: "injected failure" }),
		);
	});

	it("a merge is recorded when its merged event fails", async () => {
		const pr = await openPull(await branchWithChange());
		const logged = vi.spyOn(perfLog, "logError").mockImplementation(() => {});
		failOn = /insert into "timeline_events"/i;
		const merged = await pulls.mergePullRequest({ data: { prId: pr.id } });
		failOn = undefined;
		expect(merged.commitSha).toMatch(/^[0-9a-f]{40}$/);
		const after = await pulls.getPullRequestByNumber({
			data: { owner: "follow-owner", name: "followups", number: pr.number },
		});
		expect(after.mergedAt).not.toBeNull();
		expect(logged).toHaveBeenCalledWith(
			"pull-request-store",
			expect.stringMatching(/The merged event of #\d+ failed/),
			expect.anything(),
		);
	});

	it("an issue edit is kept when its status event fails, and a retry is not refused", async () => {
		const issue = await issues.createIssue({
			data: { repoId, title: "Follow-up close" },
		});
		const logged = vi.spyOn(perfLog, "logError").mockImplementation(() => {});
		failOn = /insert into "timeline_events"/i;
		await issues.updateIssue({
			data: { issueId: issue.id, status: "closed" },
		});
		failOn = undefined;
		const after = await db.query.issues.findFirst({
			where: { id: issue.id },
		});
		expect(after?.status).toBe("closed");
		expect(logged).toHaveBeenCalledWith(
			"issue-store",
			expect.stringMatching(/The status event of #\d+ failed/),
			expect.anything(),
		);
		// The same edit again is a no-op, not an error.
		await issues.updateIssue({
			data: { issueId: issue.id, status: "closed" },
		});
	});

	it("label changes are kept when their events fail", async () => {
		const issue = await issues.createIssue({
			data: { repoId, title: "Labelled" },
		});
		await labels.createLabel({
			data: { repoId, name: "followup", color: "ffffff" },
		});
		const logged = vi.spyOn(perfLog, "logError").mockImplementation(() => {});
		failOn = /insert into "timeline_events"/i;
		await labels.setLabels({
			data: { repoId, number: issue.number, labels: ["followup"] },
		});
		failOn = undefined;
		const applied = await db
			.select()
			.from(schema.threadLabels)
			.where(eq(schema.threadLabels.issueId, issue.id));
		expect(applied).toHaveLength(1);
		expect(logged).toHaveBeenCalledWith(
			"label-store",
			expect.stringMatching(/The labeled event of label followup failed/),
			expect.anything(),
		);
	});
});

describe("one latest release at a time", () => {
	const latestTags = async () =>
		(
			await db
				.select({ tag: schema.releases.tagName })
				.from(schema.releases)
				.where(eq(schema.releases.makeLatest, "true"))
		).map((row) => row.tag);

	const release = (tagName: string) => ({
		repoId,
		tagName,
		targetCommitish: "main",
		name: tagName,
		body: "",
		draft: false,
		prerelease: false,
		makeLatest: true,
	});

	it("a failed demotion creates nothing and keeps the previous latest", async () => {
		await releases.createReleaseFn({ data: release("v1") });
		expect(await latestTags()).toEqual(["v1"]);
		failOn = /update "releases" set "make_latest"/i;
		await expect(
			releases.createReleaseFn({ data: release("v2") }),
		).rejects.toThrow("injected failure");
		failOn = undefined;
		expect(await latestTags()).toEqual(["v1"]);
		await releases.createReleaseFn({ data: release("v2") });
		expect(await latestTags()).toEqual(["v2"]);
	});

	it("a failed insert restores the latest it had cleared", async () => {
		failOn = /insert into "releases"/i;
		await expect(
			releases.createReleaseFn({ data: release("v3") }),
		).rejects.toThrow("injected failure");
		failOn = undefined;
		expect(await latestTags()).toEqual(["v2"]);
		await releases.createReleaseFn({ data: release("v3") });
		expect(await latestTags()).toEqual(["v3"]);
	});

	it("a failed update restores the latest it had cleared", async () => {
		const v1 = await db.query.releases.findFirst({
			where: { tagName: "v1" },
		});
		expect(v1).toBeTruthy();
		failOn = /update "releases" set .*"updated_at"/i;
		await expect(
			releases.updateReleaseFn({
				data: { ...release("v1"), repoId, releaseId: v1?.id ?? 0 },
			}),
		).rejects.toThrow("injected failure");
		failOn = undefined;
		expect(await latestTags()).toEqual(["v3"]);
	});
});
