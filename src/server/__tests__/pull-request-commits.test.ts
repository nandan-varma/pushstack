/**
 * @vitest-environment node
 *
 * A pull request's Commits tab: the commits on the head branch that aren't on
 * the base, whether or not the base has moved on, and the recorded range after
 * a merge.
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

const users = await createUsers("owner");
let repoId: number;

const commit = (branchName: string, path: string, message: string) =>
	files.uploadFile({
		data: {
			repoId,
			branchName,
			path,
			content: btoa(`${message}\n`),
			commitMessage: message,
		},
	});

const open = (source: string) =>
	pulls.createPullRequest({
		data: {
			repoId,
			title: source,
			sourceBranchName: source,
			targetBranchName: "main",
		},
	});

const messages = async (prId: number) =>
	(await pulls.getPullRequestCommits({ data: { prId } })).commits.map((c) =>
		c.message.trim(),
	);

beforeAll(async () => {
	signIn(users.owner);
	repoId = (await repositories.createRepository({ data: { name: "t" } })).id;
	await commit("main", "a.txt", "Initial");
});

describe("getPullRequestCommits", () => {
	it("lists exactly the head's commits, newest first, even after the base moves", async () => {
		await files.createBranch({ data: { repoId, name: "feature" } });
		await commit("feature", "f1.txt", "First");
		await commit("feature", "f2.txt", "Second");
		const pr = await open("feature");
		expect(await messages(pr.id)).toEqual(["Second", "First"]);

		await commit("main", "m.txt", "On main");
		expect(await messages(pr.id)).toEqual(["Second", "First"]);
		expect(
			await pulls.getPullRequestCommits({ data: { prId: pr.id } }),
		).toEqual(expect.objectContaining({ truncated: false, note: null }));
	});

	it("keeps the merged range after a merge commit", async () => {
		const [pr] = await pulls.getPullRequests({
			data: { repoId, status: "open" },
		});
		if (!pr) throw new Error("expected the open pull request");
		await pulls.mergePullRequest({ data: { prId: pr.id } });
		expect(await messages(pr.id)).toEqual(["Second", "First"]);
	});

	it("explains a fast-forward merge, whose range isn't recorded", async () => {
		await files.createBranch({ data: { repoId, name: "ff" } });
		await commit("ff", "ff.txt", "Only");
		const pr = await open("ff");
		await pulls.mergePullRequest({ data: { prId: pr.id } });
		const result = await pulls.getPullRequestCommits({ data: { prId: pr.id } });
		expect(result.commits).toEqual([]);
		expect(result.note).toMatch(/fast-forward/);
	});

	it("is not readable without access to a private repository", async () => {
		await repositories.updateRepository({
			data: { id: repoId, visibility: "private" },
		});
		const [pr] = await pulls.getPullRequests({
			data: { repoId, status: "all" },
		});
		signOut();
		await expect(
			pulls.getPullRequestCommits({ data: { prId: pr?.id ?? 0 } }),
		).rejects.toBeDefined();
	});
});
