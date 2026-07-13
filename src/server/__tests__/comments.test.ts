/**
 * Tests for comment server functions
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
	canReadRepo: vi.fn(() => Promise.resolve(true)),
	canWriteRepo: vi.fn(() => Promise.resolve(true)),
	canModerateRepo: vi.fn(() => Promise.resolve(true)),
}));

const mockDb = {
	insert: vi.fn(() => ({
		values: vi.fn(() => ({
			returning: vi.fn(() => [{ id: 1 }]),
		})),
	})),
	query: {
		issues: {
			findFirst: vi.fn(),
		},
		pullRequests: {
			findFirst: vi.fn(),
		},
	},
};

vi.mock("../../db", () => ({ db: mockDb }));

describe("createComment", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDb.insert.mockReturnValue({
			values: vi.fn(() => ({
				returning: vi.fn(() => [{ id: 1 }]),
			})),
		} as unknown as ReturnType<typeof mockDb.insert>);
	});

	it("rejects when issueId belongs to a different repository (cross-repo injection)", async () => {
		mockDb.query.issues.findFirst.mockResolvedValue({
			id: 10,
			repoId: 2, // different from the repoId in the request
		});

		const { createComment } = await import("../comments");

		await expect(
			createComment({
				data: { repoId: 1, issueId: 10, body: "hello" },
			}),
		).rejects.toThrow(/does not belong/);

		expect(mockDb.insert).not.toHaveBeenCalled();
	});

	it("rejects when pullRequestId belongs to a different repository", async () => {
		mockDb.query.pullRequests.findFirst.mockResolvedValue({
			id: 20,
			repoId: 2,
		});

		const { createComment } = await import("../comments");

		await expect(
			createComment({
				data: { repoId: 1, pullRequestId: 20, body: "hello" },
			}),
		).rejects.toThrow(/does not belong/);

		expect(mockDb.insert).not.toHaveBeenCalled();
	});

	it("rejects when the referenced issue does not exist", async () => {
		mockDb.query.issues.findFirst.mockResolvedValue(undefined);

		const { createComment } = await import("../comments");

		await expect(
			createComment({
				data: { repoId: 1, issueId: 999, body: "hello" },
			}),
		).rejects.toThrow(/does not belong/);

		expect(mockDb.insert).not.toHaveBeenCalled();
	});

	it("succeeds when the issue belongs to the specified repository", async () => {
		mockDb.query.issues.findFirst.mockResolvedValue({
			id: 10,
			repoId: 1,
		});

		const { createComment } = await import("../comments");

		const result = await createComment({
			data: { repoId: 1, issueId: 10, body: "hello" },
		});

		expect(result).toEqual({ id: 1 });
		expect(mockDb.insert).toHaveBeenCalled();
	});

	it("succeeds when the pull request belongs to the specified repository", async () => {
		mockDb.query.pullRequests.findFirst.mockResolvedValue({
			id: 20,
			repoId: 1,
		});

		const { createComment } = await import("../comments");

		const result = await createComment({
			data: { repoId: 1, pullRequestId: 20, body: "hello" },
		});

		expect(result).toEqual({ id: 1 });
		expect(mockDb.insert).toHaveBeenCalled();
	});
});
