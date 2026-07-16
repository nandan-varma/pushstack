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

vi.mock("../git-manager-iso", () => ({
	getBareRepoOptions: vi.fn(() => ({ fs: {}, gitdir: "/fake/gitdir" })),
}));

vi.mock("../git-repo-storage", () => ({
	withRepositoryLock: vi.fn(
		async (_owner: string, _repo: string, fn: () => Promise<unknown>) => fn(),
	),
	withRepositoryWorktree: mockWithRepositoryWorktree,
	getRepoOptions: vi.fn(() => ({ fs: {}, gitdir: "/fake/gitdir" })),
	qualifyBranchRef: (ref: string) => {
		if (ref.startsWith("refs/") || ref === "HEAD" || /^[0-9a-f]{40}$/.test(ref))
			return ref;
		return `refs/heads/${ref}`;
	},
}));

vi.mock("../git-commit-write", () => ({
	createCommit: vi.fn(() => Promise.resolve("resolved-commit-sha")),
}));

vi.mock("../perf-log", () => ({
	logError: vi.fn(),
	perfNote: vi.fn(),
	perfStep: vi.fn((_label: string, fn: () => Promise<unknown>) => fn()),
}));

function notFoundError(message = "not found") {
	const err = new Error(message);
	(err as { code?: string }).code = "NotFoundError";
	return err;
}

describe("branch name guard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const traversalBranchName =
		"refs/heads/../../other-owner/other-repo/git/refs/heads/main";

	// git.merge/git.commit's internal ref-write (used by mergeBranches'
	// worktree/non-fast-forward path) doesn't validate the ref itself the way
	// git.branch/git.writeRef do — analyzeMerge and mergeBranches must reject
	// a path-traversal branch name before any isomorphic-git call runs.
	it("analyzeMerge rejects a path-traversal sourceBranch", async () => {
		const git = (await import("isomorphic-git")).default;
		const { analyzeMerge } = await import("../git-merge-iso");

		await expect(
			analyzeMerge("owner", "repo", traversalBranchName, "main"),
		).rejects.toThrow("Invalid branch name");
		expect(git.resolveRef).not.toHaveBeenCalled();
	});

	it("analyzeMerge rejects a path-traversal targetBranch", async () => {
		const git = (await import("isomorphic-git")).default;
		const { analyzeMerge } = await import("../git-merge-iso");

		await expect(
			analyzeMerge("owner", "repo", "feature", traversalBranchName),
		).rejects.toThrow("Invalid branch name");
		expect(git.resolveRef).not.toHaveBeenCalled();
	});

	it("mergeBranches rejects a path-traversal sourceBranch without touching the filesystem", async () => {
		const git = (await import("isomorphic-git")).default;
		const { mergeBranches } = await import("../git-merge-iso");

		await expect(
			mergeBranches("owner", "repo", traversalBranchName, "main"),
		).rejects.toThrow("Invalid branch name");
		expect(git.resolveRef).not.toHaveBeenCalled();
		expect(mockWithRepositoryWorktree).not.toHaveBeenCalled();
	});

	it("mergeBranches rejects a path-traversal targetBranch without touching the filesystem", async () => {
		const git = (await import("isomorphic-git")).default;
		const { mergeBranches } = await import("../git-merge-iso");

		await expect(
			mergeBranches("owner", "repo", "feature", traversalBranchName),
		).rejects.toThrow("Invalid branch name");
		expect(git.resolveRef).not.toHaveBeenCalled();
		expect(mockWithRepositoryWorktree).not.toHaveBeenCalled();
	});
});

