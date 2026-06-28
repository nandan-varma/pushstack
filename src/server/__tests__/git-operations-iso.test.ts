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
});
