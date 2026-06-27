import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
	activities,
	repositories,
	repositoryCollaborators,
	stars,
} from "../db/github-schema";
import { user } from "../db/schema";
import { deleteRepo, initBareRepo } from "./git-manager-iso";
// Git operations imports
import { createCommit } from "./git-operations-iso";
import { syncRepositoryToR2 } from "./git-repo-storage";
import {
	getLegacyStorageOwnerKeys,
	getStorageOwnerKey,
} from "./git-storage-naming";
import { canModerateRepo, canReadRepo } from "./repo-access";
import { getCurrentUser, getCurrentUserOptional } from "./session";

// Find repository by owner username and repo name (for git protocol - plain function, not serverFn)
export async function findRepositoryByName(
	ownerUsername: string,
	repoName: string,
) {
	// Find owner by username
	const owner = await db.query.user.findFirst({
		where: eq(user.username, ownerUsername),
	});

	if (!owner) {
		return null;
	}

	// Find repository
	const repo = await db.query.repositories.findFirst({
		where: and(
			eq(repositories.ownerId, owner.id),
			eq(repositories.name, repoName),
		),
		with: {
			owner: true,
		},
	});

	return repo;
}

// Create repository schema
const createRepoSchema = z.object({
	name: z.string().min(1).max(100),
	description: z.string().optional(),
	visibility: z.enum(["public", "private"]).default("public"),
});

// Create repository
export const createRepository = createServerFn({ method: "POST" })
	.validator((data: unknown) => createRepoSchema.parse(data))
	.handler(async ({ data }) => {
		try {
			const user = await getCurrentUser();

			// Check if repository name already exists for this user
			const existing = await db.query.repositories.findFirst({
				where: and(
					eq(repositories.ownerId, user.id),
					eq(repositories.name, data.name),
				),
			});

			if (existing) {
				throw new Error("Repository with this name already exists");
			}

			const ownerKey = getStorageOwnerKey({
				id: user.id,
				username: user.username || null,
				email: user.email,
			});
			const legacyOwnerKeys = getLegacyStorageOwnerKeys({
				id: user.id,
				username: user.username || null,
				email: user.email,
			});

			// Initialize git repository on filesystem
			const gitPath = await initBareRepo(ownerKey, data.name);

			// Create initial commit with README
			const commitSha = await createCommit(
				ownerKey,
				data.name,
				"Initial commit",
				[
					{
						path: "README.md",
						content: `# ${data.name}\n\n${data.description || "No description provided"}`,
					},
				],
				user.name || user.username || "Unknown",
				user.email,
				"main",
				legacyOwnerKeys,
				user.id,
			);

			// Create repository record in database
			const [repo] = await db
				.insert(repositories)
				.values({
					ownerId: user.id,
					name: data.name,
					description: data.description || null,
					visibility: data.visibility,
					defaultBranch: "main",
					gitPath, // Store filesystem path
				})
				.returning();

			// Log activity
			await db.insert(activities).values({
				userId: user.id,
				repoId: repo.id,
				type: "create_repo",
				metadata: {
					repoName: repo.name,
					initialCommitSha: commitSha,
				},
			});

			await syncRepositoryToR2(ownerKey, data.name, user.id, legacyOwnerKeys);

			// Return repo with owner info for navigation
			return {
				...repo,
				owner: {
					id: user.id,
					username: user.username || user.email.split("@")[0], // Fallback to email prefix
					email: user.email,
					name: user.name,
				},
			};
		} catch (error) {
			console.error("Error creating repository:", error);
			throw error;
		}
	});

// Get user repositories
export const getUserRepositories = createServerFn({ method: "GET" })
	.validator((data: unknown) =>
		z
			.object({
				userId: z.string().optional(),
			})
			.parse(data),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		const targetUserId = data.userId || currentUser.id;

		const repos = await db.query.repositories.findMany({
			where: eq(repositories.ownerId, targetUserId),
			orderBy: [desc(repositories.updatedAt)],
			with: {
				owner: true,
			},
		});

		// Filter private repos if not the owner
		if (targetUserId !== currentUser.id) {
			return repos.filter((r) => r.visibility === "public");
		}

		return repos;
	});

