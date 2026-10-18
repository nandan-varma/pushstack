/**
 * The one place that decides what a user may do with a repository, plus the
 * request-handler helpers built on it. Owners have every permission;
 * collaborators get their role's; anyone (anonymous included) may read a
 * public repository. A repository the caller can't read answers like a
 * missing one (404), so private repositories don't reveal they exist.
 */
import { notFound } from "@tanstack/react-router";
import { and, eq } from "drizzle-orm";
import { db } from "#/db";
import {
	type CollaboratorRole,
	type Repository,
	repositories,
	repositoryCollaborators,
} from "#/db/app-schema";
import { isGitNotFoundError } from "./git-errors";
import { perfContext, perfNote, perfStep } from "./perf-log";
import {
	getCurrentUser,
	getCurrentUserOptional,
	type SessionUser,
} from "./session";
import { createTtlCoalescedCache } from "./ttl-cache";

type RepositoryRole = "anonymous" | CollaboratorRole | "owner";

interface Permissions {
	canRead: boolean;
	canWrite: boolean;
	canModerate: boolean;
	canMergePullRequest: boolean;
}

export interface RepositoryAccess extends Permissions {
	repository: Repository;
	role: RepositoryRole;
}

const PERMISSIONS: Record<Exclude<RepositoryRole, "anonymous">, Permissions> = {
	owner: {
		canRead: true,
		canWrite: true,
		canModerate: true,
		canMergePullRequest: true,
	},
	admin: {
		canRead: true,
		canWrite: true,
		canModerate: true,
		canMergePullRequest: true,
	},
	write: {
		canRead: true,
		canWrite: true,
		canModerate: false,
		canMergePullRequest: true,
	},
	read: {
		canRead: true,
		canWrite: false,
		canModerate: false,
		canMergePullRequest: false,
	},
};

function buildAccess(
	repository: Repository,
	userId: string | null | undefined,
	collaboratorRole: CollaboratorRole | null,
): RepositoryAccess {
	const role: RepositoryRole =
		userId && repository.ownerId === userId
			? "owner"
			: userId && collaboratorRole
				? collaboratorRole
				: "anonymous";
	const permissions =
		role === "anonymous"
			? {
					canRead: repository.visibility === "public",
					canWrite: false,
					canModerate: false,
					canMergePullRequest: false,
				}
			: PERMISSIONS[role];
	return { repository, role, ...permissions };
}

async function getCollaboratorRole(
	repoId: number,
	userId: string,
): Promise<CollaboratorRole | null> {
	const row = await db.query.repositoryCollaborators.findFirst({
		columns: { role: true },
		where: and(
			eq(repositoryCollaborators.repoId, repoId),
			eq(repositoryCollaborators.userId, userId),
		),
	});
	return row?.role ?? null;
}

/**
 * A page load fans out to several reads for the same (repo, user) in
 * parallel; this coalesces them onto one lookup. The TTL is a few seconds, but
 * a mutation that changes who can do what to a repository (a visibility flip,
 * a collaborator added or removed, a delete) calls
 * {@link invalidateRepositoryAccess} so the new answer is live immediately
 * rather than up to a TTL later.
 */
const accessCache = createTtlCoalescedCache<RepositoryAccess | null>({
	ttlMs: 4000,
	onHit: (key) => perfNote(`repo-access cache hit ${key}`),
	onMiss: (key) => perfNote(`repo-access cache miss ${key}`),
	onCoalesce: (key) => perfNote(`repo-access coalesced ${key}`),
});

const accessKey = (repoId: number, userId?: string | null) =>
	`${repoId}:${userId ?? "anon"}`;

/**
 * Forget every cached access decision for a repository. Call from any mutation
 * that changes who may read or write it, so the change is live at once instead
 * of when the cache's TTL lapses.
 */
export function invalidateRepositoryAccess(repoId: number): void {
	accessCache.deletePrefix(`${repoId}:`);
}

/** The caller's access to a repository by id, or null when it doesn't exist. */
export function getRepositoryAccess(
	repoId: number,
	userId?: string | null,
): Promise<RepositoryAccess | null> {
	return accessCache.get(accessKey(repoId, userId), async () => {
		// The collaborator lookup runs alongside the repo fetch: most callers
		// aren't owners, and for those that are it's one wasted query.
		const [repository, collaboratorRole] = await Promise.all([
			db.query.repositories.findFirst({ where: eq(repositories.id, repoId) }),
			userId ? getCollaboratorRole(repoId, userId) : null,
		]);
		return repository
			? buildAccess(repository, userId, collaboratorRole)
			: null;
	});
}

