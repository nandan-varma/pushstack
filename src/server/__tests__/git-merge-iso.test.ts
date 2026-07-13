/**
 * Tests that analyzeMerge/mergeBranches discriminate expected "not found"
 * conditions from real errors instead of swallowing everything.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("#/lib/r2", () => ({
	isR2Configured: () => true,
}));

vi.mock("isomorphic-git", () => ({
	default: {
		resolveRef: vi.fn(),
		isDescendent: vi.fn(),
		writeRef: vi.fn(),
	},
}));

vi.mock("../git-manager-iso", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../git-manager-iso")>();
	return {
		...actual,
		getBareRepoOptions: vi.fn(() => ({ fs: {}, gitdir: "/fake/gitdir" })),
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
