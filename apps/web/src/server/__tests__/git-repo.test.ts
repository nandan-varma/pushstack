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
	deleteRepoStorage: vi.fn(),
	moveRepoStorage: vi.fn(),
	prefetchAllPacks: vi.fn(),
}));

const GitManager = await import("../git-repo");
const git = mockGit.default;

describe("git-repo", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("repoFor", () => {
		it("returns gitFs, the registered gitdir, and a shared per-repo cache", () => {
			const options = GitManager.repoFor("alice", "blog");
			expect(options.fs).toBe(mockGitFs);
			expect(options.gitdir).toBe("repos/alice/blog/git");
			expect(mockRegisterRepoGitdir).toHaveBeenCalledWith("alice", "blog");
			// Same cache object across calls: isomorphic-git's parsed pack
			// indexes survive between operations on one repo.
			expect(GitManager.repoFor("alice", "blog").cache).toBe(options.cache);
		});

		it("gives different repos different caches", () => {
			expect(GitManager.repoFor("alice", "a").cache).not.toBe(
				GitManager.repoFor("alice", "b").cache,
			);
		});

		it("drops the shared cache after a push", () => {
			const before = GitManager.repoFor("alice", "c").cache;
			GitManager.afterRepositoryPush("alice", "c");
			expect(GitManager.repoFor("alice", "c").cache).not.toBe(before);
		});
	});

	describe("initBareRepo", () => {
		it("initializes a bare repository in object storage", async () => {
			git.init.mockResolvedValue(undefined);

			await GitManager.initBareRepo("u123", "test-repo", "main");

			expect(git.init).toHaveBeenCalledWith({
				fs: mockGitFs,
				dir: "repos/u123/test-repo/git",
				defaultBranch: "main",
				bare: true,
			});
		});

		it("does not call git.setConfig", async () => {
			git.init.mockResolvedValue(undefined);
			await GitManager.initBareRepo("u123", "test-repo", "main");
			expect(git.setConfig).not.toHaveBeenCalled();
		});
	});
});
