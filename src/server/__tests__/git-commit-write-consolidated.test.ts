/**
 * Consolidated tests for createCommit (git-commit-write.ts):
 *   1. Parent resolution error discrimination (was git-operations-errors.test.ts)
 *   2. Repository-level locking on concurrent writes (was git-operations-locking.test.ts)
 *
 * These tests share identical mock infrastructure (isomorphic-git, git-manager-iso,
 * r2) so merging them eliminates ~120 lines of duplicated setup.
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

vi.mock("isomorphic-git", () => ({
	default: {
		resolveRef: vi.fn(async () => {
			const err = new Error("not found");
			(err as { code?: string }).code = "NotFoundError";
			return trackConcurrency(undefined).then(() => {
				throw err;
			});
		}),
		readCommit: vi.fn(async () =>
			trackConcurrency({
				commit: { tree: "tree-oid", parent: [], message: "init" },
				payload: "",
			}),
		),
		writeBlob: vi.fn(async () => trackConcurrency("blob-oid")),
		writeTree: vi.fn(async () => trackConcurrency("tree-oid")),
		writeCommit: vi.fn(async () => trackConcurrency("commit-oid")),
		writeRef: vi.fn(async () => trackConcurrency(undefined)),
		branch: vi.fn(async () => trackConcurrency(undefined)),
		deleteBranch: vi.fn(async () => trackConcurrency(undefined)),
	},
}));

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

function notFoundError(message = "not found") {
	const err = new Error(message);
	(err as { code?: string }).code = "NotFoundError";
	return err;
}

describe("createCommit — parent resolution", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("succeeds as first commit on NotFoundError parent ref", async () => {
		const git = (await import("isomorphic-git")).default;
		(git.resolveRef as ReturnType<typeof vi.fn>).mockRejectedValue(
			notFoundError(),
		);

		const { createCommit } = await import("../git-commit-write");
		const sha = await createCommit(
			"owner",
			"repo",
			"initial commit",
			[{ path: "README.md", content: "hello" }],
			"Test",
			"test@example.com",
		);
		expect(sha).toBe("commit-oid");
	});

	it("propagates non-NotFoundError instead of treating as empty repo", async () => {
		const git = (await import("isomorphic-git")).default;
		(git.resolveRef as ReturnType<typeof vi.fn>).mockRejectedValue(
			new Error("R2 timeout"),
		);

		const { createCommit } = await import("../git-commit-write");
		await expect(
			createCommit(
				"owner",
				"repo",
				"initial commit",
				[{ path: "README.md", content: "hello" }],
				"Test",
				"test@example.com",
			),
		).rejects.toThrow("R2 timeout");
	});
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
		const git = (await import("isomorphic-git")).default;
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

		expect(git.resolveRef).not.toHaveBeenCalled();
		expect(git.writeCommit).not.toHaveBeenCalled();
		expect(git.writeRef).not.toHaveBeenCalled();
	});
});

describe("deleteFile — branch name guard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("rejects a path-traversal branch name without touching the filesystem", async () => {
		const git = (await import("isomorphic-git")).default;
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

		expect(git.resolveRef).not.toHaveBeenCalled();
		expect(git.writeRef).not.toHaveBeenCalled();
	});
});

describe("createCommit — concurrent write serialization", () => {
	beforeEach(async () => {
		resetConcurrencyTracking();
		vi.clearAllMocks();
		// Restore resolveRef to the factory default (NotFoundError + concurrency tracking)
		// since the "parent resolution" tests override it with mockRejectedValue.
		const git = (await import("isomorphic-git")).default;
		(git.resolveRef as ReturnType<typeof vi.fn>).mockImplementation(
			async () => {
				const err = new Error("not found");
				(err as { code?: string }).code = "NotFoundError";
				return trackConcurrency(undefined).then(() => {
					throw err;
				});
			},
		);
	});

	it("never has two concurrent git calls in flight for the same repo", async () => {
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
		const git = (await import("isomorphic-git")).default;
		(git.resolveRef as ReturnType<typeof vi.fn>).mockImplementation(async () =>
			trackConcurrency("some-oid"),
		);

		await Promise.all([
			createBranch("owner", "repo", "feature-a", "main"),
			deleteBranch("owner", "repo", "feature-b"),
		]);

		expect(maxConcurrentCalls).toBe(1);
	});
});
