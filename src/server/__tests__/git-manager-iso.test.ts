/**
 * Unit tests for git-manager-iso.ts
 * Tests repository initialization, deletion, and management operations
 */

import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock filesystem operations for testing
const mockFs = vi.hoisted(() => ({
	promises: {
		mkdir: vi.fn(),
		access: vi.fn(),
		rm: vi.fn(),
		readdir: vi.fn(),
		stat: vi.fn(),
		writeFile: vi.fn(),
	},
}));

vi.mock("node:fs", () => ({
	default: mockFs,
	promises: mockFs.promises,
}));

// Mock isomorphic-git
const mockGit = vi.hoisted(() => ({
	default: {
		init: vi.fn(),
		setConfig: vi.fn(),
		clone: vi.fn(),
	},
}));

vi.mock("isomorphic-git", () => mockGit);

// Mock R2 detection so we can test both paths
const mockIsR2Configured = vi.hoisted(() => vi.fn(() => false));
vi.mock("#/lib/r2", () => ({ isR2Configured: mockIsR2Configured }));

// Mock R2 backend
const mockR2Backend = vi.hoisted(() => ({}));
vi.mock("../git-r2-backend", () => ({ r2Backend: mockR2Backend }));

// Mock storage naming
vi.mock("../git-storage-naming", () => ({
	getRepoGitStorageRoot: (owner: string, repo: string) =>
		`repos/${owner}/${repo}/git`,
	sanitizeStorageSegment: (value: string) => value,
}));

// Now import after mocks
const GitManager = await import("../git-manager-iso");
const git = mockGit.default;
const fs = mockFs.promises;

