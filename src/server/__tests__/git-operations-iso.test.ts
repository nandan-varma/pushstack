/**
 * Unit tests for git-operations-iso.ts
 * Tests commit, branch, and file operations
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies
const mockFs = vi.hoisted(() => ({
	mkdirSync: vi.fn(),
	writeFileSync: vi.fn(),
	rmSync: vi.fn(),
	readFileSync: vi.fn(),
}));

const mockGit = vi.hoisted(() => ({
	default: {
		add: vi.fn(),
		commit: vi.fn(),
		listBranches: vi.fn(),
		currentBranch: vi.fn(),
		resolveRef: vi.fn(),
		branch: vi.fn(),
		deleteBranch: vi.fn(),
		readBlob: vi.fn(),
		readCommit: vi.fn(),
		readTree: vi.fn(),
		log: vi.fn(),
		setConfig: vi.fn(),
		remove: vi.fn(),
	},
}));

const mockRepoStorage = vi.hoisted(() => ({
	ensureRepositoryHydrated: vi.fn(),
	syncRepositoryToR2: vi.fn(),
	withRepositoryWorktree: vi.fn(async (_ownerKey, _repoName, _branchName, fn) =>
		fn({ worktreePath: "/tmp/worktree", gitdir: "/tmp/gitdir" }),
	),
}));

vi.mock("node:fs", () => ({
	default: mockFs,
}));
vi.mock("isomorphic-git", () => mockGit);
vi.mock("../git-manager-iso", () => ({
	getBareRepoOptions: vi.fn(() => ({
		fs: mockFs,
		gitdir: "/tmp/gitdir",
	})),
	getDefaultAuthor: vi.fn(() => ({
		name: "Test User",
		email: "test@example.com",
		timestamp: Math.floor(Date.now() / 1000),
		timezoneOffset: 0,
	})),
}));
vi.mock("../git-repo-storage", () => mockRepoStorage);

const mockCache = vi.hoisted(() => ({
	getCache: vi.fn(() => null),
	setCache: vi.fn(),
}));
vi.mock("../git-cache", () => mockCache);

// @ts-expect-error - dynamic import after mock setup
import * as GitOps from "../git-operations-iso";

describe("GitOperations - Core Operations", () => {
	const testOwnerId = "123";
	const testRepoName = "test-repo";

	beforeEach(() => {
		vi.clearAllMocks();
		mockRepoStorage.withRepositoryWorktree.mockImplementation(
			async (_ownerKey, _repoName, _branchName, fn) =>
				fn({ worktreePath: "/tmp/worktree", gitdir: "/tmp/gitdir" }),
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("createCommit", () => {
		it("should create commit with files", async () => {
			const mockCommitSha = "abc123";
			mockGit.default.add.mockResolvedValue(undefined);
			mockGit.default.setConfig.mockResolvedValue(undefined);
			mockGit.default.commit.mockResolvedValue(mockCommitSha);

			const files = [
				{ path: "README.md", content: "# Test Repo" },
				{ path: "src/index.js", content: 'console.log("Hello");' },
			];

			const result = await GitOps.createCommit(
				testOwnerId,
				testRepoName,
				"Initial commit",
				files,
				"Test Author",
				"test@example.com",
			);

			expect(result).toBe(mockCommitSha);
			expect(mockFs.writeFileSync).toHaveBeenCalledTimes(2);
			expect(mockGit.default.add).toHaveBeenCalledTimes(2);
			expect(mockGit.default.commit).toHaveBeenCalled();
		});

		it("should use default author if not provided", async () => {
			mockGit.default.add.mockResolvedValue(undefined);
			mockGit.default.setConfig.mockResolvedValue(undefined);
			mockGit.default.commit.mockResolvedValue("sha123");

			await GitOps.createCommit(testOwnerId, testRepoName, "Test commit", [
				{ path: "file.txt", content: "test" },
			]);

			expect(mockGit.default.commit).toHaveBeenCalled();
		});
	});

	describe("getBranches", () => {
		it("should list all branches", async () => {
			mockGit.default.listBranches.mockResolvedValue([
				"main",
				"develop",
				"feature/test",
			]);
			mockGit.default.currentBranch.mockResolvedValue("main");
			mockGit.default.resolveRef.mockImplementation((opts: { ref: string }) => {
				return Promise.resolve(`sha-${opts.ref}`);
			});

			const result = await GitOps.getBranches(testOwnerId, testRepoName);

			expect(result).toHaveLength(3);
			expect(result[0]).toMatchObject({
				name: "main",
				isDefault: true,
			});
		});

		it("should return empty array if no branches", async () => {
			mockGit.default.listBranches.mockResolvedValue([]);
			mockGit.default.currentBranch.mockResolvedValue(null);

			const result = await GitOps.getBranches(testOwnerId, testRepoName);

			expect(result).toEqual([]);
		});
	});

	describe("createBranch", () => {
		it("should create branch from base ref", async () => {
			mockGit.default.resolveRef.mockResolvedValue("base-commit-sha");
			mockGit.default.branch.mockResolvedValue(undefined);

			await GitOps.createBranch(
				testOwnerId,
				testRepoName,
				"feature/new",
				"main",
			);

			expect(mockGit.default.resolveRef).toHaveBeenCalled();
			expect(mockGit.default.branch).toHaveBeenCalled();
			expect(mockRepoStorage.syncRepositoryToR2).toHaveBeenCalled();
		});
	});

	describe("deleteBranch", () => {
		it("should delete branch", async () => {
			mockGit.default.deleteBranch.mockResolvedValue(undefined);

			await GitOps.deleteBranch(testOwnerId, testRepoName, "feature/old");

			expect(mockGit.default.deleteBranch).toHaveBeenCalled();
			expect(mockRepoStorage.syncRepositoryToR2).toHaveBeenCalled();
		});
	});

	describe("getBlob", () => {
		it("should read blob by SHA", async () => {
			const mockContent = Buffer.from("Hello, World!");
			mockGit.default.readBlob.mockResolvedValue({ blob: mockContent });

			const result = await GitOps.getBlob(
				testOwnerId,
				testRepoName,
				"blob-sha",
			);

			expect(result).toEqual(mockContent);
			expect(mockGit.default.readBlob).toHaveBeenCalled();
		});
	});

	describe("getCommit", () => {
		it("should read commit by SHA", async () => {
			const commitSha = "abc123def";
			mockGit.default.readCommit.mockResolvedValue({
				oid: commitSha,
				commit: {
					message: "Initial commit",
					tree: "tree-sha",
					parent: [],
					author: {
						name: "A",
						email: "a@b.com",
						timestamp: 0,
						timezoneOffset: 0,
					},
					committer: {
						name: "A",
						email: "a@b.com",
						timestamp: 0,
						timezoneOffset: 0,
					},
				},
				payload: "commit payload",
			});

			const result = await GitOps.getCommit(
				testOwnerId,
				testRepoName,
				commitSha,
			);

			expect(result.oid).toBe(commitSha);
			expect(result.commit.message).toBe("Initial commit");
		});
	});

	describe("getCommitLog", () => {
		it("should return commit log with depth", async () => {
			mockGit.default.log.mockResolvedValue([
				{
					oid: "sha1",
					commit: {
						message: "First",
						tree: "t1",
						parent: [],
						author: {
							name: "A",
							email: "a@b.com",
							timestamp: 1,
							timezoneOffset: 0,
						},
						committer: {
							name: "A",
							email: "a@b.com",
							timestamp: 1,
							timezoneOffset: 0,
						},
					},
					payload: "",
				},
				{
					oid: "sha2",
					commit: {
						message: "Second",
						tree: "t2",
						parent: ["sha1"],
						author: {
							name: "A",
							email: "a@b.com",
							timestamp: 0,
							timezoneOffset: 0,
						},
						committer: {
							name: "A",
							email: "a@b.com",
							timestamp: 0,
							timezoneOffset: 0,
						},
					},
					payload: "",
				},
			]);

			const result = await GitOps.getCommitLog(
				testOwnerId,
				testRepoName,
				"main",
				10,
			);

			expect(result).toHaveLength(2);
			expect(result[0].commit.message).toBe("First");
		});

		it("should return empty array for nonexistent ref", async () => {
			mockGit.default.log.mockRejectedValue({ code: "NotFoundError" });

			const result = await GitOps.getCommitLog(
				testOwnerId,
				testRepoName,
				"nonexistent",
			);

			expect(result).toEqual([]);
		});
	});

	describe("getCommitHistory", () => {
		it("should return paginated commits with skip/limit", async () => {
			const commits = Array.from({ length: 5 }, (_, i) => ({
				oid: `sha${i}`,
				commit: {
					message: `Commit ${i}`,
					tree: `t${i}`,
					parent: i > 0 ? [`sha${i - 1}`] : [],
					author: {
						name: "A",
						email: "a@b.com",
						timestamp: i,
						timezoneOffset: 0,
					},
					committer: {
						name: "A",
						email: "a@b.com",
						timestamp: i,
						timezoneOffset: 0,
					},
				},
				payload: "",
			}));

			mockGit.default.resolveRef.mockResolvedValue("head-sha");
			mockGit.default.log.mockResolvedValue(commits);

			const result = await GitOps.getCommitHistory(
				testOwnerId,
				testRepoName,
				"main",
				2,
				1,
			);

			expect(result).toHaveLength(2);
			expect(result[0].commit.message).toBe("Commit 1");
			expect(result[1].commit.message).toBe("Commit 2");
		});

		it("should return empty array for nonexistent branch", async () => {
			mockGit.default.resolveRef.mockRejectedValue(new Error("not found"));
			mockGit.default.log.mockRejectedValue({ code: "NotFoundError" });

			const result = await GitOps.getCommitHistory(
				testOwnerId,
				testRepoName,
				"nonexistent",
			);

			expect(result).toEqual([]);
		});
	});

	describe("getTree", () => {
		it("should return tree entries for a branch", async () => {
			const commitSha = "tree-commit-sha";
			const treeSha = "root-tree-sha";

			mockGit.default.resolveRef.mockResolvedValue(commitSha);
			mockGit.default.readCommit.mockResolvedValue({
				oid: commitSha,
				commit: {
					tree: treeSha,
					message: "",
					parent: [],
					author: {},
					committer: {},
				},
				payload: "",
			});
			mockGit.default.readTree.mockResolvedValue({
				tree: [
					{ path: "README.md", mode: "100644", type: "blob", oid: "b1" },
					{ path: "src", mode: "040000", type: "tree", oid: "t1" },
				],
			});

			const result = await GitOps.getTree(testOwnerId, testRepoName, "main");

			expect(result).toHaveLength(2);
			expect(result[0].path).toBe("README.md");
			expect(result[1].type).toBe("tree");
		});
	});

	describe("getFileContent", () => {
		it("should read a file from a branch", async () => {
			const commitSha = "file-commit-sha";
			const treeSha = "file-tree-sha";
			const fileOid = "file-blob-sha";

			mockGit.default.resolveRef.mockResolvedValue(commitSha);
			mockGit.default.readCommit.mockResolvedValue({
				oid: commitSha,
				commit: {
					tree: treeSha,
					message: "",
					parent: [],
					author: {},
					committer: {},
				},
				payload: "",
			});
			mockGit.default.readTree.mockResolvedValue({
				tree: [
					{ path: "README.md", mode: "100644", type: "blob", oid: fileOid },
				],
			});
			mockGit.default.readBlob.mockResolvedValue({
				blob: Buffer.from("# Hello\n"),
			});

			const result = await GitOps.getFileContent(
				testOwnerId,
				testRepoName,
				"README.md",
				"main",
			);

			expect(result.toString()).toBe("# Hello\n");
		});

		it("should throw if file not found", async () => {
			const commitSha = "missing-commit";
			const treeSha = "missing-tree";

			mockGit.default.resolveRef.mockResolvedValue(commitSha);
			mockGit.default.readCommit.mockResolvedValue({
				oid: commitSha,
				commit: {
					tree: treeSha,
					message: "",
					parent: [],
					author: {},
					committer: {},
				},
				payload: "",
			});
			mockGit.default.readTree.mockResolvedValue({ tree: [] });

			await expect(
				GitOps.getFileContent(testOwnerId, testRepoName, "nope.txt", "main"),
			).rejects.toThrow("File not found");
		});
	});

	describe("checkoutBranch", () => {
		it("should validate branch exists", async () => {
			mockGit.default.resolveRef.mockResolvedValue("branch-sha");

			await GitOps.checkoutBranch(testOwnerId, testRepoName, "main");

			expect(mockGit.default.resolveRef).toHaveBeenCalledWith(
				expect.objectContaining({ ref: "refs/heads/main" }),
			);
		});
	});

	describe("getFileFromBranch", () => {
		it("should return file content as text", async () => {
			const commitSha = "fb-commit";
			const treeSha = "fb-tree";
			const fileOid = "fb-blob";

			mockGit.default.resolveRef.mockResolvedValue(commitSha);
			mockGit.default.readCommit.mockResolvedValue({
				oid: commitSha,
				commit: {
					tree: treeSha,
					message: "",
					parent: [],
					author: {},
					committer: {},
				},
				payload: "",
			});
			mockGit.default.readTree.mockResolvedValue({
				tree: [
					{ path: "hello.txt", mode: "100644", type: "blob", oid: fileOid },
				],
			});
			mockGit.default.readBlob.mockResolvedValue({
				blob: Buffer.from("Hello, World!"),
			});

			const result = await GitOps.getFileFromBranch(
				testOwnerId,
				testRepoName,
				"main",
				"hello.txt",
			);

			expect(result.content).toBe("Hello, World!");
			expect(result.isBinary).toBe(false);
			expect(result.size).toBe(13);
		});

		it("should detect binary files and return base64", async () => {
			const commitSha = "bin-commit";
			const treeSha = "bin-tree";

			mockGit.default.resolveRef.mockResolvedValue(commitSha);
			mockGit.default.readCommit.mockResolvedValue({
				oid: commitSha,
				commit: {
					tree: treeSha,
					message: "",
					parent: [],
					author: {},
					committer: {},
				},
				payload: "",
			});
			mockGit.default.readTree.mockResolvedValue({
				tree: [
					{ path: "image.png", mode: "100644", type: "blob", oid: "bin-oid" },
				],
			});
			mockGit.default.readBlob.mockResolvedValue({
				blob: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]),
			});

			const result = await GitOps.getFileFromBranch(
				testOwnerId,
				testRepoName,
				"main",
				"image.png",
			);

			expect(result.isBinary).toBe(true);
			expect(result.content).toBe(
				Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]).toString("base64"),
			);
		});
	});

	describe("deleteFile", () => {
		it("should delete file and create commit", async () => {
			mockGit.default.remove.mockResolvedValue(undefined);
			mockGit.default.setConfig.mockResolvedValue(undefined);
			mockGit.default.commit.mockResolvedValue("delete-sha");

			const result = await GitOps.deleteFile(
				testOwnerId,
				testRepoName,
				"main",
				"old.txt",
				"Remove old.txt",
				{ name: "User", email: "user@test.com" },
			);

			expect(result.sha).toBe("delete-sha");
			expect(mockGit.default.remove).toHaveBeenCalledWith(
				expect.objectContaining({ filepath: "old.txt" }),
			);
			expect(mockFs.rmSync).toHaveBeenCalled();
		});
	});
});
