/**
 * Tests for issue server functions (access control + status-change branching).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockUser } from "@/test/mock-routes";
import { setupServerFnMock } from "@/test/server-test-utils";

setupServerFnMock();

vi.mock("../session", () => ({
	getCurrentUser: vi.fn(() => Promise.resolve(mockUser)),
	getCurrentUserOptional: vi.fn(() => Promise.resolve(mockUser)),
}));

vi.mock("../repo-access", () => ({
	requireWriteAccess: vi.fn(() => Promise.resolve()),
	requireReadAccess: vi.fn(() => Promise.resolve()),
	getAccessForRepository: vi.fn(() => Promise.resolve({ canRead: true })),
	canWriteRepo: vi.fn(() => Promise.resolve(true)),
}));

const mockDb = {
	insert: vi.fn(() => ({
		values: vi.fn(() => ({
			returning: vi.fn(() => [{ id: 1, title: "Test issue", labels: null }]),
		})),
	})),
	update: vi.fn(() => ({
		set: vi.fn(() => ({
			where: vi.fn(() => ({
				returning: vi.fn(() => [
					{ id: 1, title: "Updated", status: "open", labels: null },
				]),
			})),
		})),
	})),
	select: vi.fn(() => ({
		from: vi.fn(() => ({
			where: vi.fn(() => Promise.resolve([{ id: 1 }, { id: 2 }])),
		})),
	})),
	query: {
		issues: {
			findFirst: vi.fn(),
			findMany: vi.fn((): Promise<unknown[]> => Promise.resolve([])),
		},
	},
};

vi.mock("../../db", () => ({ db: mockDb }));

describe("createIssue", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("rejects when the caller lacks write access", async () => {
		const { requireWriteAccess } = await import("../repo-access");
		(requireWriteAccess as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error("No write access to repository"),
		);

		const { createIssue } = await import("../issues");

		await expect(
			createIssue({ data: { repoId: 1, title: "Bug report" } }),
		).rejects.toThrow("No write access");

		expect(mockDb.insert).not.toHaveBeenCalled();
	});

	it("creates the issue and logs activity when authorized", async () => {
		const { createIssue } = await import("../issues");

		const result = await createIssue({
			data: { repoId: 1, title: "Bug report" },
		});

		expect(result.title).toBe("Test issue");
		// One insert for the issue, one for the activity log.
		expect(mockDb.insert).toHaveBeenCalledTimes(2);
	});
});

describe("getIssues", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("rejects when the caller lacks read access", async () => {
		const { requireReadAccess } = await import("../repo-access");
		(requireReadAccess as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error("Access denied"),
		);

		const { getIssues } = await import("../issues");

		await expect(getIssues({ data: { repoId: 1 } })).rejects.toThrow(
			"Access denied",
		);
		expect(mockDb.query.issues.findMany).not.toHaveBeenCalled();
	});

	it("returns issues when the caller has read access", async () => {
		mockDb.query.issues.findMany.mockResolvedValueOnce([
			{ id: 1, title: "A", labels: ["bug"] },
		]);

		const { getIssues } = await import("../issues");

		const result = await getIssues({ data: { repoId: 1 } });
		expect(result).toEqual([{ id: 1, title: "A", labels: ["bug"] }]);
	});
});

describe("getIssue", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("throws when the issue does not exist", async () => {
		mockDb.query.issues.findFirst.mockResolvedValueOnce(undefined);

		const { getIssue } = await import("../issues");

		await expect(getIssue({ data: { issueId: 999 } })).rejects.toThrow(
			"Issue not found",
		);
	});

	it("throws access denied when the caller cannot read the repo", async () => {
		mockDb.query.issues.findFirst.mockResolvedValueOnce({
			id: 1,
			repoId: 5,
			labels: null,
			repository: { id: 5 },
		});
		const { getAccessForRepository } = await import("../repo-access");
		(getAccessForRepository as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			canRead: false,
		});

		const { getIssue } = await import("../issues");

		await expect(getIssue({ data: { issueId: 1 } })).rejects.toThrow(
			"Access denied",
		);
	});

	it("returns the issue when the caller can read the repo", async () => {
		mockDb.query.issues.findFirst.mockResolvedValueOnce({
			id: 1,
			repoId: 5,
			labels: ["bug"],
			repository: { id: 5 },
		});

		const { getIssue } = await import("../issues");

		const result = await getIssue({ data: { issueId: 1 } });
		expect(result.id).toBe(1);
		expect(result.labels).toEqual(["bug"]);
	});
});

describe("updateIssue", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("throws when the issue does not exist", async () => {
		mockDb.query.issues.findFirst.mockResolvedValueOnce(undefined);

		const { updateIssue } = await import("../issues");

		await expect(
			updateIssue({ data: { issueId: 999, title: "New" } }),
		).rejects.toThrow("Issue not found");
	});

	it("rejects a non-author without write access", async () => {
		mockDb.query.issues.findFirst.mockResolvedValueOnce({
			id: 1,
			repoId: 5,
			authorId: "someone-else",
			status: "open",
		});
		const { canWriteRepo } = await import("../repo-access");
		(canWriteRepo as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

		const { updateIssue } = await import("../issues");

		await expect(
			updateIssue({ data: { issueId: 1, title: "New" } }),
		).rejects.toThrow("Access denied");
		expect(mockDb.update).not.toHaveBeenCalled();
	});

	it("allows the author to edit even without write access", async () => {
		mockDb.query.issues.findFirst.mockResolvedValueOnce({
			id: 1,
			repoId: 5,
			authorId: mockUser.id,
			status: "open",
		});
		// authorId === caller, so canWriteRepo must not even be consulted —
		// assert that instead of just "it still works" (short-circuit, not luck).
		const { canWriteRepo } = await import("../repo-access");
		const canWriteRepoMock = canWriteRepo as ReturnType<typeof vi.fn>;

		const { updateIssue } = await import("../issues");

		const result = await updateIssue({
			data: { issueId: 1, title: "New title" },
		});
		expect(result.title).toBe("Updated");
		expect(canWriteRepoMock).not.toHaveBeenCalled();
	});

	it("allows a non-author repo writer to edit", async () => {
		mockDb.query.issues.findFirst.mockResolvedValueOnce({
			id: 1,
			repoId: 5,
			authorId: "someone-else",
			status: "open",
		});

		const { updateIssue } = await import("../issues");

		await expect(
			updateIssue({ data: { issueId: 1, title: "New title" } }),
		).resolves.toBeDefined();
	});

	it("logs activity when status changes", async () => {
		mockDb.query.issues.findFirst.mockResolvedValueOnce({
			id: 1,
			repoId: 5,
			authorId: mockUser.id,
			title: "Bug",
			status: "open",
		});

		const { updateIssue } = await import("../issues");
		await updateIssue({ data: { issueId: 1, status: "closed" } });

		expect(mockDb.insert).toHaveBeenCalledTimes(1);
	});

	it("does not log activity when status is unchanged", async () => {
		mockDb.query.issues.findFirst.mockResolvedValueOnce({
			id: 1,
			repoId: 5,
			authorId: mockUser.id,
			title: "Bug",
			status: "open",
		});

		const { updateIssue } = await import("../issues");
		await updateIssue({ data: { issueId: 1, title: "Renamed" } });

		expect(mockDb.insert).not.toHaveBeenCalled();
	});
});

describe("getIssueNumbers", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("rejects when the caller lacks read access", async () => {
		const { requireReadAccess } = await import("../repo-access");
		(requireReadAccess as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error("Access denied"),
		);

		const { getIssueNumbers } = await import("../issues");
		await expect(getIssueNumbers({ data: { repoId: 1 } })).rejects.toThrow(
			"Access denied",
		);
	});

	it("returns issue ids for the repo when the caller can read", async () => {
		mockDb.select.mockReturnValueOnce({
			from: vi.fn(() => ({
				where: vi.fn(() =>
					Promise.resolve([{ id: 10 }, { id: 20 }, { id: 30 }]),
				),
			})),
		});

		const { getIssueNumbers } = await import("../issues");
		const result = await getIssueNumbers({ data: { repoId: 5 } });

		expect(result).toEqual([10, 20, 30]);
	});

	it("returns an empty array when there are no issues", async () => {
		mockDb.select.mockReturnValueOnce({
			from: vi.fn(() => ({
				where: vi.fn(() => Promise.resolve([])),
			})),
		});

		const { getIssueNumbers } = await import("../issues");
		const result = await getIssueNumbers({ data: { repoId: 99 } });

		expect(result).toEqual([]);
	});
});