describe("GitManager - Repository Management", () => {
	const testOwnerId = "123";
	const testRepoName = "test-repo";
	const testGitPath = path.join(
		os.tmpdir(),
		"pushstack-repos",
		"123",
		"test-repo",
	);

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("getRepoPath", () => {
		it("should return correct repository path", () => {
			const result = GitManager.getRepoPath(testOwnerId, testRepoName);
			expect(result).toContain("123");
			expect(result).toContain("test-repo");
			expect(result).toMatch(/repos/);
		});

		// The git-storage-naming mock above is an identity passthrough, so this
		// exercises getRepoPath's own containment check rather than
		// sanitizeStorageSegment's (which is tested for real in
		// git-storage-naming.test.ts) — belt-and-suspenders against a caller that
		// forgot to pre-sanitize.
		it("refuses to resolve a repoName that escapes the storage root", () => {
			expect(() =>
				GitManager.getRepoPath(testOwnerId, "../../../../etc/passwd"),
			).toThrow(/outside storage root/);
		});

		it("refuses to resolve an ownerKey that escapes the storage root", () => {
			expect(() =>
				GitManager.getRepoPath("../../../../etc", testRepoName),
			).toThrow(/outside storage root/);
		});
	});

	describe("ensureGitBaseDir", () => {
		it("should create base directory", async () => {
			fs.mkdir.mockResolvedValue(undefined);

			await GitManager.ensureGitBaseDir();

			expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining("repos"), {
				recursive: true,
			});
		});
	});

	describe("initBareRepo", () => {
		it("should initialize a new repository", async () => {
			fs.mkdir.mockResolvedValue(undefined);
			git.init.mockResolvedValue(undefined);

			const result = await GitManager.initBareRepo(testOwnerId, testRepoName);

			expect(fs.mkdir).toHaveBeenCalled();
			expect(git.init).toHaveBeenCalledWith({
				fs: expect.anything(),
				dir: expect.stringContaining("test-repo"),
				defaultBranch: "main",
				bare: true,
			});
			expect(result).toContain("test-repo");
		});

		// No git.setConfig call: getDefaultAuthor() returns the default
		// name/email as plain JS constants, never read back from git config —
		// see the comment on initBareRepo. A prior version called setConfig
		// here, but it silently wrote to the wrong (nested, non-bare) config
		// path and nothing ever consumed it.
		it("does not call git.setConfig", async () => {
			fs.mkdir.mockResolvedValue(undefined);
			git.init.mockResolvedValue(undefined);

			await GitManager.initBareRepo(testOwnerId, testRepoName);

			expect(git.setConfig).not.toHaveBeenCalled();
		});
	});

	describe("deleteRepo", () => {
		it("should delete repository directory", async () => {
			fs.rm.mockResolvedValue(undefined);

			await GitManager.deleteRepo(testOwnerId, testRepoName);

			expect(fs.rm).toHaveBeenCalledWith(expect.stringContaining("test-repo"), {
				recursive: true,
				force: true,
			});
		});

		it("should throw error if deletion fails", async () => {
			fs.rm.mockRejectedValue(new Error("Permission denied"));

			await expect(
				GitManager.deleteRepo(testOwnerId, testRepoName),
			).rejects.toThrow("Failed to delete repository");
		});
	});

	describe("getRepoDiskUsage", () => {
		it("should calculate total disk usage", async () => {
			const mockFiles = [
				{ name: "file1.txt", isDirectory: () => false },
				{ name: "dir1", isDirectory: () => true },
			];
			const mockStats = { size: 1024 };

			fs.readdir
				.mockResolvedValueOnce(mockFiles)
				.mockResolvedValueOnce([
					{ name: "nested.txt", isDirectory: () => false },
				]);
			fs.stat.mockResolvedValue(mockStats);

			const result = await GitManager.getRepoDiskUsage(testGitPath);

			expect(result).toBeGreaterThan(0);
			expect(fs.readdir).toHaveBeenCalled();
		});

		it("should handle empty directory", async () => {
			fs.readdir.mockResolvedValue([]);

			const result = await GitManager.getRepoDiskUsage(testGitPath);

			expect(result).toBe(0);
		});
	});

	describe("getDefaultAuthor", () => {
		it("should return default author object", () => {
			const author = GitManager.getDefaultAuthor();

			expect(author).toHaveProperty("name", "PushStack");
			expect(author).toHaveProperty("email", "system@pushstack.dev");
			expect(author).toHaveProperty("timestamp");
			expect(author).toHaveProperty("timezoneOffset", 0);
			expect(typeof author.timestamp).toBe("number");
		});
	});

	describe("Vercel/R2 compatibility", () => {
		describe("getRepoPath uses /tmp", () => {
			it("should use os.tmpdir() as default base (not homedir or cwd)", () => {
				const result = GitManager.getRepoPath(testOwnerId, testRepoName);
				expect(result).toContain(os.tmpdir());
			});
		});

		describe("getBareRepoOptions", () => {
			it("returns local fs options when R2 not configured", () => {
				mockIsR2Configured.mockReturnValue(false);
				const opts = GitManager.getBareRepoOptions(testOwnerId, testRepoName);
				expect(opts.gitdir).toContain(testOwnerId);
				expect(opts.gitdir).toContain(testRepoName);
				expect(opts.fs).not.toBe(mockR2Backend);
			});

			it("returns R2 backend options when R2 is configured", () => {
				mockIsR2Configured.mockReturnValue(true);
				const opts = GitManager.getBareRepoOptions(testOwnerId, testRepoName);
				expect(opts.fs).toBe(mockR2Backend);
				expect(opts.gitdir).toBe(`repos/${testOwnerId}/${testRepoName}/git`);
				mockIsR2Configured.mockReturnValue(false);
			});
		});

		describe("initBareRepo", () => {
			it("skips local mkdir and uses R2 backend when R2 is configured", async () => {
				mockIsR2Configured.mockReturnValue(true);
				git.init.mockResolvedValue(undefined);

				const result = await GitManager.initBareRepo(testOwnerId, testRepoName);

				expect(fs.mkdir).not.toHaveBeenCalled();
				expect(git.init).toHaveBeenCalledWith(
					expect.objectContaining({ fs: mockR2Backend, bare: true }),
				);
				expect(result).toBe(`repos/${testOwnerId}/${testRepoName}/git`);
				mockIsR2Configured.mockReturnValue(false);
			});
		});
	});
});
