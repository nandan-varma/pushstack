/**
 * Integration tests for repository server functions
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockUser } from "@/test/mock-routes";
import { setupServerFnMock } from "@/test/server-test-utils";

setupServerFnMock();

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
	select: vi.fn(() => ({
		from: vi.fn(() => ({
			where: vi.fn(() => Promise.resolve([{ count: 0 }])),
			innerJoin: vi.fn(() => ({
				where: vi.fn(() => ({
					limit: vi.fn(() => Promise.resolve([])),
				})),
			})),
		})),
	})),
	query: {
		repositories: {
			findFirst: vi.fn(),
			findMany: vi.fn((): Promise<unknown[]> => Promise.resolve([])),
		},
		user: {
			findFirst: vi.fn(
				(): Promise<typeof mockUser | undefined> => Promise.resolve(mockUser),
			),
		},
		repositoryCollaborators: {
			findFirst: vi.fn((): Promise<unknown> => Promise.resolve(undefined)),
			findMany: vi.fn((): Promise<unknown[]> => Promise.resolve([])),
		},
		stars: {
			findFirst: vi.fn((): Promise<unknown> => Promise.resolve(undefined)),
		},
	},
};

vi.mock("../../db", () => ({ db: mockDb }));

vi.mock("../git-manager-iso", () => ({
	initBareRepo: vi.fn(() => Promise.resolve("/data/repos/123/test-repo")),
	deleteRepo: vi.fn(() => Promise.resolve()),
	getRepoPath: vi.fn(() => "/data/repos/123/test-repo"),
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
	getAccessForRepository: vi.fn(() =>
		Promise.resolve({ canRead: true, canWrite: true }),
	),
	getRepositoryAccess: vi.fn(() =>
		Promise.resolve({ canRead: true, canWrite: true, repository: mockRepo }),
	),
	getRepoOrThrow: vi.fn(async () => {
		const repo = await mockDb.query.repositories.findFirst();
		if (!repo) {
			throw new Error("Repository not found");
		}
		return repo;
	}),
}));

describe("Repository Unit Tests", () => {
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

		// Repository name flows into a real path.join for local disk hydration
		// (getRepoPath) — a name of ".." or containing "/" must never reach there.
		it.each([
			[".."],
			["."],
			["../../etc"],
			["a/b"],
			["a\\b"],
			[""],
		])("rejects unsafe repository name %j", async (name) => {
			const { createRepository } = await import("../repositories");
			await expect(
				createRepository({ data: { name, visibility: "public" } }),
			).rejects.toThrow();
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

	describe("updateRepository", () => {
		it("throws when caller is not the owner", async () => {
			mockDb.query.repositories.findFirst.mockResolvedValue({
				...mockRepo,
				ownerId: "other-user",
				owner: mockUser,
			});

			const { updateRepository } = await import("../repositories");
			await expect(
				updateRepository({ data: { id: 1, name: "renamed" } }),
			).rejects.toThrow(/owner/i);
			expect(mockDb.update).not.toHaveBeenCalled();
		});

		it("updates fields when caller is the owner", async () => {
			mockDb.query.repositories.findFirst.mockResolvedValue({
				...mockRepo,
				owner: mockUser,
			});

			const { updateRepository } = await import("../repositories");
			await updateRepository({ data: { id: 1, name: "renamed" } });
			expect(mockDb.update).toHaveBeenCalled();
		});
	});

	describe("addCollaborator", () => {
		it("throws when caller is not the owner", async () => {
			mockDb.query.repositories.findFirst.mockResolvedValue({
				...mockRepo,
				ownerId: "other-user",
				owner: mockUser,
			});

			const { addCollaborator } = await import("../repositories");
			await expect(
				addCollaborator({ data: { repoId: 1, userId: "u2" } }),
			).rejects.toThrow(/owner/i);
			expect(mockDb.insert).not.toHaveBeenCalled();
		});

		it("adds the collaborator when caller is the owner", async () => {
			mockDb.query.repositories.findFirst.mockResolvedValue({
				...mockRepo,
				owner: mockUser,
			});

			const { addCollaborator } = await import("../repositories");
			await addCollaborator({
				data: { repoId: 1, userId: "u2", role: "write" },
			});
			expect(mockDb.insert).toHaveBeenCalled();
		});
	});

	describe("removeCollaborator", () => {
		it("throws when caller is not the owner", async () => {
			mockDb.query.repositories.findFirst.mockResolvedValue({
				...mockRepo,
				ownerId: "other-user",
				owner: mockUser,
			});

			const { removeCollaborator } = await import("../repositories");
			await expect(
				removeCollaborator({ data: { repoId: 1, userId: "u2" } }),
			).rejects.toThrow(/owner/i);
			expect(mockDb.delete).not.toHaveBeenCalled();
		});

		it("removes the collaborator when caller is the owner", async () => {
			mockDb.query.repositories.findFirst.mockResolvedValue({
				...mockRepo,
				owner: mockUser,
			});

			const { removeCollaborator } = await import("../repositories");
			const result = await removeCollaborator({
				data: { repoId: 1, userId: "u2" },
			});
			expect(result.success).toBe(true);
			expect(mockDb.delete).toHaveBeenCalled();
		});
	});

	describe("addCollaboratorByUsername", () => {
		it("throws when caller is not the owner", async () => {
			mockDb.query.repositories.findFirst.mockResolvedValue({
				...mockRepo,
				ownerId: "other-user",
				owner: mockUser,
			});

			const { addCollaboratorByUsername } = await import("../repositories");
			await expect(
				addCollaboratorByUsername({
					data: { repoId: 1, username: "target" },
				}),
			).rejects.toThrow(/owner/i);
		});

		it("throws when the target username does not exist", async () => {
			mockDb.query.repositories.findFirst.mockResolvedValue({
				...mockRepo,
				owner: mockUser,
			});
			mockDb.query.user.findFirst.mockResolvedValueOnce(undefined);

			const { addCollaboratorByUsername } = await import("../repositories");
			await expect(
				addCollaboratorByUsername({
					data: { repoId: 1, username: "nobody" },
				}),
			).rejects.toThrow(/not found/i);
		});

		it("throws when the owner tries to add themselves", async () => {
			mockDb.query.repositories.findFirst.mockResolvedValue({
				...mockRepo,
				owner: mockUser,
			});
			mockDb.query.user.findFirst.mockResolvedValueOnce(mockUser);

			const { addCollaboratorByUsername } = await import("../repositories");
			await expect(
				addCollaboratorByUsername({
					data: { repoId: 1, username: mockUser.username },
				}),
			).rejects.toThrow(/already the owner/i);
		});

		it("inserts a new collaborator when none exists yet", async () => {
			mockDb.query.repositories.findFirst.mockResolvedValue({
				...mockRepo,
				owner: mockUser,
			});
			mockDb.query.user.findFirst.mockResolvedValueOnce({
				...mockUser,
				id: "target-user",
				username: "target",
			});
			mockDb.query.repositoryCollaborators.findFirst.mockResolvedValueOnce(
				undefined,
			);

			const { addCollaboratorByUsername } = await import("../repositories");
			await addCollaboratorByUsername({
				data: { repoId: 1, username: "target" },
			});

			expect(mockDb.insert).toHaveBeenCalled();
			expect(mockDb.update).not.toHaveBeenCalled();
		});

		it("updates the role when the collaborator already exists", async () => {
			mockDb.query.repositories.findFirst.mockResolvedValue({
				...mockRepo,
				owner: mockUser,
			});
			mockDb.query.user.findFirst.mockResolvedValueOnce({
				...mockUser,
				id: "target-user",
				username: "target",
			});
			mockDb.query.repositoryCollaborators.findFirst.mockResolvedValueOnce({
				id: 42,
				repoId: 1,
				userId: "target-user",
				role: "read",
			});

			const { addCollaboratorByUsername } = await import("../repositories");
			await addCollaboratorByUsername({
				data: { repoId: 1, username: "target", role: "write" },
			});

			expect(mockDb.update).toHaveBeenCalled();
			expect(mockDb.insert).not.toHaveBeenCalled();
		});
	});

	describe("toggleStar", () => {
		it("throws when the caller cannot read the repo", async () => {
			const { canReadRepo } = await import("../repo-access");
			(canReadRepo as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

			const { toggleStar } = await import("../repositories");
			await expect(toggleStar({ data: { repoId: 1 } })).rejects.toThrow(
				/not found/i,
			);
		});

		it("stars the repo when not already starred", async () => {
			mockDb.query.stars.findFirst.mockResolvedValueOnce(undefined);

			const { toggleStar } = await import("../repositories");
			const result = await toggleStar({ data: { repoId: 1 } });

			expect(result).toEqual({ starred: true });
			expect(mockDb.insert).toHaveBeenCalled();
			expect(mockDb.delete).not.toHaveBeenCalled();
		});

		it("unstars the repo when already starred", async () => {
			mockDb.query.stars.findFirst.mockResolvedValueOnce({
				repoId: 1,
				userId: mockUser.id,
			});

			const { toggleStar } = await import("../repositories");
			const result = await toggleStar({ data: { repoId: 1 } });

			expect(result).toEqual({ starred: false });
			expect(mockDb.delete).toHaveBeenCalled();
			expect(mockDb.insert).not.toHaveBeenCalled();
		});
	});

	describe("getRepository", () => {
		it("throws not found when there is no access record", async () => {
			const { getRepositoryAccess } = await import("../repo-access");
			(getRepositoryAccess as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
				null,
			);

			const { getRepository } = await import("../repositories");
			await expect(getRepository({ data: { id: 1 } })).rejects.toThrow(
				/not found/i,
			);
		});

		it("throws access denied when the caller cannot read the repo", async () => {
			const { getRepositoryAccess } = await import("../repo-access");
			(getRepositoryAccess as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				canRead: false,
				repository: mockRepo,
			});

			const { getRepository } = await import("../repositories");
			await expect(getRepository({ data: { id: 1 } })).rejects.toThrow(
				/access denied/i,
			);
		});

		it("returns the repo with star info when accessible", async () => {
			mockDb.query.repositories.findFirst.mockResolvedValue(mockRepo);

			const { getRepository } = await import("../repositories");
			const result = await getRepository({ data: { id: 1 } });

			expect(result.id).toBe(mockRepo.id);
			expect(result).toHaveProperty("starCount");
			expect(result).toHaveProperty("isStarred");
		});
	});

	describe("getUserRepositories", () => {
		it("returns the current user's own repos when no userId is provided", async () => {
			mockDb.query.repositories.findMany.mockResolvedValueOnce([
				{ id: 1, name: "repo-a", ownerId: mockUser.id, visibility: "public" },
				{ id: 2, name: "repo-b", ownerId: mockUser.id, visibility: "private" },
			]);

			const { getUserRepositories } = await import("../repositories");
			const result = await getUserRepositories({ data: {} });

			expect(result).toHaveLength(2);
			expect(mockDb.query.repositories.findMany).toHaveBeenCalled();
		});

		it("filters to public repos when viewing another user's page", async () => {
			mockDb.query.repositories.findMany.mockResolvedValueOnce([
				{ id: 3, name: "public-only", visibility: "public" },
			]);

			const { getUserRepositories } = await import("../repositories");
			const result = await getUserRepositories({
				data: { userId: "other-user" },
			});

			expect(result).toHaveLength(1);
		});

		it("respects limit and skip pagination", async () => {
			mockDb.query.repositories.findMany.mockResolvedValueOnce([]);

			const { getUserRepositories } = await import("../repositories");
			await getUserRepositories({ data: { limit: 10, skip: 20 } });

			expect(mockDb.query.repositories.findMany).toHaveBeenCalled();
		});
	});

	describe("getCollaborators", () => {
		it("throws when the caller lacks moderate access", async () => {
			const { canModerateRepo } = await import("../repo-access");
			(canModerateRepo as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
				false,
			);

			const { getCollaborators } = await import("../repositories");
			await expect(getCollaborators({ data: { repoId: 1 } })).rejects.toThrow(
				/Access denied/,
			);
		});

		it("returns the collaborator list when the caller can moderate", async () => {
			mockDb.query.repositoryCollaborators.findMany.mockResolvedValueOnce([
				{
					id: 1,
					repoId: 1,
					userId: "u2",
					role: "write",
					user: { name: "Bob" },
				},
			]);

			const { getCollaborators } = await import("../repositories");
			const result = await getCollaborators({ data: { repoId: 1 } });

			expect(result).toHaveLength(1);
			expect(result[0].role).toBe("write");
		});
	});

	describe("getRepositoryByName", () => {
		it("throws when the repository does not exist", async () => {
			// The join query returns empty → not found
			mockDb.select.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn(() => Promise.resolve([{ count: 0 }])),
					innerJoin: vi.fn(() => ({
						where: vi.fn(() => ({
							limit: vi.fn(() => Promise.resolve([])),
						})),
					})),
				})),
			});

			const { getRepositoryByName } = await import("../repositories");
			await expect(
				getRepositoryByName({ data: { owner: "nobody", name: "nope" } }),
			).rejects.toThrow("Repository not found");
		});

		it("throws access denied when the caller cannot read a private repo", async () => {
			const row = {
				repo: { ...mockRepo, visibility: "private" },
				owner: mockUser,
			};
			// Use a different key to avoid the fetchRepoRowByName cache from the prior test.
			// biome-ignore lint/suspicious/noExplicitAny: test mock with complex nested return type
			mockDb.select.mockImplementation((): any => ({
				from: vi.fn(() => ({
					where: vi.fn(() => Promise.resolve([{ count: 0 }])),
					innerJoin: vi.fn(() => ({
						where: vi.fn(() => ({
							limit: vi.fn(() => Promise.resolve([row])),
						})),
					})),
				})),
			}));
			const { getAccessForRepository } = await import("../repo-access");
			(
				getAccessForRepository as ReturnType<typeof vi.fn>
			).mockResolvedValueOnce({
				canRead: false,
			});

			const { getRepositoryByName } = await import("../repositories");
			await expect(
				getRepositoryByName({ data: { owner: "nobody2", name: "nope2" } }),
			).rejects.toThrow("Access denied");
		});

		it("returns the repo with star info when accessible", async () => {
			const row = {
				repo: mockRepo,
				owner: mockUser,
			};
			// Use a unique key and a select mock that handles both the fetchRepoRowByName
			// innerJoin chain and the getStarCount from().where() chain.
			// biome-ignore lint/suspicious/noExplicitAny: test mock with complex nested return type
			mockDb.select.mockImplementation((): any => ({
				from: vi.fn(() => ({
					where: vi.fn(() => Promise.resolve([{ count: 0 }])),
					innerJoin: vi.fn(() => ({
						where: vi.fn(() => ({
							limit: vi.fn(() => Promise.resolve([row])),
						})),
					})),
				})),
			}));

			const { getRepositoryByName } = await import("../repositories");
			const result = await getRepositoryByName({
				data: { owner: "testuser", name: "test-repo" },
			});

			expect(result.id).toBe(mockRepo.id);
			expect(result).toHaveProperty("starCount");
			expect(result).toHaveProperty("isStarred");
		});
	});
});
