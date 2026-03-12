import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { repositories, repositoryCollaborators } from "../db/github-schema";

export type CollaboratorRole = "read" | "write" | "admin";
export type RepositoryPermissionRole =
	| "anonymous"
	| "read"
	| "write"
	| "admin"
	| "owner";

export interface RepositoryAccess {
	repository: typeof repositories.$inferSelect;
	collaboratorRole: CollaboratorRole | null;
	role: RepositoryPermissionRole;
	canRead: boolean;
	canWrite: boolean;
	canModerate: boolean;
	canMergePullRequest: boolean;
}

async function getCollaboratorRole(
	repoId: number,
	userId: string,
): Promise<CollaboratorRole | null> {
	const collaborator = await db.query.repositoryCollaborators.findFirst({
		where: and(
			eq(repositoryCollaborators.repoId, repoId),
			eq(repositoryCollaborators.userId, userId),
		),
	});

	if (
		collaborator?.role === "read" ||
		collaborator?.role === "write" ||
		collaborator?.role === "admin"
	) {
		return collaborator.role;
	}

	return null;
}

export async function getRepositoryAccess(
	repoId: number,
	userId?: string | null,
): Promise<RepositoryAccess | null> {
	const repository = await db.query.repositories.findFirst({
		where: eq(repositories.id, repoId),
	});

	if (!repository) {
		return null;
	}

	if (repository.visibility === "public" && !userId) {
		return {
			repository,
			collaboratorRole: null,
			role: "anonymous",
			canRead: true,
			canWrite: false,
			canModerate: false,
			canMergePullRequest: false,
		};
	}

	if (!userId) {
		return {
			repository,
			collaboratorRole: null,
			role: "anonymous",
			canRead: false,
			canWrite: false,
			canModerate: false,
			canMergePullRequest: false,
		};
	}

	if (repository.ownerId === userId) {
		return {
			repository,
			collaboratorRole: null,
			role: "owner",
			canRead: true,
			canWrite: true,
			canModerate: true,
			canMergePullRequest: true,
		};
	}

	const collaboratorRole = await getCollaboratorRole(repoId, userId);

	if (collaboratorRole === "admin") {
		return {
			repository,
			collaboratorRole,
			role: "admin",
			canRead: true,
			canWrite: true,
			canModerate: true,
			canMergePullRequest: true,
		};
	}

	if (collaboratorRole === "write") {
		return {
			repository,
			collaboratorRole,
			role: "write",
			canRead: true,
			canWrite: true,
			canModerate: false,
			canMergePullRequest: true,
		};
	}

	if (collaboratorRole === "read") {
		return {
			repository,
			collaboratorRole,
			role: "read",
			canRead: true,
			canWrite: false,
			canModerate: false,
			canMergePullRequest: false,
		};
	}

	return {
		repository,
		collaboratorRole: null,
		role: "anonymous",
		canRead: repository.visibility === "public",
		canWrite: false,
		canModerate: false,
		canMergePullRequest: false,
	};
}

export async function canReadRepo(repoId: number, userId?: string | null) {
	const access = await getRepositoryAccess(repoId, userId);
	return access?.canRead ?? false;
}

export async function canWriteRepo(repoId: number, userId?: string | null) {
	const access = await getRepositoryAccess(repoId, userId);
	return access?.canWrite ?? false;
}

export async function canModerateRepo(repoId: number, userId?: string | null) {
	const access = await getRepositoryAccess(repoId, userId);
	return access?.canModerate ?? false;
}

export async function canMergePullRequest(
	repoId: number,
	userId?: string | null,
) {
	const access = await getRepositoryAccess(repoId, userId);
	return access?.canMergePullRequest ?? false;
}
