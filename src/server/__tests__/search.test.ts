/**
 * Tests for the max(100) cap on limit params in search.ts.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

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

const mockUser = {
	id: "user123",
	email: "test@example.com",
	name: "Test User",
	username: "testuser",
};

vi.mock("../session", () => ({
	getCurrentUser: vi.fn(() => Promise.resolve(mockUser)),
}));

vi.mock("../repo-access", () => ({
	canReadRepo: vi.fn(() => Promise.resolve(true)),
}));

const findManyMock = vi.fn(() => Promise.resolve([]));

vi.mock("../../db", () => ({
	db: {
		query: {
			repositories: { findMany: findManyMock },
			activities: { findMany: findManyMock },
		},
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
