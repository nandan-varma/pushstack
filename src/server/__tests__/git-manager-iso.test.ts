/**
 * Unit tests for git-manager-iso.ts — repository init and the `Repo` options
 * every git call uses. Storage is always gitFs (object storage); there is no
 * local-disk mode to select.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGit = vi.hoisted(() => ({
	default: {
		init: vi.fn(),
		setConfig: vi.fn(),
	},
}));

vi.mock("isomorphic-git", () => mockGit);

const mockGitFs = vi.hoisted(() => ({ promises: {} }));
const mockRegisterRepoGitdir = vi.hoisted(() =>
	vi.fn((owner: string, repo: string) => `repos/${owner}/${repo}/git`),
);
vi.mock("../git-fs", () => ({
	gitFs: mockGitFs,
	registerRepoGitdir: mockRegisterRepoGitdir,
}));

vi.mock("../git-storage-naming", () => ({
	getRepoGitStorageRoot: (owner: string, repo: string) =>
		`repos/${owner}/${repo}/git`,
}));

const GitManager = await import("../git-manager-iso");
const git = mockGit.default;

describe("git-manager-iso", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("getBareRepoOptions", () => {
		it("returns gitFs, the registered gitdir, and a shared per-repo cache", () => {
			const options = GitManager.getBareRepoOptions("alice", "blog");
			expect(options.fs).toBe(mockGitFs);
			expect(options.gitdir).toBe("repos/alice/blog/git");
			expect(mockRegisterRepoGitdir).toHaveBeenCalledWith("alice", "blog");
			// Same cache object across calls: isomorphic-git's parsed pack
			// indexes survive between operations on one repo.
			expect(GitManager.getBareRepoOptions("alice", "blog").cache).toBe(
				options.cache,
			);
		});

		it("gives different repos different caches", () => {
			expect(GitManager.getBareRepoOptions("alice", "a").cache).not.toBe(
				GitManager.getBareRepoOptions("alice", "b").cache,
			);
		});

		it("drops the shared cache on invalidateRepoGitCache", () => {
			const before = GitManager.getBareRepoOptions("alice", "c").cache;
			GitManager.invalidateRepoGitCache("alice", "c");
			expect(GitManager.getBareRepoOptions("alice", "c").cache).not.toBe(
				before,
			);
		});
	});

	describe("initBareRepo", () => {
		it("initializes a bare repository in object storage", async () => {
			git.init.mockResolvedValue(undefined);

			const gitdir = await GitManager.initBareRepo("123", "test-repo", "main");

			expect(gitdir).toBe("repos/123/test-repo/git");
			expect(git.init).toHaveBeenCalledWith({
				fs: mockGitFs,
				dir: "repos/123/test-repo/git",
				defaultBranch: "main",
				bare: true,
			});
		});

		it("does not call git.setConfig", async () => {
			git.init.mockResolvedValue(undefined);
			await GitManager.initBareRepo("123", "test-repo", "main");
			expect(git.setConfig).not.toHaveBeenCalled();
		});
	});
});
