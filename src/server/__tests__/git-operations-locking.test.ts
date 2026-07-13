/**
 * Regression coverage for repository-level locking on R2-direct git writes.
 *
 * createCommit/createBranch/deleteBranch write straight to R2 via
 * isomorphic-git when R2 is configured, with no worktree in between. These
 * tests prove two concurrent calls to the same repo are serialized by
 * withRepositoryLock instead of interleaving their reads/writes.
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

// Wraps a mocked isomorphic-git call so we can detect whether two
// createCommit invocations ever have git calls in flight at the same time.
async function trackConcurrency<T>(result: T): Promise<T> {
	concurrentCalls++;
	maxConcurrentCalls = Math.max(maxConcurrentCalls, concurrentCalls);
	// Yield long enough that an unlocked second call would overlap this one.
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

describe("R2-direct git writes are serialized per repository", () => {
	beforeEach(() => {
		resetConcurrencyTracking();
		vi.clearAllMocks();
	});

	it("never has two concurrent createCommit git calls in flight for the same repo", async () => {
		const { createCommit } = await import("../git-operations-iso");

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

	it("still succeeds for both concurrent createCommit calls", async () => {
		const { createCommit } = await import("../git-operations-iso");

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

	it("never has two concurrent createBranch/deleteBranch git calls in flight for the same repo", async () => {
		const { createBranch, deleteBranch } = await import(
			"../git-operations-iso"
		);
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
