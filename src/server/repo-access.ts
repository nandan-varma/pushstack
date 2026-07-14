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
	// ponytail: fire the collaborator lookup alongside the repo fetch instead of
	// after it — most callers here are non-owners, so this is a real round trip
	// most of the time; the rare owner case just discards the wasted query below.
	const [repository, speculativeCollaboratorRole] = await Promise.all([
		db.query.repositories.findFirst({
			where: eq(repositories.id, repoId),
		}),
		userId ? getCollaboratorRole(repoId, userId) : Promise.resolve(null),
	]);

	if (!repository) {
		return null;
	}

	return buildAccess(repository, userId, speculativeCollaboratorRole);
}

// Callers that already hold a fetched repository row (e.g. via a relational
// `with: { repository: true }` query on an issue/PR/comment) used to call
// canReadRepo/canWriteRepo(repoId, ...), which re-fetches the same repository
// row from scratch — a redundant round trip to Neon on every issue/PR/comment
// read. This skips that refetch, and only queries collaborators when the
// owner/anonymous fast paths below can't already decide the answer.
export async function getAccessForRepository(
	repository: typeof repositories.$inferSelect,
	userId?: string | null,
): Promise<RepositoryAccess> {
	if (!userId || repository.ownerId === userId) {
		return buildAccess(repository, userId, null);
	}
	const collaboratorRole = await getCollaboratorRole(repository.id, userId);
	return buildAccess(repository, userId, collaboratorRole);
}

function buildAccess(
	repository: typeof repositories.$inferSelect,
	userId: string | null | undefined,
	collaboratorRole: CollaboratorRole | null,
): RepositoryAccess {
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

// --- Request-handler helpers ---
//
// files.ts and issues.ts each repeated the same "load repo, throw if missing,
// throw if the caller lacks access" shape at nearly every handler. These
// don't change the checks above — they just give call sites one place to get
// the standard "Repository not found" / access-denied errors instead of
// hand-rolling the same three lines everywhere.

export async function getRepoOrThrow(repoId: number) {
	const repo = await db.query.repositories.findFirst({
		where: eq(repositories.id, repoId),
		with: { owner: true },
	});

	if (!repo) {
		throw new Error("Repository not found");
	}

	return repo;
}

export async function requireReadAccess(
	repoId: number,
	userId?: string | null,
): Promise<void> {
	if (!(await canReadRepo(repoId, userId))) {
		throw new Error("Access denied");
	}
}

export async function requireWriteAccess(
	repoId: number,
	userId?: string | null,
): Promise<void> {
	if (!(await canWriteRepo(repoId, userId))) {
		throw new Error("No write access to repository");
	}
}

// files.ts previously did `getRepoOrThrow` then `require*Access` back to back —
// each hits the repositories table independently, so that was two sequential
// round trips to Neon per request for data neither call needed from the other.
// These run both in parallel and use allSettled (not Promise.all) so a missing
// repo still surfaces "Repository not found" rather than racing with whichever
// access-denied error happens to settle first.
export async function getRepoWithReadAccess(
	repoId: number,
	userId?: string | null,
) {
	const [repoResult, accessResult] = await Promise.allSettled([
		getRepoOrThrow(repoId),
		requireReadAccess(repoId, userId),
	]);
	if (repoResult.status === "rejected") throw repoResult.reason;
	if (accessResult.status === "rejected") throw accessResult.reason;
	return repoResult.value;
}

export async function getRepoWithWriteAccess(
	repoId: number,
	userId?: string | null,
) {
	const [repoResult, accessResult] = await Promise.allSettled([
		getRepoOrThrow(repoId),
		requireWriteAccess(repoId, userId),
	]);
	if (repoResult.status === "rejected") throw repoResult.reason;
	if (accessResult.status === "rejected") throw accessResult.reason;
	return repoResult.value;
}
