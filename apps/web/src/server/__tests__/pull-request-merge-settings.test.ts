/**
 * @vitest-environment node
 *
 * The web UI's merge honours the repository's merge settings, as REST and
 * GraphQL do: a merge commit is refused while `allow_merge_commit` is off.
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
const repositories = await import("../repositories");
const files = await import("../files");
const pulls = await import("../pull-requests");
const { findRepositoryByName } = await import("../repository-lookup");
const { updateRepositorySettings } = await import("../repository-settings");

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

beforeAll(async () => {
	signIn(users.owner);
	repoId = (await repositories.createRepository({ data: { name: "merge-ui" } }))
		.id;
	await commit("main", "a.txt", "Initial");
});

describe("the web UI merge honours merge settings", () => {
	it("refuses a merge commit while allow_merge_commit is off, and merges once allowed", async () => {
		await files.createBranch({ data: { repoId, name: "topic" } });
		await commit("topic", "t.txt", "Topic work");
		await commit("main", "m.txt", "Main moves on");
		const pr = await pulls.createPullRequest({
			data: {
				repoId,
				title: "Topic",
				sourceBranchName: "topic",
				targetBranchName: "main",
			},
		});

		const repo = await findRepositoryByName("owner", "merge-ui");
		if (!repo) throw new Error("fixture missing");
		await updateRepositorySettings(repo, { allowMergeCommit: false });

		await expect(
			pulls.mergePullRequest({ data: { prId: pr.id } }),
		).rejects.toThrow("Merge commits are not allowed on this repository.");
		const { findPullRequestByNumber } = await import("../thread-store");
		expect(await findPullRequestByNumber(repoId, pr.number)).toMatchObject({
			status: "open",
		});

		await updateRepositorySettings(repo, { allowMergeCommit: true });
		const merged = await pulls.mergePullRequest({ data: { prId: pr.id } });
		expect(merged.commitSha).toMatch(/^[0-9a-f]{40}$/);
	});
});
