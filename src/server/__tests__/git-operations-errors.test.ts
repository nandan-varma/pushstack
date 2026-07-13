/**
 * Tests that writeCommitDirect (via createCommit) discriminates the
 * expected "no parent commit yet" NotFoundError from real errors instead
 * of swallowing everything as "empty repo".
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("#/lib/r2", () => ({
	isR2Configured: () => true,
}));

vi.mock("isomorphic-git", () => ({
	default: {
		resolveRef: vi.fn(),
		readCommit: vi.fn(),
		writeBlob: vi.fn(async () => "blob-oid"),
		writeTree: vi.fn(async () => "tree-oid"),
		writeCommit: vi.fn(async () => "commit-oid"),
		writeRef: vi.fn(async () => undefined),
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

describe("writeCommitDirect parent resolution", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("still succeeds as a first commit on a NotFoundError parent ref", async () => {
		const git = (await import("isomorphic-git")).default;
		(git.resolveRef as ReturnType<typeof vi.fn>).mockRejectedValue(
			notFoundError(),
		);

		const { createCommit } = await import("../git-operations-iso");

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

	it("propagates a non-NotFoundError instead of treating it as an empty repo", async () => {
		const git = (await import("isomorphic-git")).default;
		(git.resolveRef as ReturnType<typeof vi.fn>).mockRejectedValue(
			new Error("R2 timeout"),
		);

		const { createCommit } = await import("../git-operations-iso");

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