/** Access for a repository row already in hand (no re-fetch). */
export async function getAccessForRepository(
	repository: Repository,
	userId?: string | null,
): Promise<RepositoryAccess> {
	const needsRole = !!userId && repository.ownerId !== userId;
	const access = buildAccess(
		repository,
		userId,
		needsRole ? await getCollaboratorRole(repository.id, userId) : null,
	);
	accessCache.set(accessKey(repository.id, userId), access);
	return access;
}

export async function canReadRepo(repoId: number, userId?: string | null) {
	return (await getRepositoryAccess(repoId, userId))?.canRead ?? false;
}

export async function canMergePullRequest(
	repoId: number,
	userId?: string | null,
) {
	return (
		(await getRepositoryAccess(repoId, userId))?.canMergePullRequest ?? false
	);
}

export async function canWriteRepo(repoId: number, userId?: string | null) {
	return (await getRepositoryAccess(repoId, userId))?.canWrite ?? false;
}

export async function canModerateRepo(repoId: number, userId?: string | null) {
	return (await getRepositoryAccess(repoId, userId))?.canModerate ?? false;
}

export async function requireWriteAccess(repoId: number, userId: string) {
	if (!(await canWriteRepo(repoId, userId))) {
		throw new Error("No write access to repository");
	}
}

/**
 * What the current viewer may do in a repository, for a page that must render
 * only the actions its mutations would accept. Presentation only: every
 * mutation re-checks the same permissions server-side, so a stale or forged
 * page cannot grant anything.
 */
export interface ViewerRepositoryAccess {
	/** May merge a pull request in this repository. */
	canMerge: boolean;
	/** May write to this repository (commit, comment, open issues and PRs). */
	canWrite: boolean;
}

export async function getViewerRepositoryAccess(
	repoId: number,
): Promise<ViewerRepositoryAccess> {
	const user = await getCurrentUserOptional();
	const [canMerge, canWrite] = await Promise.all([
		canMergePullRequest(repoId, user?.id),
		canWriteRepo(repoId, user?.id),
	]);
	return { canMerge, canWrite };
}

/** A repository with its owner — what storage coordinates are derived from. */
export type RepositoryWithOwner = Repository & {
	owner: { id: string; username: string };
};

async function withOwner(repoId: number): Promise<RepositoryWithOwner> {
	const repository = await db.query.repositories.findFirst({
		where: eq(repositories.id, repoId),
		with: { owner: { columns: { id: true, username: true } } },
	});
	if (!repository) throw notFound();
	return repository;
}

/**
 * A read-side server function's body: perf context, optional current user,
 * read access (404 otherwise), then `fn` with the repository. A missing
 * branch, path or commit inside `fn` is a 404 too.
 */
export function readWithAccess<T>(
	label: string,
	repoId: number,
	fn: (repo: RepositoryWithOwner) => Promise<T>,
): Promise<T> {
	return perfContext(label, async () => {
		const user = await perfStep(
			"getCurrentUserOptional",
			getCurrentUserOptional,
		);
		const access = await perfStep("getRepositoryAccess", () =>
			getRepositoryAccess(repoId, user?.id),
		);
		if (!access?.canRead) throw notFound();
		try {
			return await fn(await withOwner(repoId));
		} catch (error) {
			if (isGitNotFoundError(error)) throw notFound();
			throw error;
		}
	});
}

/** A write-side server function's body: signed-in user with write access, then `fn`. */
export async function writeWithAccess<T>(
	repoId: number,
	fn: (repo: RepositoryWithOwner, user: SessionUser) => Promise<T>,
): Promise<T> {
	const user = await getCurrentUser();
	await requireWriteAccess(repoId, user.id);
	return fn(await withOwner(repoId), user);
}

/** The repository, if `userId` owns it; throws `message` otherwise. */
export async function requireOwner(
	repoId: number,
	userId: string,
	message: string,
): Promise<RepositoryWithOwner> {
	const repository = await withOwner(repoId);
	if (repository.ownerId !== userId) throw new Error(message);
	return repository;
}
