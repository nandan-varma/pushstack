/**
 * Consolidated tests for createCommit/deleteFile (git-commit-write.ts) and
 * the branch mutators (git-branch-ops.ts):
 *   1. Branch-name guard (path-traversal rejection before any git call)
 *   2. Repository-level locking on concurrent writes
 *
 * Parent-ref resolution error discrimination (NotFoundError = empty repo vs.
 * any other error propagates) now lives in git-fs-s3's own
 * test/ops.test.ts ("writeCommitToBare parent resolution") — createCommit's
 * R2 path delegates straight to that function.
 *
 * Concurrency here is verified by mocking git-fs-s3/ops
 * directly (not isomorphic-git): that package resolves its own isomorphic-git
 * copy under pnpm's isolated node_modules layout, so a mock of isomorphic-git
 * from this file never reaches its internal calls. What actually matters for
 * this test is that pushstack's own withRepositoryLock serializes concurrent
 * high-level calls — mocking the ops functions pushstack imports by name
 * observes that directly.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("#/lib/r2", () => ({
	isR2Configured: () => true,
}));

let concurrentCalls = 0;
let maxConcurrentCalls = 0;

function resetConcurrencyTracking() {
	concurrentCalls = 0;
	maxConcurrentCalls = 0;
}

async function trackConcurrency<T>(result: T): Promise<T> {
	concurrentCalls++;
	maxConcurrentCalls = Math.max(maxConcurrentCalls, concurrentCalls);
	await new Promise((resolve) => setTimeout(resolve, 10));
	concurrentCalls--;
	return result;
}

vi.mock("git-fs-s3/ops", async (importOriginal) => {
	const actual = await importOriginal<typeof import("git-fs-s3/ops")>();
	return {
		...actual,
		commitFilesToBare: vi.fn(async () => trackConcurrency("commit-oid")),
		deleteFileFromBare: vi.fn(async () => trackConcurrency("commit-oid")),
		createBranchFrom: vi.fn(async () => trackConcurrency(undefined)),
		deleteBranchByName: vi.fn(async () => trackConcurrency(undefined)),
	};
});

vi.mock("../git-manager-iso", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../git-manager-iso")>();
	return {
		...actual,
		getBareRepoOptions: vi.fn(() => ({ fs: {}, gitdir: "/fake/gitdir" })),
		getDefaultAuthor: vi.fn(() => ({
			name: "Test",
			email: "test@example.com",
			timestamp: 0,
			timezoneOffset: 0,
		})),
	};
});

describe("createCommit — branch name guard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// git.commit's internal ref-write (used by the non-R2 worktree path,
	// git-commit-write.ts) doesn't validate the ref itself the way
	// git.branch/git.writeRef do — createCommit must reject a path-traversal
	// branch name itself before any isomorphic-git call runs.
	it("rejects a path-traversal branch name without writing anything", async () => {
		const { commitFilesToBare } = await import("git-fs-s3/ops");
		const { createCommit } = await import("../git-commit-write");

		await expect(
			createCommit(
				"owner",
				"repo",
				"msg",
				[{ path: "README.md", content: "hello" }],
				"Test",
				"test@example.com",
				"../../other-owner/other-repo/git/refs/heads/main",
			),
		).rejects.toThrow("Invalid branch name");

		expect(commitFilesToBare).not.toHaveBeenCalled();
	});
});

describe("deleteFile — branch name guard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("rejects a path-traversal branch name without touching the filesystem", async () => {
		const { deleteFileFromBare } = await import("git-fs-s3/ops");
		const { deleteFile } = await import("../git-commit-write");

		await expect(
			deleteFile(
				"owner",
				"repo",
				"refs/heads/../../other-owner/other-repo/git/refs/heads/main",
				"README.md",
				"msg",
				{ name: "Test", email: "test@example.com" },
			),
		).rejects.toThrow("Invalid branch name");

		expect(deleteFileFromBare).not.toHaveBeenCalled();
	});
});

describe("createCommit — concurrent write serialization", () => {
	beforeEach(() => {
		resetConcurrencyTracking();
		vi.clearAllMocks();
	});

	it("never has two concurrent ops calls in flight for the same repo", async () => {
		const { createCommit } = await import("../git-commit-write");

		await Promise.all([
			createCommit(
				"owner",
				"repo",
				"first commit",
				[{ path: "a.txt", content: "a" }],
				"Test",
				"test@example.com",
			),
			createCommit(
				"owner",
				"repo",
				"second commit",
				[{ path: "b.txt", content: "b" }],
				"Test",
				"test@example.com",
			),
		]);

		expect(maxConcurrentCalls).toBe(1);
	});

	it("still succeeds for both concurrent calls", async () => {
		const { createCommit } = await import("../git-commit-write");

		const results = await Promise.all([
			createCommit(
				"owner",
				"repo",
				"first commit",
				[{ path: "a.txt", content: "a" }],
				"Test",
				"test@example.com",
			),
			createCommit(
				"owner",
				"repo",
				"second commit",
				[{ path: "b.txt", content: "b" }],
				"Test",
				"test@example.com",
			),
		]);

		expect(results).toEqual(["commit-oid", "commit-oid"]);
	});

	it("serializes concurrent createBranch/deleteBranch", async () => {
		const { createBranch, deleteBranch } = await import("../git-branch-ops");

		await Promise.all([
			createBranch("owner", "repo", "feature-a", "main"),
			deleteBranch("owner", "repo", "feature-b"),
		]);

		expect(maxConcurrentCalls).toBe(1);
	});
});
