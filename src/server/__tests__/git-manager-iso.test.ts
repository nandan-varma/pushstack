/**
 * Unit tests for git-manager-iso.ts
 * Tests repository initialization, deletion, and management operations
 */

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

// Now import after mocks
// @ts-expect-error - importing after mock
const GitManager = await import("../git-manager-iso");
const git = mockGit.default;
const fs = mockFs.promises;

describe("GitManager - Repository Management", () => {
	const testOwnerId = "123";
	const testRepoName = "test-repo";
	const testGitPath = path.join(
		process.cwd(),
		"data",
		"repos",
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
	});

	describe("ensureGitBaseDir", () => {
		it("should create base directory", async () => {
			(fs.mkdir as any).mockResolvedValue(undefined);

			await GitManager.ensureGitBaseDir();

			expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining("repos"), {
				recursive: true,
			});
		});
	});

	describe("initBareRepo", () => {
		it("should initialize a new repository", async () => {
			(fs.mkdir as any).mockResolvedValue(undefined);
			(git.init as any).mockResolvedValue(undefined);
			(git.setConfig as any).mockResolvedValue(undefined);

			const result = await GitManager.initBareRepo(testOwnerId, testRepoName);

			expect(fs.mkdir).toHaveBeenCalled();
			expect(git.init).toHaveBeenCalledWith({
				fs: expect.anything(),
				dir: expect.stringContaining("test-repo"),
				defaultBranch: "main",
				bare: true,
			});
			expect(git.setConfig).toHaveBeenCalledTimes(2); // user.name and user.email
			expect(result).toContain("test-repo");
		});

		it("should set default git config", async () => {
			(fs.mkdir as any).mockResolvedValue(undefined);
			(git.init as any).mockResolvedValue(undefined);
			(git.setConfig as any).mockResolvedValue(undefined);

			await GitManager.initBareRepo(testOwnerId, testRepoName);

			expect(git.setConfig).toHaveBeenCalledWith({
				fs: expect.anything(),
				dir: expect.stringContaining("test-repo"),
				path: "user.name",
				value: "PushStack",
			});
			expect(git.setConfig).toHaveBeenCalledWith({
				fs: expect.anything(),
				dir: expect.stringContaining("test-repo"),
				path: "user.email",
				value: "system@pushstack.dev",
			});
		});
	});

	describe("repoExists", () => {
		it("should return true if repository exists", async () => {
			(fs.access as any).mockResolvedValue(undefined);

			const result = await GitManager.repoExists(testOwnerId, testRepoName);

			expect(result).toBe(true);
			expect(fs.access).toHaveBeenCalledWith(expect.stringContaining("HEAD"));
		});

		it("should return false if repository does not exist", async () => {
			(fs.access as any).mockRejectedValue(new Error("Not found"));

			const result = await GitManager.repoExists(testOwnerId, testRepoName);

			expect(result).toBe(false);
		});
	});

	describe("deleteRepo", () => {
		it("should delete repository directory", async () => {
			(fs.rm as any).mockResolvedValue(undefined);

			await GitManager.deleteRepo(testOwnerId, testRepoName);

			expect(fs.rm).toHaveBeenCalledWith(expect.stringContaining("test-repo"), {
				recursive: true,
				force: true,
			});
		});

		it("should throw error if deletion fails", async () => {
			(fs.rm as any).mockRejectedValue(new Error("Permission denied"));

			await expect(
				GitManager.deleteRepo(testOwnerId, testRepoName),
			).rejects.toThrow("Failed to delete repository");
		});
	});

	describe("cloneRepo", () => {
		it("should clone repository from URL", async () => {
			(fs.mkdir as any).mockResolvedValue(undefined);
			(git.clone as any).mockResolvedValue(undefined);

			const sourceUrl = "https://github.com/example/repo.git";
			const result = await GitManager.cloneRepo(
				sourceUrl,
				testOwnerId,
				testRepoName,
			);

			expect(fs.mkdir).toHaveBeenCalled();
			expect(git.clone).toHaveBeenCalledWith({
				fs: expect.anything(),
				http: expect.anything(),
				dir: expect.stringContaining("test-repo"),
				url: sourceUrl,
				singleBranch: false,
			});
			expect(result).toContain("test-repo");
		});
	});

	describe("getRepoDiskUsage", () => {
		it("should calculate total disk usage", async () => {
			const mockFiles = [
				{ name: "file1.txt", isDirectory: () => false },
				{ name: "dir1", isDirectory: () => true },
			];
			const mockStats = { size: 1024 };

			(fs.readdir as any)
				.mockResolvedValueOnce(mockFiles)
				.mockResolvedValueOnce([
					{ name: "nested.txt", isDirectory: () => false },
				]);
			(fs.stat as any).mockResolvedValue(mockStats);

			const result = await GitManager.getRepoDiskUsage(testGitPath);

			expect(result).toBeGreaterThan(0);
			expect(fs.readdir).toHaveBeenCalled();
		});

		it("should handle empty directory", async () => {
			(fs.readdir as any).mockResolvedValue([]);

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
});
