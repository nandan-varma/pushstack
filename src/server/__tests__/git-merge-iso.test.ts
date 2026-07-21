import nodeFs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockIsR2Configured = vi.hoisted(() => vi.fn(() => true));
const mockWithRepositoryWorktree = vi.hoisted(() => vi.fn());

vi.mock("#/lib/r2", () => ({
	isR2Configured: mockIsR2Configured,
}));

// Mock only the functions git-merge-iso.ts calls, but keep the real `Errors`
// namespace — mergeBranches's conflict handling checks
// `instanceof Errors.MergeConflictError`, so the test needs the actual class
// isomorphic-git's own `git.merge` throws, not a stand-in.
vi.mock("isomorphic-git", async () => {
	const actual =
		await vi.importActual<typeof import("isomorphic-git")>("isomorphic-git");
	return {
		default: {
			resolveRef: vi.fn(),
			isDescendent: vi.fn(),
			writeRef: vi.fn(),
			merge: vi.fn(),
		},
		Errors: actual.Errors,
	};
});

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

// analyzeMerge delegates to git-edge's own analyzeMerge, which
// — under pnpm's isolated node_modules layout — resolves its own internal
// "isomorphic-git" import outside this file's `vi.mock("isomorphic-git")`
// interception (confirmed empirically: mocking it here doesn't reach
// git-edge's copy). So these tests exercise analyzeMerge against a real
// temporary bare repo instead of mocking isomorphic-git — git-edge has its
// own unit tests for analyzeMerge's own logic (including the
// NotFoundError-vs-everything-else distinction); these confirm pushstack's
// wrapper wires branch qualification and the MergeAnalysis shape correctly
// end-to-end.
describe("analyzeMerge", () => {
	let tmpDir: string;
	let realGit: typeof import("isomorphic-git").default;

	const author = {
		name: "Test",
		email: "test@example.com",
		timestamp: 1000000000,
		timezoneOffset: 0,
	};

	beforeEach(async () => {
		vi.clearAllMocks();
		realGit = (
			await vi.importActual<typeof import("isomorphic-git")>("isomorphic-git")
		).default;
		tmpDir = nodeFs.mkdtempSync(path.join(os.tmpdir(), "git-merge-iso-test-"));
		await realGit.init({
			fs: nodeFs,
			dir: tmpDir,
			bare: true,
			defaultBranch: "main",
		});

		const { getRepoOptions } = await import("../git-repo-storage");
		vi.mocked(getRepoOptions).mockResolvedValue({
			fs: nodeFs,
			gitdir: tmpDir,
			cache: {},
		} as unknown as Awaited<ReturnType<typeof getRepoOptions>>);
	});

	afterEach(() => {
		nodeFs.rmSync(tmpDir, { recursive: true, force: true });
	});

	async function commitTo(
		branch: string,
		content: string,
		parentOid?: string,
	): Promise<string> {
		const blobOid = await realGit.writeBlob({
			fs: nodeFs,
			gitdir: tmpDir,
			blob: new TextEncoder().encode(content),
		});
		const treeOid = await realGit.writeTree({
			fs: nodeFs,
			gitdir: tmpDir,
			tree: [{ path: "f.txt", mode: "100644", type: "blob", oid: blobOid }],
		});
		const commitOid = await realGit.writeCommit({
			fs: nodeFs,
			gitdir: tmpDir,
			commit: {
				message: content,
				tree: treeOid,
				parent: parentOid ? [parentOid] : [],
				author,
				committer: author,
			},
		});
		await realGit.writeRef({
			fs: nodeFs,
			gitdir: tmpDir,
			ref: `refs/heads/${branch}`,
			value: commitOid,
			force: true,
		});
		return commitOid;
	}

	it("returns cannot-merge for a NotFoundError (deleted branch)", async () => {
		await commitTo("main", "main content");

		const { analyzeMerge } = await import("../git-merge-iso");
		const result = await analyzeMerge("owner", "repo", "feature", "main");

		expect(result).toEqual({
			canMerge: false,
			hasConflicts: true,
			conflictingFiles: [],
			fastForward: false,
		});
	});

	// "Propagates a non-NotFoundError instead of swallowing it" is covered by
	// git-edge's own test suite (test/merge.test.ts), which
	// spies on isomorphic-git's isDescendent directly — not reproducible
	// here: git-edge resolves its own "isomorphic-git" copy under pnpm's
	// isolated node_modules layout, a genuinely different module instance
	// than the one this file imports, so spying/mocking it from pushstack's
	// side never reaches git-edge's internal call.

	it("returns canMerge:true with fastForward:true when source is descendant of target", async () => {
		const mainOid = await commitTo("main", "main content");
		await commitTo("feature", "feature content", mainOid);

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
		const mainOid = await commitTo("main", "main content");
		await commitTo("feature", "feature content", mainOid);
		await commitTo("main", "main content 2", mainOid);

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

// mergeBranches's R2 fast-forward path now delegates to
// git-fs-s3/ops's fastForwardMerge, which — like
// analyzeMerge — resolves its own isomorphic-git copy under pnpm's isolated
// node_modules layout, so mocking isomorphic-git from this file doesn't
// reach its internal calls (same issue as analyzeMerge above). Coverage:
// - The FF-success and falls-through-when-diverged cases are exercised
//   directly on fastForwardMerge/analyzeMerge in git-fs-s3's own
//   test/ops.test.ts ("analyzes and fast-forwards merges").
// - fastForwardMerge has no try/catch of its own — any git.resolveRef
//   failure (NotFoundError or otherwise) always propagates untouched, so
//   there's no swallowing behavior left to regression-test here.
// - The end-to-end FF and non-FF-falls-through-to-worktree paths through
//   mergeBranches itself are covered against a real repo in
//   git-integration.test.ts's "mergeBranches" suite.

describe("mergeBranches non-fast-forward (worktree)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockIsR2Configured.mockReturnValue(false);
	});

	it("returns structured conflict result for MergeConflictError", async () => {
		const { Errors } = await import("isomorphic-git");
		const conflictError = new Errors.MergeConflictError(
			["src/a.ts", "src/b.ts"],
			[],
			[],
			[],
		);
		mockWithRepositoryWorktree.mockRejectedValue(conflictError);

		const { mergeBranches } = await import("../git-merge-iso");
		const result = await mergeBranches("owner", "repo", "feature", "main");

		expect(result).toEqual({
			success: false,
			conflicts: ["src/a.ts", "src/b.ts"],
		});
	});

	it("returns default conflict message when MergeConflictError has no filepaths", async () => {
		const { Errors } = await import("isomorphic-git");
		const conflictError = new Errors.MergeConflictError([], [], [], []);
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
