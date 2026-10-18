import { createGitFs, MemoryObjectStore } from "git-fs-s3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWithRepositoryLock = vi.hoisted(() =>
	vi.fn(async (_owner: string, _repo: string, fn: () => Promise<unknown>) =>
		fn(),
	),
);
const mockThreeWayMerge = vi.hoisted(() => vi.fn());
const mockFastForwardMerge = vi.hoisted(() => vi.fn());

// Only threeWayMerge is mocked — GitMergeConflictError stays the real class,
// since mergeBranches's conflict handling checks `instanceof
// GitMergeConflictError`.
vi.mock("git-edge", async (importOriginal) => {
	const actual = await importOriginal<typeof import("git-edge")>();
	return { ...actual, threeWayMerge: mockThreeWayMerge };
});

// Only fastForwardMerge is mocked — analyzeMerge (imported here as
// opsAnalyzeMerge) stays real, since the "analyzeMerge" describe block below
// exercises it against a real temporary repo, unmocked.
vi.mock("git-fs-s3/ops", async (importOriginal) => {
	const actual = await importOriginal<typeof import("git-fs-s3/ops")>();
	return { ...actual, fastForwardMerge: mockFastForwardMerge };
});

// Stand-ins only to assert the branch-name guard runs before any git call.
vi.mock("isomorphic-git", () => ({
	default: {
		resolveRef: vi.fn(),
		isDescendent: vi.fn(),
		writeRef: vi.fn(),
	},
}));

vi.mock("../git-manager-iso", () => ({
	getBareRepoOptions: vi.fn(() => ({ fs: {}, gitdir: "/fake/gitdir" })),
}));

vi.mock("../git-repo-storage", () => ({
	withRepositoryLock: mockWithRepositoryLock,
	getRepoOptions: vi.fn(() => ({ fs: {}, gitdir: "/fake/gitdir" })),
	qualifyBranchRef: (ref: string) => {
		if (ref.startsWith("refs/") || ref === "HEAD" || /^[0-9a-f]{40}$/.test(ref))
			return ref;
		return `refs/heads/${ref}`;
	},
}));

