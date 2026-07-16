/**
 * Tests for git-branch-ops.ts's branch-name guard — git.deleteBranch and the
 * resolveRef read in checkoutBranch don't validate ref names internally the
 * way git.branch does (see isSafeBranchName's comment in git-ref-name.ts),
 * so createBranch/deleteBranch/checkoutBranch must reject an unsafe name
 * themselves before any isomorphic-git call runs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("#/lib/r2", () => ({
	isR2Configured: vi.fn(() => true),
}));

vi.mock("isomorphic-git", () => ({
	default: {
		listBranches: vi.fn(() => Promise.resolve([])),
		currentBranch: vi.fn(() => Promise.resolve(null)),
		resolveRef: vi.fn(() => Promise.resolve("a".repeat(40))),
		branch: vi.fn(() => Promise.resolve()),
		deleteBranch: vi.fn(() => Promise.resolve()),
	},
}));

vi.mock("../git-repo-storage", () => ({
	getRepoOptions: vi.fn(() =>
		Promise.resolve({ fs: {}, gitdir: "/fake/gitdir" }),
	),
	syncRepositoryToR2: vi.fn(() => Promise.resolve()),
	withRepositoryLock: vi.fn(
		async (_owner: string, _repo: string, fn: () => Promise<unknown>) => fn(),
	),
}));

const traversalNames = [
	"../../other-owner/other-repo/git/refs/heads/main",
	"refs/heads/../../other-owner/other-repo/git/refs/heads/main",
	"refs/heads/main",
	"..",
	"HEAD",
];

describe("createBranch", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it.each(
		traversalNames,
	)("rejects branch name %s without touching git", async (branchName) => {
		const git = (await import("isomorphic-git")).default;
		const { createBranch } = await import("../git-branch-ops");

		await expect(
			createBranch("owner", "repo", branchName, "main"),
		).rejects.toThrow("Invalid branch name");
		expect(git.resolveRef).not.toHaveBeenCalled();
		expect(git.branch).not.toHaveBeenCalled();
	});

	it.each(
		traversalNames,
	)("rejects startPoint %s without touching git", async (startPoint) => {
		const git = (await import("isomorphic-git")).default;
		const { createBranch } = await import("../git-branch-ops");

		await expect(
			createBranch("owner", "repo", "feature", startPoint),
		).rejects.toThrow("Invalid branch name");
		expect(git.resolveRef).not.toHaveBeenCalled();
		expect(git.branch).not.toHaveBeenCalled();
	});

	it("accepts a well-formed branch name and start point", async () => {
		const git = (await import("isomorphic-git")).default;
		const { createBranch } = await import("../git-branch-ops");

		await createBranch("owner", "repo", "feature", "main");
		expect(git.branch).toHaveBeenCalled();
	});
});

describe("deleteBranch", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it.each(
		traversalNames,
	)("rejects branch name %s without touching git", async (branchName) => {
		const git = (await import("isomorphic-git")).default;
		const { deleteBranch } = await import("../git-branch-ops");

		await expect(deleteBranch("owner", "repo", branchName)).rejects.toThrow(
			"Invalid branch name",
		);
		expect(git.deleteBranch).not.toHaveBeenCalled();
	});

	it("accepts a well-formed branch name", async () => {
		const git = (await import("isomorphic-git")).default;
		const { deleteBranch } = await import("../git-branch-ops");

		await deleteBranch("owner", "repo", "feature");
		expect(git.deleteBranch).toHaveBeenCalled();
	});
});

describe("checkoutBranch", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it.each(
		traversalNames,
	)("rejects branch name %s without touching git", async (branchName) => {
		const git = (await import("isomorphic-git")).default;
		const { checkoutBranch } = await import("../git-branch-ops");

		await expect(checkoutBranch("owner", "repo", branchName)).rejects.toThrow(
			"Invalid branch name",
		);
		expect(git.resolveRef).not.toHaveBeenCalled();
	});

	it("accepts a well-formed branch name", async () => {
		const git = (await import("isomorphic-git")).default;
		const { checkoutBranch } = await import("../git-branch-ops");

		await checkoutBranch("owner", "repo", "feature");
		expect(git.resolveRef).toHaveBeenCalled();
	});
});
