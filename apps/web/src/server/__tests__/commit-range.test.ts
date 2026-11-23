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
// Exercise the same shallow boundary as a long-lived repository with a small fixture.
vi.mock("git-fs-s3/ops", async (importOriginal) => ({
	...(await importOriginal<typeof import("git-fs-s3/ops")>()),
	HISTORY_WALK_DEPTH: 5,
}));

const { createUsers, signIn } = await import("../../test/app-harness");
const { createRepository } = await import("../repositories");
const { uploadFile, createBranch } = await import("../files");
const { getCommitLog, getCommitInfosBetween } = await import("../git-read");
const { createPullRequest, mergePullRequest } = await import(
	"../pull-requests"
);
const users = await createUsers("owner");
let repoId: number;
let baseTip: string;
const history: string[] = [];

async function commit(branchName: string, message: string) {
	await uploadFile({
		data: {
			repoId,
			branchName,
			path: `${message}.txt`,
			content: btoa(message),
			commitMessage: message,
		},
	});
	return (await getCommitLog("owner", "ranges", branchName, 1))[0].oid;
}

beforeAll(async () => {
	signIn(users.owner);
	repoId = (await createRepository({ data: { name: "ranges" } })).id;
	for (let i = 0; i < 9; i++) history.push(await commit("main", `Commit ${i}`));
	await createBranch({ data: { repoId, name: "feature" } });
	baseTip = await commit("main", "Base change");
	await commit("feature", "First change");
	await commit("feature", "Second change");
});

const range = (base: string, head: string, limit = 50) =>
	getCommitInfosBetween("owner", "ranges", base, head, limit);
const messages = (result: Awaited<ReturnType<typeof range>>) =>
	result.commits.map(({ commit }) => commit.message.trim());

describe("bounded commit ranges", () => {
	it("counts parent and child exactly after history exceeds the walk depth", async () => {
		const ahead = await range(history[7], history[8]);
		expect(messages(ahead)).toEqual(["Commit 8"]);
		expect(ahead).toMatchObject({ truncated: false, incomplete: false });
		const behind = await range(history[8], history[7]);
		expect(messages(behind)).toEqual([]);
		expect(behind).toMatchObject({ truncated: false, incomplete: false });
	});

	it("stops at shared ancestors after branches diverge", async () => {
		const ahead = await range("main", "feature");
		expect(messages(ahead)).toEqual(["First change", "Second change"]);
		expect(ahead).toMatchObject({ truncated: false, incomplete: false });
		const behind = await range("feature", "main");
		expect(messages(behind)).toEqual(["Base change"]);
		expect(behind).toMatchObject({ truncated: false, incomplete: false });
	});

	it("limits the oldest exclusive commits without counting shared history", async () => {
		const result = await range("main", "feature", 1);
		expect(messages(result)).toEqual(["First change"]);
		expect(result).toMatchObject({ truncated: true, incomplete: false });
	});

	it("reports an incomplete range when the common history is outside the budget", async () => {
		const result = await range(history[0], history[8]);
		expect(messages(result)).toEqual([
			"Commit 4",
			"Commit 5",
			"Commit 6",
			"Commit 7",
			"Commit 8",
		]);
		expect(result).toMatchObject({ truncated: false, incomplete: true });
	});

	it("follows both merge parents and excludes every shared path", async () => {
		const pr = await createPullRequest({
			data: {
				repoId,
				title: "Merge feature",
				sourceBranchName: "feature",
				targetBranchName: "main",
			},
		});
		await mergePullRequest({ data: { prId: pr.id } });
		const result = await range(baseTip, "main");
		expect(messages(result)).toEqual([
			"First change",
			"Second change",
			`Merge pull request #${pr.number} from owner/feature\n\nMerge feature`,
		]);
		expect(result).toMatchObject({ truncated: false, incomplete: false });
	});
});