// Get repository by ID
export const getRepository = createServerFn({ method: "GET" })
	.validator((data: unknown) =>
		z
			.object({
				id: z.number(),
			})
			.parse(data),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUserOptional();

		if (!(await canReadRepo(data.id, currentUser?.id))) {
			throw new Error("Access denied");
		}

		const repo = await db.query.repositories.findFirst({
			where: eq(repositories.id, data.id),
			with: {
				owner: true,
			},
		});

		if (!repo) {
			throw new Error("Repository not found");
		}

		// Get star count
		const starCount = await db
			.select({ count: sql`count(*)` })
			.from(stars)
			.where(eq(stars.repoId, data.id));

		// Check if current user starred
		const userStar = currentUser
			? await db.query.stars.findFirst({
					where: and(
						eq(stars.repoId, data.id),
						eq(stars.userId, currentUser.id),
					),
				})
			: null;

		return {
			...repo,
			starCount: Number(starCount[0]?.count || 0),
			isStarred: !!userStar,
		};
	});

// Get repository by owner and name
export const getRepositoryByName = createServerFn({ method: "GET" })
	.validator((data: unknown) =>
		z
			.object({
				owner: z.string(),
				name: z.string(),
			})
			.parse(data),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUserOptional();

		// Find owner by username
		const owner = await db.query.user.findFirst({
			where: eq(user.username, data.owner),
		});

		if (!owner) {
			throw new Error("Owner not found");
		}

		const repo = await db.query.repositories.findFirst({
			where: and(
				eq(repositories.ownerId, owner.id),
				eq(repositories.name, data.name),
			),
			with: {
				owner: true,
			},
		});

		if (!repo) {
			throw new Error("Repository not found");
		}

		if (!(await canReadRepo(repo.id, currentUser?.id))) {
			throw new Error("Access denied");
		}

		return repo;
	});

// Update repository
export const updateRepository = createServerFn({ method: "POST" })
	.validator((data: unknown) =>
		z
			.object({
				id: z.number(),
				name: z.string().min(1).max(100).optional(),
				description: z.string().optional(),
				visibility: z.enum(["public", "private"]).optional(),
			})
			.parse(data),
	)
	.handler(async ({ data }) => {
		const user = await getCurrentUser();

		const repo = await db.query.repositories.findFirst({
			where: eq(repositories.id, data.id),
			with: {
				owner: true,
			},
		});

		if (!repo) {
			throw new Error("Repository not found");
		}

		if (repo.ownerId !== user.id) {
			throw new Error("Only repository owner can update");
		}

		const [updated] = await db
			.update(repositories)
			.set({
				...(data.name && { name: data.name }),
				...(data.description !== undefined && {
					description: data.description,
				}),
				...(data.visibility && { visibility: data.visibility }),
				updatedAt: new Date(),
			})
			.where(eq(repositories.id, data.id))
			.returning();

		return updated;
	});

// Delete repository
export const deleteRepository = createServerFn({ method: "POST" })
	.validator((data: unknown) =>
		z
			.object({
				id: z.number(),
			})
			.parse(data),
	)
	.handler(async ({ data }) => {
		const user = await getCurrentUser();

		const repo = await db.query.repositories.findFirst({
			where: eq(repositories.id, data.id),
			with: {
				owner: true,
			},
		});

		if (!repo) {
			throw new Error("Repository not found");
		}

		if (repo.ownerId !== user.id) {
			throw new Error("Only repository owner can delete");
		}

		const ownerKey = getStorageOwnerKey({
			id: repo.owner.id,
			username: repo.owner.username,
			email: repo.owner.email,
		});
		const legacyOwnerKeys = getLegacyStorageOwnerKeys({
			id: repo.owner.id,
			username: repo.owner.username,
			email: repo.owner.email,
		});

		// Optionally backup before deleting (TODO: implement with isomorphic-git)
		// try {
		//   await backupRepositoryToR2(ownerId, repo.name);
		// } catch (error) {
		//   console.error('Failed to backup repository before deletion:', error);
		// }

		// Delete git repository from filesystem
		await deleteRepo(ownerKey, repo.name);
		for (const legacyOwnerKey of legacyOwnerKeys) {
			if (legacyOwnerKey !== ownerKey) {
				await deleteRepo(legacyOwnerKey, repo.name).catch(() => undefined);
			}
		}

		// Delete from database (cascades to related tables)
		await db.delete(repositories).where(eq(repositories.id, data.id));

		return { success: true };
	});

