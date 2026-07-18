/**
 * Tests for git-history-ops.ts — wrapMissingObject error discrimination
 * and commit log caching behavior.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("#/lib/r2", () => ({
	isR2Configured: () => true,
}));

vi.mock("isomorphic-git", () => ({
	default: {
		resolveRef: vi.fn(),
		log: vi.fn(),
		readBlob: vi.fn(),
		readCommit: vi.fn(),
		readTree: vi.fn(),
	},
}));

vi.mock("../git-repo-storage", () => ({
	getRepoOptions: vi.fn(async () => ({
		fs: {},
		gitdir: "/fake/gitdir",
	})),
	qualifyBranchRef: vi.fn((ref: string) => `refs/heads/${ref}`),
}));

vi.mock("../git-fs", () => ({
	prefetchAllPacks: vi.fn(),
}));

vi.mock("../git-cache", () => ({
	getCachedObject: vi.fn(() => null),
	setCachedObject: vi.fn(),
}));

vi.mock("../perf-log", () => ({
	perfNote: vi.fn(),
	perfStep: vi.fn(async (_label: string, fn: () => Promise<unknown>) => fn()),
}));

function notFoundError(msg = "not found") {
	const err = new Error(msg);
	(err as { code?: string }).code = "NotFoundError";
	return err;
}

describe("wrapMissingObject (via git-history-ops public API)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("wraps NotFoundError as GitObjectNotFoundError for getBlob", async () => {
		const git = (await import("isomorphic-git")).default;
		(git.resolveRef as ReturnType<typeof vi.fn>).mockResolvedValue("abc123");
		(git.readBlob as ReturnType<typeof vi.fn>).mockRejectedValue(
			notFoundError(),
		);

		const { getBlob } = await import("../git-history-ops");
		await expect(getBlob("owner", "repo", "abc123")).rejects.toThrow(
			expect.objectContaining({
				message: expect.stringContaining("Git data for"),
			}),
		);
	});

	it("does not wrap non-NotFoundError — rethrows as-is", async () => {
		const git = (await import("isomorphic-git")).default;
		(git.resolveRef as ReturnType<typeof vi.fn>).mockResolvedValue("abc123");
		const realError = new Error("R2 connection timeout");
		(git.readBlob as ReturnType<typeof vi.fn>).mockRejectedValue(realError);

		const { getBlob } = await import("../git-history-ops");
		await expect(getBlob("owner", "repo", "abc123")).rejects.toThrow(
			"R2 connection timeout",
		);
	});
});

describe("commit log caching", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("getCommitLog resolves ref and calls git.log", async () => {
		const git = (await import("isomorphic-git")).default;
		(git.resolveRef as ReturnType<typeof vi.fn>).mockResolvedValue("abc123");
		(git.log as ReturnType<typeof vi.fn>).mockResolvedValue([
			{ oid: "abc123", commit: { message: "initial" }, payload: "" },
		]);

		const { getCommitLog } = await import("../git-history-ops");
		const result = await getCommitLog("owner", "repo", "main", 5);
		expect(result).toHaveLength(1);
		expect(git.resolveRef).toHaveBeenCalled();
		expect(git.log).toHaveBeenCalled();
	});
});
