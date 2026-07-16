/**
 * Tests for search server functions — access gating, query behavior, and
 * result normalization.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockUser } from "@/test/mock-routes";

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
}));

vi.mock("../repo-access", () => ({
	canReadRepo: vi.fn(() => Promise.resolve(true)),
}));

const findManyMock = vi.fn((): Promise<unknown[]> => Promise.resolve([]));

vi.mock("../../db", () => ({
	db: {
		query: {
			repositories: { findMany: findManyMock },
			issues: { findMany: findManyMock },
			user: { findMany: findManyMock },
			activities: { findMany: findManyMock },
		},
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => []),
			})),
		})),
	},
}));

describe("search.ts limit caps", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		findManyMock.mockResolvedValue([]);
	});

	describe("searchRepositories", () => {
		it("rejects limit above 100", async () => {
			const { searchRepositories } = await import("../search");
			await expect(
				searchRepositories({ data: { query: "x", limit: 101 } }),
			).rejects.toThrow();
			expect(findManyMock).not.toHaveBeenCalled();
		});

		it("accepts limit of exactly 100", async () => {
			const { searchRepositories } = await import("../search");
			await searchRepositories({ data: { query: "x", limit: 100 } });
			expect(findManyMock).toHaveBeenCalled();
		});

		it("defaults to 20 when limit is omitted", async () => {
			const { searchRepositories } = await import("../search");
			await searchRepositories({ data: { query: "x" } });
			expect(findManyMock).toHaveBeenCalledWith(
				expect.objectContaining({ limit: 20 }),
			);
		});

		it("rejects empty query", async () => {
			const { searchRepositories } = await import("../search");
			await expect(
				searchRepositories({ data: { query: "" } }),
			).rejects.toThrow();
		});
	});

	describe("getGlobalActivity", () => {
		it("rejects limit above 100", async () => {
			const { getGlobalActivity } = await import("../search");
			await expect(
				getGlobalActivity({ data: { limit: 101 } }),
			).rejects.toThrow();
			expect(findManyMock).not.toHaveBeenCalled();
		});

		it("accepts limit of exactly 100", async () => {
			const { getGlobalActivity } = await import("../search");
			await getGlobalActivity({ data: { limit: 100 } });
			expect(findManyMock).toHaveBeenCalled();
		});

		it("defaults to 50 when limit is omitted", async () => {
			const { getGlobalActivity } = await import("../search");
			await getGlobalActivity({ data: {} });
			expect(findManyMock).toHaveBeenCalledWith(
				expect.objectContaining({ limit: 50 }),
			);
		});
	});
});

describe("searchIssues", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		findManyMock.mockResolvedValue([]);
	});

	it("gates on canReadRepo — throws when access is denied", async () => {
		const { canReadRepo } = await import("../repo-access");
		(canReadRepo as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

		const { searchIssues } = await import("../search");
		await expect(
			searchIssues({ data: { repoId: 1, query: "bug" } }),
		).rejects.toThrow("Access denied");
		expect(findManyMock).not.toHaveBeenCalled();
	});

	it("searches issues when access is granted", async () => {
		findManyMock.mockResolvedValueOnce([
			{ id: 1, title: "Bug #1", labels: ["bug"], author: { name: "Alice" } },
		]);

		const { searchIssues } = await import("../search");
		const result = await searchIssues({ data: { repoId: 5, query: "Bug" } });

		expect(result).toHaveLength(1);
		expect(result[0].title).toBe("Bug #1");
	});

	it("normalizes null labels to empty object", async () => {
		findManyMock.mockResolvedValueOnce([
			{ id: 2, title: "No labels", labels: null, author: { name: "Bob" } },
		]);

		const { searchIssues } = await import("../search");
		const result = await searchIssues({ data: { repoId: 5, query: "x" } });

		expect(result[0].labels).toEqual({});
	});
});

describe("searchUsers", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		findManyMock.mockResolvedValue([]);
	});

	it("rejects empty query", async () => {
		const { searchUsers } = await import("../search");
		await expect(searchUsers({ data: { query: "" } })).rejects.toThrow();
	});

	it("searches users and returns the result", async () => {
		findManyMock.mockResolvedValueOnce([
			{
				id: "u1",
				username: "alice",
				displayUsername: "alice",
				name: "Alice",
				image: "url",
				email: "should@not.return",
			},
		]);

		const { searchUsers } = await import("../search");
		const result = await searchUsers({ data: { query: "alice" } });

		expect(result).toHaveLength(1);
		expect(result[0].username).toBe("alice");
		expect(result[0]).not.toHaveProperty("email");
	});
});

describe("getUserActivity", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		findManyMock.mockResolvedValue([]);
	});

	it("defaults limit to 50", async () => {
		const { getUserActivity } = await import("../search");
		await getUserActivity({ data: {} });

		expect(findManyMock).toHaveBeenCalledWith(
			expect.objectContaining({ limit: 50 }),
		);
	});

	it("rejects limit above 100", async () => {
		const { getUserActivity } = await import("../search");
		await expect(getUserActivity({ data: { limit: 101 } })).rejects.toThrow();
	});

	it("normalizes null metadata to empty object", async () => {
		findManyMock.mockResolvedValueOnce([
			{ id: 1, metadata: null, user: {}, repository: {} },
		]);

		const { getUserActivity } = await import("../search");
		const result = await getUserActivity({ data: {} });

		expect(result[0].metadata).toEqual({});
	});
});

describe("getRepositoryActivity", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		findManyMock.mockResolvedValue([]);
	});

	it("gates on canReadRepo — throws when access is denied", async () => {
		const { canReadRepo } = await import("../repo-access");
		(canReadRepo as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

		const { getRepositoryActivity } = await import("../search");
		await expect(
			getRepositoryActivity({ data: { repoId: 1 } }),
		).rejects.toThrow("Access denied");
		expect(findManyMock).not.toHaveBeenCalled();
	});

	it("returns activity when access is granted", async () => {
		findManyMock.mockResolvedValueOnce([
			{ id: 1, metadata: null, user: { name: "Alice" } },
		]);

		const { getRepositoryActivity } = await import("../search");
		const result = await getRepositoryActivity({ data: { repoId: 5 } });

		expect(result).toHaveLength(1);
		expect(result[0].metadata).toEqual({});
	});
});