// Post-merge consolidation is exercised by git-repack.test.ts.
vi.mock("../git-http-iso", () => ({
	repackIfNeededUnlocked: vi.fn(async () => undefined),
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

	// A merge's ref write doesn't validate the ref itself the way
	// git.branch/git.writeRef do — analyzeMerge and mergeBranches must reject
	// a path-traversal branch name before any git call or lock runs.
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

	it("mergeBranches rejects a path-traversal sourceBranch without touching storage", async () => {
		const git = (await import("isomorphic-git")).default;
		const { mergeBranches } = await import("../git-merge-iso");

		await expect(
			mergeBranches("owner", "repo", traversalBranchName, "main"),
		).rejects.toThrow("Invalid branch name");
		expect(git.resolveRef).not.toHaveBeenCalled();
		expect(mockWithRepositoryLock).not.toHaveBeenCalled();
	});

	it("mergeBranches rejects a path-traversal targetBranch without touching storage", async () => {
		const git = (await import("isomorphic-git")).default;
		const { mergeBranches } = await import("../git-merge-iso");

		await expect(
			mergeBranches("owner", "repo", "feature", traversalBranchName),
		).rejects.toThrow("Invalid branch name");
		expect(git.resolveRef).not.toHaveBeenCalled();
		expect(mockWithRepositoryLock).not.toHaveBeenCalled();
	});
});

// analyzeMerge delegates to git-edge's own analyzeMerge, which
// — under pnpm's isolated node_modules layout — resolves its own internal
// "isomorphic-git" import outside this file's `vi.mock("isomorphic-git")`
// interception (confirmed empirically: mocking it here doesn't reach
// git-edge's copy). So these tests exercise analyzeMerge against a real
// in-memory bare repo instead of mocking isomorphic-git — git-edge has its
// own unit tests for analyzeMerge's own logic (including the
// NotFoundError-vs-everything-else distinction); these confirm pushstack's
// wrapper wires branch qualification and the MergeAnalysis shape correctly
// end-to-end.
describe("analyzeMerge", () => {
	let repo: { fs: ReturnType<typeof createGitFs>; gitdir: string };
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
		repo = { fs: createGitFs(new MemoryObjectStore()), gitdir: "repo" };
		await realGit.init({
			...repo,
			dir: repo.gitdir,
			bare: true,
			defaultBranch: "main",
		});

		const { getRepoOptions } = await import("../git-repo-storage");
		vi.mocked(getRepoOptions).mockReturnValue({
			...repo,
			cache: {},
		} as unknown as ReturnType<typeof getRepoOptions>);
	});

	async function commitTo(
		branch: string,
		content: string,
		parentOid?: string,
	): Promise<string> {
		const blobOid = await realGit.writeBlob({
			...repo,
			blob: new TextEncoder().encode(content),
		});
		const treeOid = await realGit.writeTree({
			...repo,
			tree: [{ path: "f.txt", mode: "100644", type: "blob", oid: blobOid }],
		});
		const commitOid = await realGit.writeCommit({
			...repo,
			commit: {
				message: content,
				tree: treeOid,
				parent: parentOid ? [parentOid] : [],
				author,
				committer: author,
			},
		});
		await realGit.writeRef({
			...repo,
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

describe("mergeBranches (object-level, worktree-free)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockWithRepositoryLock.mockImplementation(
			async (_owner: string, _repo: string, fn: () => Promise<unknown>) => fn(),
		);
	});

	it("returns the fast-forward result directly without calling threeWayMerge", async () => {
		mockFastForwardMerge.mockResolvedValue({
			success: true,
			commitSha: "ff-sha",
		});

		const { mergeBranches } = await import("../git-merge-iso");
		const result = await mergeBranches("owner", "repo", "feature", "main");

		expect(result).toEqual({ success: true, commitSha: "ff-sha" });
		expect(mockThreeWayMerge).not.toHaveBeenCalled();
	});

	it("falls through to threeWayMerge when fastForwardMerge returns null", async () => {
		mockFastForwardMerge.mockResolvedValue(null);
		mockThreeWayMerge.mockResolvedValue({ commitOid: "merge-sha" });

		const { mergeBranches } = await import("../git-merge-iso");
		const result = await mergeBranches("owner", "repo", "feature", "main");

		expect(result).toEqual({ success: true, commitSha: "merge-sha" });
	});

	it("qualifies refs and passes message/author options through to threeWayMerge", async () => {
		mockFastForwardMerge.mockResolvedValue(null);
		mockThreeWayMerge.mockResolvedValue({ commitOid: "merge-sha" });

		const { mergeBranches } = await import("../git-merge-iso");
		await mergeBranches("owner", "repo", "feature", "main", {
			message: "Custom merge message",
			authorName: "Test Author",
			authorEmail: "test@example.com",
		});

		expect(mockThreeWayMerge).toHaveBeenCalledWith(
			{ fs: {}, gitdir: "/fake/gitdir" },
			"refs/heads/feature",
			"refs/heads/main",
			{
				message: "Custom merge message",
				authorName: "Test Author",
				authorEmail: "test@example.com",
			},
		);
	});

	it("acquires the lock exactly once for the FF-check + merge critical section", async () => {
		mockFastForwardMerge.mockResolvedValue(null);
		mockThreeWayMerge.mockResolvedValue({ commitOid: "merge-sha" });

		const { mergeBranches } = await import("../git-merge-iso");
		await mergeBranches("owner", "repo", "feature", "main");

		expect(mockWithRepositoryLock).toHaveBeenCalledTimes(1);
	});

	it("returns structured conflict result for GitMergeConflictError", async () => {
		const { GitMergeConflictError } = await import("git-edge");
		mockFastForwardMerge.mockResolvedValue(null);
		mockThreeWayMerge.mockRejectedValue(
			new GitMergeConflictError(["src/a.ts", "src/b.ts"]),
		);

		const { mergeBranches } = await import("../git-merge-iso");
		const result = await mergeBranches("owner", "repo", "feature", "main");

		expect(result).toEqual({
			success: false,
			conflicts: ["src/a.ts", "src/b.ts"],
		});
	});

	it("returns default conflict message when GitMergeConflictError has no paths", async () => {
		const { GitMergeConflictError } = await import("git-edge");
		mockFastForwardMerge.mockResolvedValue(null);
		mockThreeWayMerge.mockRejectedValue(new GitMergeConflictError([]));

		const { mergeBranches } = await import("../git-merge-iso");
		const result = await mergeBranches("owner", "repo", "feature", "main");

		expect(result).toEqual({
			success: false,
			conflicts: ["Merge conflicts detected"],
		});
	});

	it("propagates a non-conflict error instead of mislabeling it", async () => {
		mockFastForwardMerge.mockResolvedValue(null);
		mockThreeWayMerge.mockRejectedValue(new Error("R2 object read failed"));

		const { mergeBranches } = await import("../git-merge-iso");

		await expect(
			mergeBranches("owner", "repo", "feature", "main"),
		).rejects.toThrow("R2 object read failed");
	});
});
