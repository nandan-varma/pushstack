/**
 * Integration tests for repository server functions
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Allow calling createServerFn handlers directly in tests
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => {
		const obj: any = {};
		obj.validator = (validateFn: any) => {
			const inner: any = {};
			inner.handler = (handlerFn: any) => (args: any) =>
				handlerFn({ data: validateFn(args?.data ?? args) });
			return inner;
		};
		obj.handler = (handlerFn: any) => (args: any) => handlerFn(args);
		return obj;
	},
}));

vi.mock("../session", () => ({
	getCurrentUser: vi.fn(() => Promise.resolve(mockUser)),
	getCurrentUserOptional: vi.fn(() => Promise.resolve(mockUser)),
}));

const mockRepo = {
	id: 1,
	ownerId: "user123",
	name: "test-repo",
	description: "Test repository",
	visibility: "public" as const,
	defaultBranch: "main",
	gitPath: "/data/repos/123/test-repo",
	createdAt: new Date(),
	updatedAt: new Date(),
};

const mockUser = {
	id: "user123",
	email: "test@example.com",
	name: "Test User",
	username: "testuser",
};

vi.mock("../../lib/auth", () => ({
	auth: {
		api: {
			getSession: vi.fn(() => ({ user: mockUser })),
		},
	},
}));

const mockDb = {
	insert: vi.fn(() => ({
		values: vi.fn(() => ({
			returning: vi.fn(() => [mockRepo]),
		})),
	})),
	update: vi.fn(() => ({
		set: vi.fn(() => ({
			where: vi.fn(() => ({ returning: vi.fn(() => [{}]) })),
		})),
	})),
	delete: vi.fn(() => ({
		where: vi.fn(() => Promise.resolve()),
	})),
	query: {
		repositories: {
			findFirst: vi.fn(),
			findMany: vi.fn(() => Promise.resolve([])),
		},
		user: {
			findFirst: vi.fn(() => Promise.resolve(mockUser)),
		},
	},
};

vi.mock("../../db", () => ({ db: mockDb }));

vi.mock("../git-manager-iso", () => ({
	initBareRepo: vi.fn(() => Promise.resolve("/data/repos/123/test-repo")),
	deleteRepo: vi.fn(() => Promise.resolve()),
	getRepoPath: vi.fn(() => "/data/repos/123/test-repo"),
	repoExists: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("../git-operations-iso", () => ({
	createCommit: vi.fn(() => Promise.resolve("initial-commit-sha")),
	getBranches: vi.fn(() =>
		Promise.resolve([{ name: "main", commit: "commit-sha", isDefault: true }]),
	),
}));

vi.mock("../git-repo-storage", () => ({
	syncRepositoryToR2: vi.fn(() => Promise.resolve()),
	deleteRepositoryFromR2: vi.fn(() => Promise.resolve()),
}));

vi.mock("../git-storage-naming", () => ({
	getStorageOwnerKey: vi.fn(() => "user123"),
	getLegacyStorageOwnerKeys: vi.fn(() => []),
}));

vi.mock("../repo-access", () => ({
	canReadRepo: vi.fn(() => Promise.resolve(true)),
	canWriteRepo: vi.fn(() => Promise.resolve(true)),
	canModerateRepo: vi.fn(() => Promise.resolve(true)),
	getRepositoryAccess: vi.fn(() =>
		Promise.resolve({ canRead: true, canWrite: true, repository: mockRepo }),
	),
}));

describe("Repository Integration Tests", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDb.query.repositories.findFirst.mockResolvedValue(null);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("createRepository", () => {
		it("creates a repository and returns it with owner info", async () => {
			const { createRepository } = await import("../repositories");
			const result = await createRepository({
				data: { name: "test-repo", visibility: "public" },
			});

			expect(result.name).toBe("test-repo");
			expect(result.ownerId).toBe("user123");
			expect(mockDb.insert).toHaveBeenCalled();
		});

		it("throws when repository name already exists for user", async () => {
			mockDb.query.repositories.findFirst.mockResolvedValue(mockRepo);

			const { createRepository } = await import("../repositories");
			await expect(
				createRepository({ data: { name: "test-repo", visibility: "public" } }),
			).rejects.toThrow("already exists");
		});
	});

	describe("deleteRepository", () => {
		it("throws when caller is not the owner", async () => {
			mockDb.query.repositories.findFirst.mockResolvedValue({
				...mockRepo,
				ownerId: "other-user",
				owner: {
					id: "other-user",
					username: "other",
					email: "other@example.com",
				},
			});

			const { deleteRepository } = await import("../repositories");
			await expect(deleteRepository({ data: { id: 1 } })).rejects.toThrow(
				/owner/i,
			);
		});

		it("deletes repo from filesystem, R2, and database", async () => {
			mockDb.query.repositories.findFirst.mockResolvedValue({
				...mockRepo,
				owner: mockUser,
			});

			const { deleteRepository } = await import("../repositories");
			const result = await deleteRepository({ data: { id: 1 } });

			expect(result.success).toBe(true);
			expect(mockDb.delete).toHaveBeenCalled();

			const { deleteRepositoryFromR2 } = await import("../git-repo-storage");
			expect(deleteRepositoryFromR2).toHaveBeenCalled();
		});
	});
});
