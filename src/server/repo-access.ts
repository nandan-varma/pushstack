import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { repositories, repositoryCollaborators } from "../db/github-schema";
import { perfNote } from "./perf-log";

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

// A single tree-page load fans out to getBranches/listFiles/getLastCommits/getCommits
// in parallel (see repo.$owner.$name.tree.$branch.$.tsx's loader), and every one of
// them independently re-resolves "does this user have access to this repo" from
// scratch — same repoId, same userId, computed 4x concurrently. Short-TTL cache +
// in-flight coalescing so those 4 calls (plus whatever already ran in
// getRepositoryByName just before them) share one DB round trip instead of each
// firing their own. TTL is intentionally short: this is a perf cache, not a
// correctness cache — a revoked collaborator or flipped visibility should take
// effect within a few seconds, not linger for the lifetime of the process like the
// long-lived git object cache does.
const ACCESS_CACHE_TTL_MS = 4000;
const accessCache = new Map<
	string,
	{ value: RepositoryAccess | null; at: number }
>();
const accessInFlight = new Map<string, Promise<RepositoryAccess | null>>();

function accessCacheKey(repoId: number, userId?: string | null): string {
	return `${repoId}:${userId ?? "anon"}`;
}

async function fetchRepoRow(repoId: number) {
	return db.query.repositories.findFirst({
		where: eq(repositories.id, repoId),
		with: { owner: true },
	});
}

/** Seed the cache with an access decision a caller already computed elsewhere
 * (e.g. getRepositoryByName, which resolves repo+access as the very first thing
 * a repo page load does) so the parallel reads that follow hit cache instead of
 * re-deriving the same answer. */
export function primeRepositoryAccessCache(
	repoId: number,
	userId: string | null | undefined,
	access: RepositoryAccess,
): void {
	accessCache.set(accessCacheKey(repoId, userId), {
		value: access,
		at: Date.now(),
	});
}

async function resolveRepositoryAccess(
	repoId: number,
	userId?: string | null,
): Promise<RepositoryAccess | null> {
	const key = accessCacheKey(repoId, userId);

	const cached = accessCache.get(key);
	if (cached && Date.now() - cached.at < ACCESS_CACHE_TTL_MS) {
		perfNote(`repo-access cache HIT ${key}`);
		return cached.value;
	}

	const existing = accessInFlight.get(key);
	if (existing) {
		perfNote(`repo-access in-flight coalesce ${key}`);
		return existing;
	}

	perfNote(`repo-access cache MISS ${key}, fetching`);
	// ponytail: fire the collaborator lookup alongside the repo fetch instead of
	// after it — most callers here are non-owners, so this is a real round trip
	// most of the time; the rare owner case just discards the wasted query below.
	const promise = (async () => {
		const [repository, speculativeCollaboratorRole] = await Promise.all([
			fetchRepoRow(repoId),
			userId ? getCollaboratorRole(repoId, userId) : Promise.resolve(null),
		]);

		if (!repository) return null;
		return buildAccess(repository, userId, speculativeCollaboratorRole);
	})();

	accessInFlight.set(key, promise);
	try {
		const result = await promise;
		accessCache.set(key, { value: result, at: Date.now() });
		return result;
	} finally {
		accessInFlight.delete(key);
	}
}

export async function getRepositoryAccess(
	repoId: number,
	userId?: string | null,
): Promise<RepositoryAccess | null> {
	return resolveRepositoryAccess(repoId, userId);
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
	const access =
		!userId || repository.ownerId === userId
			? buildAccess(repository, userId, null)
			: buildAccess(
					repository,
					userId,
					await getCollaboratorRole(repository.id, userId),
				);
	// Caller already had this repo row in hand (e.g. via a relational query), so this
	// didn't need resolveRepositoryAccess's own repo fetch — but priming its cache
	// means a sibling call in the same request (or the next few seconds) that *does*
	// go through getRepoWithReadAccess/getRepositoryAccess gets a free cache hit.
	primeRepositoryAccessCache(repository.id, userId, access);
	return access;
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
	const repo = await fetchRepoRow(repoId);

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
// each independently hit the repositories table (and require*Access's own
// getRepositoryAccess call re-fetched the row a *third* time under the hood), so a
// single call here was 2-3 concurrent duplicate reads of the exact same row. Routing
// through resolveRepositoryAccess collapses that to one fetch, and — since files.ts's
// tree-page loader calls getBranches/listFiles/getLastCommits/getCommits for the same
// (repoId, userId) all in parallel — lets those four calls share one cached result
// instead of each paying for their own.
export async function getRepoWithReadAccess(
	repoId: number,
	userId?: string | null,
) {
	const access = await resolveRepositoryAccess(repoId, userId);
	if (!access) throw new Error("Repository not found");
	if (!access.canRead) throw new Error("Access denied");
	return access.repository;
}

export async function getRepoWithWriteAccess(
	repoId: number,
	userId?: string | null,
) {
	const access = await resolveRepositoryAccess(repoId, userId);
	if (!access) throw new Error("Repository not found");
	if (!access.canWrite) throw new Error("No write access to repository");
	return access.repository;
}
