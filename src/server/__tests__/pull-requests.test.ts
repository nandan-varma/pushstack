/**
 * Tests for pull request server functions (access control, status
 * transitions, and the merge flow's failure branches).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockUser } from "@/test/mock-routes";

// Allow calling createServerFn handlers directly in tests
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => ({
		validator: (validateFn: (data: unknown) => unknown) => ({
			handler:
				(handlerFn: (args: { data: unknown }) => unknown) =>
				async (args?: { data?: unknown }) =>
					handlerFn({ data: validateFn(args?.data ?? args) }),
		}),
		handler: (handlerFn: (args: unknown) => unknown) => (args: unknown) =>
			handlerFn(args),
	}),
}));

vi.mock("../session", () => ({
	getCurrentUser: vi.fn(() => Promise.resolve(mockUser)),
	getCurrentUserOptional: vi.fn(() => Promise.resolve(mockUser)),
}));

vi.mock("../repo-access", () => ({
	requireWriteAccess: vi.fn(() => Promise.resolve()),
	requireReadAccess: vi.fn(() => Promise.resolve()),
	getAccessForRepository: vi.fn(() => Promise.resolve({ canRead: true })),
	canWriteRepo: vi.fn(() => Promise.resolve(true)),
	canMergePullRequest: vi.fn(() => Promise.resolve(true)),
}));

const analyzeMergeMock = vi.fn(
	(): Promise<{ canMerge: boolean; hasConflicts?: boolean }> =>
		Promise.resolve({ canMerge: true }),
);
const mergeBranchesMock = vi.fn(
	(): Promise<{
		success: boolean;
		commitSha?: string;
		conflicts?: string[];
	}> => Promise.resolve({ success: true, commitSha: "abc123" }),
);
vi.mock("../git-merge-iso", () => ({
	analyzeMerge: analyzeMergeMock,
	mergeBranches: mergeBranchesMock,
}));

vi.mock("../git-storage-naming", () => ({
	getRepoStorageCoordinates: vi.fn(() => ({ ownerKey: "owner-key" })),
}));

const mockDb = {
	insert: vi.fn(() => ({
		values: vi.fn(() => ({
			returning: vi.fn(() => [{ id: 1, title: "Test PR" }]),
		})),
	})),
	update: vi.fn(() => ({
		set: vi.fn(() => ({
			where: vi.fn(() => ({
				returning: vi.fn(() => [{ id: 1, title: "Updated", status: "open" }]),
			})),
		})),
	})),
	select: vi.fn(() => ({
		from: vi.fn(() => ({
			where: vi.fn(() => Promise.resolve([{ id: 1 }, { id: 2 }])),
		})),
	})),
	query: {
		pullRequests: {
			findFirst: vi.fn(),
			findMany: vi.fn(() => Promise.resolve([])),
		},
	},
};

vi.mock("../../db", () => ({ db: mockDb }));

const mockPr = {
	id: 1,
	repoId: 5,
	authorId: "someone-else",
	status: "open",
	title: "Add feature",
	sourceBranch: "feature",
	targetBranch: "main",
	repository: {
		id: 5,
		name: "repo",
		ownerId: "owner-user",
		owner: { id: "owner-user", username: "owner", email: "owner@example.com" },
	},
};

describe("createPullRequest", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("rejects when the caller lacks write access", async () => {
		const { requireWriteAccess } = await import("../repo-access");
		(requireWriteAccess as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error("No write access to repository"),
		);

		const { createPullRequest } = await import("../pull-requests");

		await expect(
			createPullRequest({
				data: {
					repoId: 1,
					title: "PR",
					sourceBranchName: "feature",
					targetBranchName: "main",
				},
			}),
		).rejects.toThrow("No write access");
		expect(mockDb.insert).not.toHaveBeenCalled();
	});

	it("rejects when source and target branches are the same", async () => {
		const { createPullRequest } = await import("../pull-requests");

		await expect(
			createPullRequest({
				data: {
					repoId: 1,
					title: "PR",
					sourceBranchName: "main",
					targetBranchName: "main",
				},
			}),
		).rejects.toThrow("Cannot create PR from same branch");
		expect(mockDb.insert).not.toHaveBeenCalled();
	});

	it("creates the PR and logs activity when authorized", async () => {
		const { createPullRequest } = await import("../pull-requests");

		const result = await createPullRequest({
			data: {
				repoId: 1,
				title: "PR",
				sourceBranchName: "feature",
				targetBranchName: "main",
			},
		});

		expect(result.title).toBe("Test PR");
		expect(mockDb.insert).toHaveBeenCalledTimes(2); // pr + activity
	});
});

describe("getPullRequest", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("throws when the PR does not exist", async () => {
		mockDb.query.pullRequests.findFirst.mockResolvedValueOnce(undefined);

		const { getPullRequest } = await import("../pull-requests");

		await expect(getPullRequest({ data: { prId: 999 } })).rejects.toThrow(
			"Pull request not found",
		);
	});

	it("throws access denied when the caller cannot read the repo", async () => {
		mockDb.query.pullRequests.findFirst.mockResolvedValueOnce(mockPr);
		const { getAccessForRepository } = await import("../repo-access");
		(getAccessForRepository as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			canRead: false,
		});

		const { getPullRequest } = await import("../pull-requests");

		await expect(getPullRequest({ data: { prId: 1 } })).rejects.toThrow(
			"Access denied",
		);
	});
});

describe("updatePullRequest", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("throws when the PR does not exist", async () => {
		mockDb.query.pullRequests.findFirst.mockResolvedValueOnce(undefined);

		const { updatePullRequest } = await import("../pull-requests");

		await expect(
			updatePullRequest({ data: { prId: 999, title: "New" } }),
		).rejects.toThrow("Pull request not found");
	});

	it("rejects a non-author without write access", async () => {
		mockDb.query.pullRequests.findFirst.mockResolvedValueOnce(mockPr);
		const { canWriteRepo } = await import("../repo-access");
		(canWriteRepo as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

		const { updatePullRequest } = await import("../pull-requests");

		await expect(
			updatePullRequest({ data: { prId: 1, title: "New" } }),
		).rejects.toThrow("Access denied");
		expect(mockDb.update).not.toHaveBeenCalled();
	});

	it("allows the author to edit without needing write access", async () => {
		mockDb.query.pullRequests.findFirst.mockResolvedValueOnce({
			...mockPr,
			authorId: mockUser.id,
		});
		const { canWriteRepo } = await import("../repo-access");
		const canWriteRepoMock = canWriteRepo as ReturnType<typeof vi.fn>;

		const { updatePullRequest } = await import("../pull-requests");

		const result = await updatePullRequest({
			data: { prId: 1, title: "New" },
		});
		expect(result.title).toBe("Updated");
		expect(canWriteRepoMock).not.toHaveBeenCalled();
	});
});

describe("mergePullRequest", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		analyzeMergeMock.mockResolvedValue({ canMerge: true });
		mergeBranchesMock.mockResolvedValue({
			success: true,
			commitSha: "abc123",
		});
	});

	it("throws when the PR does not exist", async () => {
		mockDb.query.pullRequests.findFirst.mockResolvedValueOnce(undefined);

		const { mergePullRequest } = await import("../pull-requests");

		await expect(mergePullRequest({ data: { prId: 999 } })).rejects.toThrow(
			"Pull request not found",
		);
	});

	it("rejects when the caller lacks merge permission", async () => {
		mockDb.query.pullRequests.findFirst.mockResolvedValueOnce(mockPr);
		const { canMergePullRequest } = await import("../repo-access");
		(canMergePullRequest as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			false,
		);

		const { mergePullRequest } = await import("../pull-requests");

		await expect(mergePullRequest({ data: { prId: 1 } })).rejects.toThrow(
			"Access denied",
		);
		expect(mergeBranchesMock).not.toHaveBeenCalled();
	});

	it("rejects merging a PR that is not open", async () => {
		mockDb.query.pullRequests.findFirst.mockResolvedValueOnce({
			...mockPr,
			status: "merged",
		});

		const { mergePullRequest } = await import("../pull-requests");

		await expect(mergePullRequest({ data: { prId: 1 } })).rejects.toThrow(
			"Pull request is not open",
		);
		expect(mergeBranchesMock).not.toHaveBeenCalled();
	});

	it("rejects when analyzeMerge reports conflicts", async () => {
		mockDb.query.pullRequests.findFirst.mockResolvedValueOnce(mockPr);
		analyzeMergeMock.mockResolvedValueOnce({
			canMerge: false,
			hasConflicts: true,
		});

		const { mergePullRequest } = await import("../pull-requests");

		await expect(mergePullRequest({ data: { prId: 1 } })).rejects.toThrow(
			"Cannot merge",
		);
		expect(mergeBranchesMock).not.toHaveBeenCalled();
		expect(mockDb.update).not.toHaveBeenCalled();
	});

	it("rejects when mergeBranches fails", async () => {
		mockDb.query.pullRequests.findFirst.mockResolvedValueOnce(mockPr);
		mergeBranchesMock.mockResolvedValueOnce({
			success: false,
			conflicts: ["file.txt"],
		});

		const { mergePullRequest } = await import("../pull-requests");

		await expect(mergePullRequest({ data: { prId: 1 } })).rejects.toThrow(
			"Merge failed",
		);
		expect(mockDb.update).not.toHaveBeenCalled();
	});

	it("updates status, records the merge commit, and logs activity on success", async () => {
		mockDb.query.pullRequests.findFirst.mockResolvedValueOnce(mockPr);

		const { mergePullRequest } = await import("../pull-requests");

		const result = await mergePullRequest({ data: { prId: 1 } });

		expect(result).toEqual({ success: true, commitSha: "abc123" });
		expect(mockDb.update).toHaveBeenCalledTimes(1);
		expect(mockDb.insert).toHaveBeenCalledTimes(1); // activity log
	});
});

describe("getPullRequests", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("rejects when the caller lacks read access", async () => {
		const { requireReadAccess } = await import("../repo-access");
		(requireReadAccess as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error("Access denied"),
		);

		const { getPullRequests } = await import("../pull-requests");
		await expect(getPullRequests({ data: { repoId: 1 } })).rejects.toThrow(
			"Access denied",
		);
	});

	it("returns open PRs by default when the caller can read", async () => {
		mockDb.query.pullRequests.findMany.mockResolvedValueOnce([
			{ id: 1, title: "PR one", status: "open", author: { name: "Alice" } },
		]);

		const { getPullRequests } = await import("../pull-requests");
		const result = await getPullRequests({ data: { repoId: 5 } });

		expect(result).toHaveLength(1);
		expect(result[0].title).toBe("PR one");
	});

	it("passes status filter to the query", async () => {
		mockDb.query.pullRequests.findMany.mockResolvedValueOnce([]);

		const { getPullRequests } = await import("../pull-requests");
		await getPullRequests({ data: { repoId: 5, status: "merged" } });

		expect(mockDb.query.pullRequests.findMany).toHaveBeenCalled();
	});
});

describe("getPullRequestNumbers", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("rejects when the caller lacks read access", async () => {
		const { requireReadAccess } = await import("../repo-access");
		(requireReadAccess as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error("Access denied"),
		);

		const { getPullRequestNumbers } = await import("../pull-requests");
		await expect(
			getPullRequestNumbers({ data: { repoId: 1 } }),
		).rejects.toThrow("Access denied");
	});

	it("returns PR ids for the repo when the caller can read", async () => {
		mockDb.select.mockReturnValueOnce({
			from: vi.fn(() => ({
				where: vi.fn(() =>
					Promise.resolve([{ id: 10 }, { id: 20 }, { id: 30 }]),
				),
			})),
		});

		const { getPullRequestNumbers } = await import("../pull-requests");
		const result = await getPullRequestNumbers({ data: { repoId: 5 } });

		expect(result).toEqual([10, 20, 30]);
	});

	it("returns an empty array when there are no pull requests", async () => {
		mockDb.select.mockReturnValueOnce({
			from: vi.fn(() => ({
				where: vi.fn(() => Promise.resolve([])),
			})),
		});

		const { getPullRequestNumbers } = await import("../pull-requests");
		const result = await getPullRequestNumbers({ data: { repoId: 99 } });

		expect(result).toEqual([]);
	});
});
