/**
 * Tests for the safeRepoPathSchema traversal guard on file server functions.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockUser } from "@/test/mock-routes";
import { setupServerFnMock } from "@/test/server-test-utils";

setupServerFnMock();

vi.mock("../session", () => ({
	getCurrentUser: vi.fn(() => Promise.resolve(mockUser)),
	getCurrentUserOptional: vi.fn(() => Promise.resolve(mockUser)),
}));

const mockRepo = {
	id: 1,
	ownerId: "user123",
	name: "test-repo",
	defaultBranch: "main",
	owner: { id: "user123", username: "testuser", email: "test@example.com" },
};

vi.mock("../repo-access", () => ({
	getRepoOrThrow: vi.fn(() => Promise.resolve(mockRepo)),
	requireReadAccess: vi.fn(() => Promise.resolve()),
	requireWriteAccess: vi.fn(() => Promise.resolve()),
	getRepoWithReadAccess: vi.fn(() => Promise.resolve(mockRepo)),
	getRepoWithWriteAccess: vi.fn(() => Promise.resolve(mockRepo)),
}));

vi.mock("../git-storage-naming", () => ({
	getRepoStorageCoordinates: vi.fn(() => ({ ownerKey: "user123" })),
}));

const gitOpsMocks = {
	createCommit: vi.fn((): Promise<string> => Promise.resolve("commit-sha")),
	getFileFromBranch: vi.fn(() =>
		Promise.resolve({ content: "hi", size: 2, isBinary: false }),
	),
	getTreeFromBranch: vi.fn((): Promise<unknown[]> => Promise.resolve([])),
	deleteFile: vi.fn(() => Promise.resolve({ sha: "sha", message: "msg" })),
	getBranches: vi.fn((): Promise<unknown[]> => Promise.resolve([])),
	createBranch: vi.fn(() => Promise.resolve()),
	deleteBranch: vi.fn(() => Promise.resolve()),
	getCommitHistory: vi.fn((): Promise<unknown[]> => Promise.resolve([])),
	getCommit: vi.fn((): Promise<unknown> => Promise.resolve({})),
};

vi.mock("../git-commit-write", () => ({
	createCommit: gitOpsMocks.createCommit,
	deleteFile: gitOpsMocks.deleteFile,
}));
vi.mock("../git-branch-ops", () => ({
	getBranches: gitOpsMocks.getBranches,
	createBranch: gitOpsMocks.createBranch,
	deleteBranch: gitOpsMocks.deleteBranch,
}));
vi.mock("../git-history-ops", () => ({
	getFileFromBranch: gitOpsMocks.getFileFromBranch,
	getTreeFromBranch: gitOpsMocks.getTreeFromBranch,
	getCommitHistory: gitOpsMocks.getCommitHistory,
	getCommit: gitOpsMocks.getCommit,
}));
vi.mock("../git-diff-iso", () => ({
	getCommitDiff: vi.fn(),
	getBranchDiff: vi.fn(),
}));

vi.mock("../../db", () => ({
	db: {
		update: vi.fn(() => ({
			set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })),
		})),
		insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve()) })),
	},
}));

const traversalPaths = ["../../../etc/passwd", "/etc/passwd", ".git/config"];

describe("file path traversal guard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("uploadFile", () => {
		it.each(traversalPaths)("rejects path %s", async (path) => {
			const { uploadFile } = await import("../files");
			await expect(
				uploadFile({
					data: {
						repoId: 1,
						branchName: "main",
						path,
						content: "aGVsbG8=",
						commitMessage: "msg",
					},
				}),
			).rejects.toThrow();
			expect(gitOpsMocks.createCommit).not.toHaveBeenCalled();
		});

		it("accepts a normal relative path", async () => {
			const { uploadFile } = await import("../files");
			await uploadFile({
				data: {
					repoId: 1,
					branchName: "main",
					path: "src/index.ts",
					content: "aGVsbG8=",
					commitMessage: "msg",
				},
			});
			expect(gitOpsMocks.createCommit).toHaveBeenCalled();
		});
	});

	describe("getFile", () => {
		it.each(traversalPaths)("rejects path %s", async (path) => {
			const { getFile } = await import("../files");
			await expect(
				getFile({ data: { repoId: 1, branchName: "main", path } }),
			).rejects.toThrow();
			expect(gitOpsMocks.getFileFromBranch).not.toHaveBeenCalled();
		});

		it("accepts a normal relative path", async () => {
			const { getFile } = await import("../files");
			await getFile({
				data: { repoId: 1, branchName: "main", path: "src/index.ts" },
			});
			expect(gitOpsMocks.getFileFromBranch).toHaveBeenCalled();
		});
	});

	describe("listFiles", () => {
		it.each(traversalPaths)("rejects path %s", async (path) => {
			const { listFiles } = await import("../files");
			await expect(
				listFiles({ data: { repoId: 1, branchName: "main", path } }),
			).rejects.toThrow();
			expect(gitOpsMocks.getTreeFromBranch).not.toHaveBeenCalled();
		});

		it("accepts the default empty string for the repo root", async () => {
			const { listFiles } = await import("../files");
			await listFiles({ data: { repoId: 1, branchName: "main" } });
			expect(gitOpsMocks.getTreeFromBranch).toHaveBeenCalledWith(
				"user123",
				"test-repo",
				"main",
				"",
			);
		});
	});

	describe("deleteFile", () => {
		it.each(traversalPaths)("rejects path %s", async (path) => {
			const { deleteFile } = await import("../files");
			await expect(
				deleteFile({
					data: { repoId: 1, branchName: "main", path, commitMessage: "msg" },
				}),
			).rejects.toThrow();
			expect(gitOpsMocks.deleteFile).not.toHaveBeenCalled();
		});

		it("accepts a normal relative path", async () => {
			const { deleteFile } = await import("../files");
			await deleteFile({
				data: {
					repoId: 1,
					branchName: "main",
					path: "src/index.ts",
					commitMessage: "msg",
				},
			});
			expect(gitOpsMocks.deleteFile).toHaveBeenCalled();
		});
	});

	describe("branch name traversal guard", () => {
		const traversalBranchNames = [
			"../../other-owner/other-repo/git/refs/heads/main",
			"refs/heads/../../other-owner/other-repo/git/refs/heads/main",
			"refs/heads/main",
			"..",
			"HEAD",
		];

		beforeEach(() => {
			vi.clearAllMocks();
		});

		it.each(
			traversalBranchNames,
		)("uploadFile rejects branch name %s", async (branchName) => {
			const { uploadFile } = await import("../files");
			await expect(
				uploadFile({
					data: {
						repoId: 1,
						branchName,
						path: "src/index.ts",
						content: "aGVsbG8=",
						commitMessage: "msg",
					},
				}),
			).rejects.toThrow();
			expect(gitOpsMocks.createCommit).not.toHaveBeenCalled();
		});

		it.each(
			traversalBranchNames,
		)("getFile rejects branch name %s", async (branchName) => {
			const { getFile } = await import("../files");
			await expect(
				getFile({ data: { repoId: 1, branchName, path: "src/index.ts" } }),
			).rejects.toThrow();
			expect(gitOpsMocks.getFileFromBranch).not.toHaveBeenCalled();
		});

		it.each(
			traversalBranchNames,
		)("createBranch rejects name %s", async (name) => {
			const { createBranch } = await import("../files");
			await expect(
				createBranch({ data: { repoId: 1, name } }),
			).rejects.toThrow();
			expect(gitOpsMocks.createBranch).not.toHaveBeenCalled();
		});

		it.each(
			traversalBranchNames,
		)("createBranch rejects fromBranch %s", async (fromBranch) => {
			const { createBranch } = await import("../files");
			await expect(
				createBranch({ data: { repoId: 1, name: "feature", fromBranch } }),
			).rejects.toThrow();
			expect(gitOpsMocks.createBranch).not.toHaveBeenCalled();
		});

		it.each(
			traversalBranchNames,
		)("deleteBranch rejects name %s", async (name) => {
			const { deleteBranch } = await import("../files");
			await expect(
				deleteBranch({ data: { repoId: 1, name } }),
			).rejects.toThrow();
			expect(gitOpsMocks.deleteBranch).not.toHaveBeenCalled();
		});
	});

	describe("deleteBranch", () => {
		beforeEach(() => {
			vi.clearAllMocks();
		});

		it("rejects deleting the default branch", async () => {
			const { deleteBranch } = await import("../files");
			await expect(
				deleteBranch({ data: { repoId: 1, name: "main" } }),
			).rejects.toThrow("Cannot delete default branch");
			expect(gitOpsMocks.deleteBranch).not.toHaveBeenCalled();
		});

		it("allows deleting a non-default branch", async () => {
			const { deleteBranch } = await import("../files");
			await deleteBranch({ data: { repoId: 1, name: "feature" } });
			expect(gitOpsMocks.deleteBranch).toHaveBeenCalled();
		});

		it("rejects when caller lacks write access", async () => {
			const { getRepoWithWriteAccess } = await import("../repo-access");
			(
				getRepoWithWriteAccess as ReturnType<typeof vi.fn>
			).mockRejectedValueOnce(new Error("No write access"));

			const { deleteBranch } = await import("../files");
			await expect(
				deleteBranch({ data: { repoId: 1, name: "feature" } }),
			).rejects.toThrow("No write access");
		});
	});

	describe("createBranch", () => {
		beforeEach(() => {
			vi.clearAllMocks();
		});

		it("rejects when caller lacks write access", async () => {
			const { getRepoWithWriteAccess } = await import("../repo-access");
			(
				getRepoWithWriteAccess as ReturnType<typeof vi.fn>
			).mockRejectedValueOnce(new Error("No write access"));

			const { createBranch } = await import("../files");
			await expect(
				createBranch({ data: { repoId: 1, name: "feature" } }),
			).rejects.toThrow("No write access");
			expect(gitOpsMocks.createBranch).not.toHaveBeenCalled();
		});

		it("creates branch and returns success", async () => {
			const { createBranch } = await import("../files");
			const result = await createBranch({
				data: { repoId: 1, name: "feature", fromBranch: "develop" },
			});

			expect(result.success).toBe(true);
			expect(result.name).toBe("feature");
			expect(gitOpsMocks.createBranch).toHaveBeenCalledWith(
				"user123",
				"test-repo",
				"feature",
				"develop",
				"user123",
			);
		});
	});

	describe("getBranches", () => {
		beforeEach(() => {
			vi.clearAllMocks();
		});

		it("returns branches from git", async () => {
			gitOpsMocks.getBranches.mockResolvedValueOnce(["main", "dev"]);
			const { getBranches } = await import("../files");
			const result = await getBranches({ data: { repoId: 1 } });

			expect(result).toEqual(["main", "dev"]);
			expect(gitOpsMocks.getBranches).toHaveBeenCalledWith(
				"user123",
				"test-repo",
			);
		});
	});

	describe("getCommits", () => {
		beforeEach(() => {
			vi.clearAllMocks();
		});

		it("returns formatted commit data", async () => {
			gitOpsMocks.getCommitHistory.mockResolvedValueOnce([
				{
					oid: "abc123",
					commit: {
						message: "test commit",
						tree: "tree1",
						parent: [],
						author: {
							name: "Alice",
							email: "alice@test.com",
							timestamp: 1700000000,
							timezoneOffset: 0,
						},
						committer: {
							name: "Alice",
							email: "alice@test.com",
							timestamp: 1700000000,
							timezoneOffset: 0,
						},
					},
					payload: "",
				},
			]);

			const { getCommits } = await import("../files");
			const result = await getCommits({
				data: { repoId: 1, branchName: "main" },
			});

			expect(result).toHaveLength(1);
			expect(result[0].sha).toBe("abc123");
			expect(result[0].message).toBe("test commit");
			expect(result[0].authorName).toBe("Alice");
			expect(result[0].author.email).toBe("alice@test.com");
		});
	});

	describe("getCommit", () => {
		beforeEach(() => {
			vi.clearAllMocks();
		});

		it("returns formatted commit details", async () => {
			const sha = "a".repeat(40);
			gitOpsMocks.getCommit.mockResolvedValueOnce({
				oid: sha,
				commit: {
					message: "fix bug",
					tree: "tree1",
					parent: ["parent1"],
					author: {
						name: "Bob",
						email: "bob@test.com",
						timestamp: 1700000000,
						timezoneOffset: 0,
					},
					committer: {
						name: "Bob",
						email: "bob@test.com",
						timestamp: 1700000000,
						timezoneOffset: 0,
					},
				},
				payload: "tree tree1\nparent parent1\n",
			});

			const { getCommit } = await import("../files");
			const result = await getCommit({
				data: { repoId: 1, commitSha: sha },
			});

			expect(result.sha).toBe(sha);
			expect(result.message).toBe("fix bug");
			expect(result.branch).toBe("main");
			expect(result.parent).toEqual(["parent1"]);
			expect(result.author.name).toBe("Bob");
			expect(result.committer.name).toBe("Bob");
		});
	});
});
