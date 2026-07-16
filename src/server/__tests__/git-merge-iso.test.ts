/**
 * Tests that analyzeMerge/mergeBranches discriminate expected "not found"
 * conditions from real errors instead of swallowing everything.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockIsR2Configured = vi.hoisted(() => vi.fn(() => true));
const mockWithRepositoryWorktree = vi.hoisted(() => vi.fn());

vi.mock("#/lib/r2", () => ({
	isR2Configured: mockIsR2Configured,
}));

vi.mock("isomorphic-git", () => ({
	default: {
		resolveRef: vi.fn(),
		isDescendent: vi.fn(),
		writeRef: vi.fn(),
		merge: vi.fn(),
	},
}));

vi.mock("../git-manager-iso", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../git-manager-iso")>();
	return {
		...actual,
		getBareRepoOptions: vi.fn(() => ({ fs: {}, gitdir: "/fake/gitdir" })),
	};
});

vi.mock("../git-repo-storage", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../git-repo-storage")>();
	return {
		...actual,
		withRepositoryWorktree: mockWithRepositoryWorktree,
	};
});

function notFoundError(message = "not found") {
	const err = new Error(message);
	(err as { code?: string }).code = "NotFoundError";
	return err;
}

describe("analyzeMerge", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("still returns cannot-merge for a NotFoundError (e.g. deleted branch)", async () => {
		const git = (await import("isomorphic-git")).default;
		(git.resolveRef as ReturnType<typeof vi.fn>).mockRejectedValue(
			notFoundError(),
		);

		const { analyzeMerge } = await import("../git-merge-iso");
		const result = await analyzeMerge("owner", "repo", "feature", "main");

		expect(result).toEqual({
			canMerge: false,
			hasConflicts: true,
			conflictingFiles: [],
			fastForward: false,
		});
	});

	it("propagates a non-NotFoundError instead of swallowing it", async () => {
		const git = (await import("isomorphic-git")).default;
		(git.resolveRef as ReturnType<typeof vi.fn>).mockRejectedValue(
			new Error("R2 timeout"),
		);

		const { analyzeMerge } = await import("../git-merge-iso");

		await expect(
			analyzeMerge("owner", "repo", "feature", "main"),
		).rejects.toThrow("R2 timeout");
	});
});

describe("mergeBranches fast-forward branch", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockIsR2Configured.mockReturnValue(true);
	});

	it("propagates a non-NotFoundError instead of returning a fake conflict", async () => {
		const git = (await import("isomorphic-git")).default;
		(git.resolveRef as ReturnType<typeof vi.fn>).mockRejectedValue(
			new Error("R2 timeout"),
		);

		const { mergeBranches } = await import("../git-merge-iso");

		await expect(
			mergeBranches("owner", "repo", "feature", "main"),
		).rejects.toThrow("R2 timeout");
	});
});

describe("mergeBranches non-fast-forward (worktree) branch", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Skip the R2 fast-forward shortcut entirely so mergeBranches goes
		// straight to the withRepositoryWorktree path under test.
		mockIsR2Configured.mockReturnValue(false);
	});

	it("returns a structured conflict result for a real MergeConflictError", async () => {
		const conflictError = new Error("merge conflict") as Error & {
			code: string;
			data?: { filepaths?: string[] };
		};
		conflictError.code = "MergeConflictError";
		conflictError.data = { filepaths: ["src/a.ts", "src/b.ts"] };
		mockWithRepositoryWorktree.mockRejectedValue(conflictError);

		const { mergeBranches } = await import("../git-merge-iso");
		const result = await mergeBranches("owner", "repo", "feature", "main");

		expect(result).toEqual({
			success: false,
			conflicts: ["src/a.ts", "src/b.ts"],
		});
	});

	it("propagates a non-conflict error instead of mislabeling it as a merge conflict", async () => {
		mockWithRepositoryWorktree.mockRejectedValue(
			new Error("R2 object read failed"),
		);

		const { mergeBranches } = await import("../git-merge-iso");

		await expect(
			mergeBranches("owner", "repo", "feature", "main"),
		).rejects.toThrow("R2 object read failed");
	});
});
