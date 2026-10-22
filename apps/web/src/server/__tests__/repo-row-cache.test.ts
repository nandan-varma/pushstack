/**
 * @vitest-environment node
 *
 * A repository page fans out to several server functions for the same repo.
 * Each starts from the repository row; after the first, the rest must reuse
 * it rather than each querying `repositories` again — and a settings change
 * must still be visible to the very next read.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

const queries = vi.hoisted(() => ({ repositoryReads: 0 }));

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb({
		onQuery: (query: string) => {
			if (/^select .* from "repositories"/.test(query)) {
				queries.repositoryReads++;
			}
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
const issues = await import("../issues");
const pulls = await import("../pull-requests");
const { evictRepositoryById, invalidateRepositoryAccess } = await import(
	"../repo-access"
);

const users = await createUsers("owner");
let repoId: number;

beforeAll(async () => {
	signIn(users.owner);
	repoId = (await repositories.createRepository({ data: { name: "r" } })).id;
	await files.uploadFile({
		data: {
			repoId,
			branchName: "main",
			path: "a.txt",
			content: btoa("a\n"),
			commitMessage: "Initial",
		},
	});
});

describe("repository row per page fan-out", () => {
	it("is read once for a page's parallel server functions", async () => {
		// A cold page: nothing cached for this repository yet.
		evictRepositoryById(repoId);
		invalidateRepositoryAccess(repoId);
		const before = queries.repositoryReads;
		await Promise.all([
			files.getTreePageData({
				data: { repoId, branchName: "main", path: "" },
			}),
			files.getBranches({ data: { repoId } }),
			issues.getIssueNumbers({ data: { repoId } }),
			pulls.getPullRequestNumbers({ data: { repoId } }),
		]);
		// One for the access decision, one for the row with its owner.
		expect(queries.repositoryReads - before).toBe(2);
	});

	it("sees a settings change on the next read", async () => {
		await files.getBranches({ data: { repoId } });
		await repositories.updateRepository({
			data: { id: repoId, description: "changed" },
		});
		await files.createBranch({ data: { repoId, name: "dev" } });
		await repositories.updateRepository({
			data: { id: repoId, defaultBranch: "dev" },
		});
		const page = await files.getTreePageData({
			data: { repoId, branchName: "dev", path: "" },
		});
		expect(page).toBeTruthy();
		const repo = await repositories.getRepositoryByName({
			data: { owner: "owner", name: "r" },
		});
		expect(repo.defaultBranch).toBe("dev");
		expect(repo.description).toBe("changed");
	});

	it("reads a renamed repository's storage under its new name at once", async () => {
		// Warm the by-id row, then rename: a read that kept the cached row would
		// look for the moved storage under the old name and 404.
		await files.getTreePageData({
			data: { repoId, branchName: "main", path: "" },
		});
		await repositories.updateRepository({
			data: { id: repoId, name: "renamed" },
		});
		const page = await files.getTreePageData({
			data: { repoId, branchName: "main", path: "" },
		});
		expect(page.branches.map((branch) => branch.name)).toContain("main");
		expect(JSON.stringify(page.files)).toContain("a.txt");
	});
});
