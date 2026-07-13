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
import { deleteRepositoryFromR2 } from "./git-repo-storage";
import { getStorageOwnerKey } from "./git-storage-naming";
import {
	canModerateRepo,
	canReadRepo,
	getRepositoryAccess,
} from "./repo-access";
import { getCurrentUser, getCurrentUserOptional } from "./session";

async function getStarCount(repoId: number): Promise<number> {
	const [row] = await db
		.select({ count: sql`count(*)` })
		.from(stars)
		.where(eq(stars.repoId, repoId));
	return Number(row?.count || 0);
}

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
			// Initialize git repository on filesystem
			const gitPath = await initBareRepo(ownerKey, data.name);

			// Create repository record in database. The existence check above is
			// check-then-act (not atomic) — a concurrent double-submit can pass it
			// twice, so the unique index on (ownerId, name) is the real guard; a
			// violation here means we lost that race, not a server error.
			let repo: typeof repositories.$inferSelect;
			try {
				[repo] = await db
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
			} catch (error) {
				if ((error as { code?: string })?.code === "23505") {
					throw new Error("Repository with this name already exists");
				}
				throw error;
			}

			// Log activity
			await db.insert(activities).values({
				userId: user.id,
				repoId: repo.id,
				type: "create_repo",
				metadata: { repoName: repo.name },
			});

			// initBareRepo already wrote the bare repo straight to its storage backend
			// (R2 or local disk, per isR2Configured()) — no separate sync step needed.
			// Syncing here would treat the never-hydrated-locally repo as having zero
			// local files and delete the HEAD/config it just wrote as "stale".

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

		const access = await getRepositoryAccess(data.id, currentUser?.id);
		if (!access) throw new Error("Repository not found");
		if (!access.canRead) throw new Error("Access denied");

		const repo = await db.query.repositories.findFirst({
			where: eq(repositories.id, data.id),
			with: { owner: true },
		});

		if (!repo) {
			throw new Error("Repository not found");
		}

		const [starCount, userStar] = await Promise.all([
			getStarCount(data.id),
			currentUser
				? db.query.stars.findFirst({
						where: and(
							eq(stars.repoId, data.id),
							eq(stars.userId, currentUser.id),
						),
					})
				: null,
		]);

		return {
			...repo,
			starCount,
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

		const access = await getRepositoryAccess(repo.id, currentUser?.id);
		if (!access?.canRead) throw new Error("Access denied");

		const [starCount, userStar] = await Promise.all([
			getStarCount(repo.id),
			currentUser
				? db.query.stars.findFirst({
						where: and(
							eq(stars.repoId, repo.id),
							eq(stars.userId, currentUser.id),
						),
					})
				: null,
		]);

		return {
			...repo,
			starCount,
			isStarred: !!userStar,
		};
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
		// Delete git repository from filesystem and R2
		await deleteRepo(ownerKey, repo.name);
		await deleteRepositoryFromR2(ownerKey, repo.name);

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

export const addCollaboratorByUsername = createServerFn({ method: "POST" })
	.validator((data: unknown) =>
		z
			.object({
				repoId: z.number(),
				username: z.string(),
				role: z.enum(["read", "write", "admin"]).default("read"),
			})
			.parse(data),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();

		const repo = await db.query.repositories.findFirst({
			where: eq(repositories.id, data.repoId),
		});
		if (!repo) throw new Error("Repository not found");
		if (repo.ownerId !== currentUser.id)
			throw new Error("Only the owner can add collaborators");

		const target = await db.query.user.findFirst({
			where: eq(user.username, data.username),
		});
		if (!target) throw new Error(`User "${data.username}" not found`);
		if (target.id === currentUser.id)
			throw new Error("You are already the owner");

		const existing = await db.query.repositoryCollaborators.findFirst({
			where: and(
				eq(repositoryCollaborators.repoId, data.repoId),
				eq(repositoryCollaborators.userId, target.id),
			),
		});

		if (existing) {
			const [updated] = await db
				.update(repositoryCollaborators)
				.set({ role: data.role })
				.where(eq(repositoryCollaborators.id, existing.id))
				.returning();
			return updated;
		}

		const [collab] = await db
			.insert(repositoryCollaborators)
			.values({ repoId: data.repoId, userId: target.id, role: data.role })
			.returning();

		return collab;
	});
