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

const open = (source: string, target = "main") =>
	pulls.createPullRequest({
		data: {
			repoId,
			title: `${source} into ${target}`,
			sourceBranchName: source,
			targetBranchName: target,
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
	it("lists exactly the head's commits, oldest first, even after the base moves", async () => {
		await files.createBranch({ data: { repoId, name: "feature" } });
		await commit("feature", "f1.txt", "First");
		await commit("feature", "f2.txt", "Second");
		const pr = await open("feature");
		expect(await messages(pr.id)).toEqual(["First", "Second"]);

		await commit("main", "m.txt", "On main");
		expect(await messages(pr.id)).toEqual(["First", "Second"]);
		expect(
			await pulls.getPullRequestCommits({ data: { prId: pr.id } }),
		).toEqual(expect.objectContaining({ truncated: false, incomplete: false }));
	});

	it("keeps the merged range after a three-way merge, whatever happens to the branches", async () => {
		const [pr] = await pulls.getPullRequests({
			data: { repoId, status: "open" },
		});
		if (!pr) throw new Error("expected the open pull request");
		await pulls.mergePullRequest({ data: { prId: pr.id } });
		await commit("feature", "f3.txt", "Pushed after the merge");
		await commit("main", "m2.txt", "More on main");
		expect(await messages(pr.id)).toEqual(["First", "Second"]);
	});

	it("keeps a fast-forward merged range", async () => {
		await files.createBranch({ data: { repoId, name: "ff" } });
		await commit("ff", "ff.txt", "Only");
		const pr = await open("ff");
		await pulls.mergePullRequest({ data: { prId: pr.id } });
		expect(await messages(pr.id)).toEqual(["Only"]);
	});

	it("is exact when the head tip is itself a merge commit", async () => {
		await files.createBranch({ data: { repoId, name: "side" } });
		await commit("side", "s.txt", "Side work");
		await commit("main", "m3.txt", "Main moves on");
		// Merge main into side: side's tip becomes a merge commit.
		const sync = await open("main", "side");
		await pulls.mergePullRequest({ data: { prId: sync.id } });

		const pr = await open("side");
		expect(await messages(pr.id)).toEqual([
			"Side work",
			`Merge pull request #${sync.number}: main into side`,
		]);
		await pulls.mergePullRequest({ data: { prId: pr.id } });
		await commit("main", "m4.txt", "After");
		expect(await messages(pr.id)).toEqual([
			"Side work",
			`Merge pull request #${sync.number}: main into side`,
		]);
	});

	it("is empty, not an error, once an open pull request's head branch is gone", async () => {
		await files.createBranch({ data: { repoId, name: "gone" } });
		await commit("gone", "g.txt", "Soon deleted");
		const pr = await open("gone");
		await files.deleteBranch({ data: { repoId, name: "gone" } });
		expect(await messages(pr.id)).toEqual([]);
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
