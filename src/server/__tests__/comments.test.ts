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
	getAccessForRepository: vi.fn(() => Promise.resolve({ canRead: true })),
	canWriteRepo: vi.fn(() => Promise.resolve(true)),
	canModerateRepo: vi.fn(() => Promise.resolve(true)),
}));

const mockDb = {
	insert: vi.fn(() => ({
		values: vi.fn(() => ({
			returning: vi.fn(() => [{ id: 1 }]),
		})),
	})),
	update: vi.fn(() => ({
		set: vi.fn(() => ({
			where: vi.fn(() => ({
				returning: vi.fn(() => [
					{ id: 1, body: "updated", updatedAt: new Date() },
				]),
			})),
		})),
	})),
	delete: vi.fn(() => ({
		where: vi.fn(() => Promise.resolve()),
	})),
	query: {
		issues: {
			findFirst: vi.fn(),
		},
		pullRequests: {
			findFirst: vi.fn(),
		},
		comments: {
			findFirst: vi.fn(),
			findMany: vi.fn(),
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

describe("getComments", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("throws when neither issueId nor pullRequestId is provided", async () => {
		const { getComments } = await import("../comments");
		await expect(getComments({ data: {} })).rejects.toThrow(
			/Must specify issueId or pullRequestId/,
		);
	});

	it("throws when the caller cannot read the issue's repo", async () => {
		mockDb.query.issues.findFirst.mockResolvedValue({
			id: 10,
			repoId: 1,
			repository: { id: 1 },
		});
		const { getAccessForRepository } = await import("../repo-access");
		(getAccessForRepository as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			canRead: false,
		});

		const { getComments } = await import("../comments");
		await expect(getComments({ data: { issueId: 10 } })).rejects.toThrow(
			/Access denied/,
		);
	});

	it("returns comments for an issue when the caller can read", async () => {
		mockDb.query.issues.findFirst.mockResolvedValue({
			id: 10,
			repoId: 1,
			repository: { id: 1 },
		});
		mockDb.query.comments = {
			...mockDb.query.comments,
			findMany: vi.fn().mockResolvedValue([
				{ id: 1, body: "first", author: { name: "Alice" } },
				{ id: 2, body: "second", author: { name: "Bob" } },
			]),
		};

		const { getComments } = await import("../comments");
		const result = await getComments({ data: { issueId: 10 } });

		expect(result).toHaveLength(2);
		expect(result[0].body).toBe("first");
	});

	it("returns comments for a pull request", async () => {
		mockDb.query.pullRequests.findFirst.mockResolvedValue({
			id: 20,
			repoId: 1,
			repository: { id: 1 },
		});
		mockDb.query.comments = {
			...mockDb.query.comments,
			findMany: vi
				.fn()
				.mockResolvedValue([
					{ id: 3, body: "pr comment", author: { name: "Carol" } },
				]),
		};

		const { getComments } = await import("../comments");
		const result = await getComments({ data: { pullRequestId: 20 } });

		expect(result).toHaveLength(1);
		expect(result[0].body).toBe("pr comment");
	});
});

describe("updateComment", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("throws when the comment does not exist", async () => {
		mockDb.query.comments = {
			...mockDb.query.comments,
			findFirst: vi.fn().mockResolvedValue(undefined),
		};

		const { updateComment } = await import("../comments");
		await expect(
			updateComment({ data: { commentId: 999, body: "updated" } }),
		).rejects.toThrow("Comment not found");
	});

	it("throws when a non-author lacks write access", async () => {
		mockDb.query.comments = {
			...mockDb.query.comments,
			findFirst: vi.fn().mockResolvedValue({
				id: 1,
				authorId: "someone-else",
				repoId: 5,
			}),
		};
		const { canWriteRepo } = await import("../repo-access");
		(canWriteRepo as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

		const { updateComment } = await import("../comments");
		await expect(
			updateComment({ data: { commentId: 1, body: "edited" } }),
		).rejects.toThrow("Only comment author can edit");
	});

	it("allows the author to edit without write access", async () => {
		mockDb.query.comments = {
			...mockDb.query.comments,
			findFirst: vi.fn().mockResolvedValue({
				id: 1,
				authorId: mockUser.id,
				repoId: 5,
			}),
		};
		mockDb.update = vi.fn(() => ({
			set: vi.fn(() => ({
				where: vi.fn(() => ({
					returning: vi.fn(() => [
						{ id: 1, body: "edited", updatedAt: new Date() },
					]),
				})),
			})),
		}));
		const { canWriteRepo } = await import("../repo-access");
		const canWriteRepoMock = canWriteRepo as ReturnType<typeof vi.fn>;

		const { updateComment } = await import("../comments");
		const result = await updateComment({
			data: { commentId: 1, body: "edited" },
		});

		expect(result.body).toBe("edited");
		expect(canWriteRepoMock).not.toHaveBeenCalled();
	});

	it("allows a non-author repo writer to edit", async () => {
		mockDb.query.comments = {
			...mockDb.query.comments,
			findFirst: vi.fn().mockResolvedValue({
				id: 1,
				authorId: "someone-else",
				repoId: 5,
			}),
		};
		mockDb.update = vi.fn(() => ({
			set: vi.fn(() => ({
				where: vi.fn(() => ({
					returning: vi.fn(() => [
						{ id: 1, body: "edited by mod", updatedAt: new Date() },
					]),
				})),
			})),
		}));

		const { updateComment } = await import("../comments");
		const result = await updateComment({
			data: { commentId: 1, body: "edited by mod" },
		});
		expect(result.body).toBe("edited by mod");
	});
});

describe("deleteComment", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("throws when the comment does not exist", async () => {
		mockDb.query.comments = {
			...mockDb.query.comments,
			findFirst: vi.fn().mockResolvedValue(undefined),
		};

		const { deleteComment } = await import("../comments");
		await expect(deleteComment({ data: { commentId: 999 } })).rejects.toThrow(
			"Comment not found",
		);
	});

	it("throws when a non-author lacks moderate access", async () => {
		mockDb.query.comments = {
			...mockDb.query.comments,
			findFirst: vi.fn().mockResolvedValue({
				id: 1,
				authorId: "someone-else",
				repoId: 5,
				repository: { id: 5 },
			}),
		};
		const { canModerateRepo } = await import("../repo-access");
		(canModerateRepo as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

		const { deleteComment } = await import("../comments");
		await expect(deleteComment({ data: { commentId: 1 } })).rejects.toThrow(
			"Not authorized to delete this comment",
		);
	});

	it("allows the author to delete without moderate access", async () => {
		mockDb.query.comments = {
			...mockDb.query.comments,
			findFirst: vi.fn().mockResolvedValue({
				id: 1,
				authorId: mockUser.id,
				repoId: 5,
				repository: { id: 5 },
			}),
		};
		mockDb.delete = vi.fn(() => ({
			where: vi.fn(() => Promise.resolve()),
		}));
		const { canModerateRepo } = await import("../repo-access");
		const canModerateRepoMock = canModerateRepo as ReturnType<typeof vi.fn>;

		const { deleteComment } = await import("../comments");
		const result = await deleteComment({ data: { commentId: 1 } });

		expect(result).toEqual({ success: true });
		expect(canModerateRepoMock).not.toHaveBeenCalled();
	});

	it("allows a non-author moderator to delete", async () => {
		mockDb.query.comments = {
			...mockDb.query.comments,
			findFirst: vi.fn().mockResolvedValue({
				id: 1,
				authorId: "someone-else",
				repoId: 5,
				repository: { id: 5 },
			}),
		};
		mockDb.delete = vi.fn(() => ({
			where: vi.fn(() => Promise.resolve()),
		}));

		const { deleteComment } = await import("../comments");
		const result = await deleteComment({ data: { commentId: 1 } });
		expect(result).toEqual({ success: true });
		expect(mockDb.delete).toHaveBeenCalled();
	});
});