// Star/unstar repository
export const toggleStar = createServerFn({ method: "POST" })
	.validator((data: unknown) =>
		z
			.object({
				repoId: z.number(),
			})
			.parse(data),
	)
	.handler(async ({ data }) => {
		const user = await getCurrentUser();

		if (!(await canReadRepo(data.repoId, user.id))) {
			throw new Error("Repository not found");
		}

		const existingStar = await db.query.stars.findFirst({
			where: and(eq(stars.repoId, data.repoId), eq(stars.userId, user.id)),
		});

		if (existingStar) {
			// Unstar
			await db
				.delete(stars)
				.where(and(eq(stars.repoId, data.repoId), eq(stars.userId, user.id)));

			return { starred: false };
		} else {
			// Star
			await db.insert(stars).values({
				repoId: data.repoId,
				userId: user.id,
			});

			// Log activity
			await db.insert(activities).values({
				userId: user.id,
				repoId: data.repoId,
				type: "star",
			});

			return { starred: true };
		}
	});

// Get repository collaborators
export const getCollaborators = createServerFn({ method: "GET" })
	.validator((data: unknown) =>
		z
			.object({
				repoId: z.number(),
			})
			.parse(data),
	)
	.handler(async ({ data }) => {
		const user = await getCurrentUser();

		if (!(await canModerateRepo(data.repoId, user.id))) {
			throw new Error("Access denied");
		}

		const collabs = await db.query.repositoryCollaborators.findMany({
			where: eq(repositoryCollaborators.repoId, data.repoId),
			with: {
				user: true,
			},
		});

		return collabs;
	});

// Add collaborator
export const addCollaborator = createServerFn({ method: "POST" })
	.validator((data: unknown) =>
		z
			.object({
				repoId: z.number(),
				userId: z.string(),
				role: z.enum(["read", "write", "admin"]).default("read"),
			})
			.parse(data),
	)
	.handler(async ({ data }) => {
		const user = await getCurrentUser();

		const repo = await db.query.repositories.findFirst({
			where: eq(repositories.id, data.repoId),
		});

		if (!repo) {
			throw new Error("Repository not found");
		}

		if (repo.ownerId !== user.id) {
			throw new Error("Only repository owner can add collaborators");
		}

		const [collab] = await db
			.insert(repositoryCollaborators)
			.values({
				repoId: data.repoId,
				userId: data.userId,
				role: data.role,
			})
			.returning();

		return collab;
	});

// Remove collaborator
export const removeCollaborator = createServerFn({ method: "POST" })
	.validator((data: unknown) =>
		z
			.object({
				repoId: z.number(),
				userId: z.string(),
			})
			.parse(data),
	)
	.handler(async ({ data }) => {
		const user = await getCurrentUser();

		const repo = await db.query.repositories.findFirst({
			where: eq(repositories.id, data.repoId),
		});

		if (!repo) {
			throw new Error("Repository not found");
		}

		if (repo.ownerId !== user.id) {
			throw new Error("Only repository owner can remove collaborators");
		}

		await db
			.delete(repositoryCollaborators)
			.where(
				and(
					eq(repositoryCollaborators.repoId, data.repoId),
					eq(repositoryCollaborators.userId, data.userId),
				),
			);

		return { success: true };
	});