describe("analyzeMerge", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns cannot-merge for a NotFoundError (deleted branch)", async () => {
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

	it("returns canMerge:true with fastForward:true when source is descendant of target", async () => {
		const git = (await import("isomorphic-git")).default;
		(git.resolveRef as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce("source-sha")
			.mockResolvedValueOnce("target-sha");
		(git.isDescendent as ReturnType<typeof vi.fn>).mockResolvedValue(true);

		const { analyzeMerge } = await import("../git-merge-iso");
		const result = await analyzeMerge("owner", "repo", "feature", "main");

		expect(result).toEqual({
			canMerge: true,
			hasConflicts: false,
			conflictingFiles: [],
			fastForward: true,
		});
	});

	it("returns canMerge:true with fastForward:false when branches diverged", async () => {
		const git = (await import("isomorphic-git")).default;
		(git.resolveRef as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce("source-sha")
			.mockResolvedValueOnce("target-sha");
		(git.isDescendent as ReturnType<typeof vi.fn>).mockResolvedValue(false);

		const { analyzeMerge } = await import("../git-merge-iso");
		const result = await analyzeMerge("owner", "repo", "feature", "main");

		expect(result).toEqual({
			canMerge: true,
			hasConflicts: false,
			conflictingFiles: [],
			fastForward: false,
		});
	});
});

describe("mergeBranches fast-forward (R2 configured)", () => {
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

	it("performs a fast-forward merge when source is descendant of target", async () => {
		const git = (await import("isomorphic-git")).default;
		(git.resolveRef as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce("source-sha")
			.mockResolvedValueOnce("target-sha");
		(git.isDescendent as ReturnType<typeof vi.fn>).mockResolvedValue(true);
		(git.writeRef as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

		const { mergeBranches } = await import("../git-merge-iso");
		const result = await mergeBranches("owner", "repo", "feature", "main");

		expect(result).toEqual({ success: true, commitSha: "source-sha" });
		expect(git.writeRef).toHaveBeenCalledWith(
			expect.objectContaining({
				ref: "refs/heads/main",
				value: "source-sha",
				force: true,
			}),
		);
	});

	it("falls through to worktree path when not fast-forward", async () => {
		const git = (await import("isomorphic-git")).default;
		(git.resolveRef as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce("source-sha")
			.mockResolvedValueOnce("target-sha");
		(git.isDescendent as ReturnType<typeof vi.fn>).mockResolvedValue(false);

		mockWithRepositoryWorktree.mockResolvedValue("merge-sha");

		const { mergeBranches } = await import("../git-merge-iso");
		const result = await mergeBranches("owner", "repo", "feature", "main");

		expect(result).toEqual({ success: true, commitSha: "merge-sha" });
		expect(mockWithRepositoryWorktree).toHaveBeenCalled();
		expect(git.writeRef).not.toHaveBeenCalled();
	});
});

describe("mergeBranches non-fast-forward (worktree)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockIsR2Configured.mockReturnValue(false);
	});

	it("returns structured conflict result for MergeConflictError", async () => {
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

	it("returns default conflict message when MergeConflictError has no filepaths", async () => {
		const conflictError = new Error("merge conflict") as Error & {
			code: string;
			data?: { filepaths?: string[] };
		};
		conflictError.code = "MergeConflictError";
		conflictError.data = {};
		mockWithRepositoryWorktree.mockRejectedValue(conflictError);

		const { mergeBranches } = await import("../git-merge-iso");
		const result = await mergeBranches("owner", "repo", "feature", "main");

		expect(result).toEqual({
			success: false,
			conflicts: ["Merge conflicts detected"],
		});
	});

	it("propagates a non-conflict error instead of mislabeling it", async () => {
		mockWithRepositoryWorktree.mockRejectedValue(
			new Error("R2 object read failed"),
		);

		const { mergeBranches } = await import("../git-merge-iso");

		await expect(
			mergeBranches("owner", "repo", "feature", "main"),
		).rejects.toThrow("R2 object read failed");
	});

	it("returns success with commitSha from worktree merge", async () => {
		mockWithRepositoryWorktree.mockResolvedValue("new-merge-sha");

		const { mergeBranches } = await import("../git-merge-iso");
		const result = await mergeBranches("owner", "repo", "feature", "main");

		expect(result).toEqual({ success: true, commitSha: "new-merge-sha" });
	});

	it("passes custom message and author options through to worktree merge", async () => {
		mockWithRepositoryWorktree.mockResolvedValue("merge-sha");

		const { mergeBranches } = await import("../git-merge-iso");
		await mergeBranches("owner", "repo", "feature", "main", {
			message: "Custom merge message",
			authorName: "Test Author",
			authorEmail: "test@example.com",
		});

		expect(mockWithRepositoryWorktree).toHaveBeenCalled();
	});
});

describe("resolveConflicts", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("delegates to createCommit when R2 is configured", async () => {
		mockIsR2Configured.mockReturnValue(true);
		const { createCommit } = await import("../git-commit-write");
		const { resolveConflicts } = await import("../git-merge-iso");

		await resolveConflicts("owner", "repo", [
			{ path: "file.ts", content: "resolved" },
		]);

		expect(createCommit).toHaveBeenCalledWith(
			"owner",
			"repo",
			"Resolve merge conflicts",
			[{ path: "file.ts", content: "resolved" }],
			undefined,
			undefined,
			"main",
			undefined,
		);
	});

	it("uses withRepositoryWorktree when R2 is not configured", async () => {
		mockIsR2Configured.mockReturnValue(false);
		const { resolveConflicts } = await import("../git-merge-iso");

		await resolveConflicts("owner", "repo", [
			{ path: "a.txt", content: "content-a" },
			{ path: "b.txt", content: "content-b" },
		]);

		expect(mockWithRepositoryWorktree).toHaveBeenCalled();
	});

	it("passes ownerDbId through when R2 is configured", async () => {
		mockIsR2Configured.mockReturnValue(true);
		const { createCommit } = await import("../git-commit-write");
		const { resolveConflicts } = await import("../git-merge-iso");

		await resolveConflicts(
			"owner",
			"repo",
			[{ path: "f.txt", content: "c" }],
			"owner-db-id",
		);

		expect(createCommit).toHaveBeenCalledWith(
			"owner",
			"repo",
			"Resolve merge conflicts",
			[{ path: "f.txt", content: "c" }],
			undefined,
			undefined,
			"main",
			"owner-db-id",
		);
	});
});
