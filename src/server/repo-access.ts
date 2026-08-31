import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { repositories, repositoryCollaborators } from "../db/github-schema";
import { user } from "../db/schema";
import { perfContext, perfNote, perfStep } from "./perf-log";
import { getCurrentUserOptional } from "./session";
import { createTtlCoalescedCache } from "./ttl-cache";

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
const accessCache = createTtlCoalescedCache<RepositoryAccess | null>({
	ttlMs: ACCESS_CACHE_TTL_MS,
	onHit: (key) => perfNote(`repo-access cache HIT ${key}`),
	onMiss: (key) => perfNote(`repo-access cache MISS ${key}, fetching`),
	onCoalesce: (key) => perfNote(`repo-access in-flight coalesce ${key}`),
});

function accessCacheKey(repoId: number, userId?: string | null): string {
	return `${repoId}:${userId ?? "anon"}`;
}

async function fetchRepoRow(repoId: number) {
	const repository = await db.query.repositories.findFirst({
		where: eq(repositories.id, repoId),
		with: { owner: true },
	});

	// The relational query is the common fast path. Keep the owner lookup
	// explicit as a fallback: Git storage is keyed by the owner's username, and
	// a repository row without that relation cannot safely service a file,
	// branch, diff, or merge request. This also protects serverless deployments
	// where a stale relation map can otherwise return `owner: undefined`.
	return ensureRepositoryOwner(repoId, repository);
}

type RepositoryWithOptionalOwner = typeof repositories.$inferSelect & {
	owner?: { id: string; username: string | null; email: string } | null;
};
type RepositoryWithOwner = typeof repositories.$inferSelect & {
	owner: { id: string; username: string | null; email: string };
};

async function ensureRepositoryOwner(
	repoId: number,
	repository: RepositoryWithOptionalOwner | null | undefined,
): Promise<RepositoryWithOwner | undefined> {
	if (!repository) return undefined;
	if (repository.owner) return repository as RepositoryWithOwner;

	const [row] = await db
		.select({ repo: repositories, owner: user })
		.from(repositories)
		.innerJoin(user, eq(repositories.ownerId, user.id))
		.where(eq(repositories.id, repoId))
		.limit(1);

	return row ? { ...row.repo, owner: row.owner } : undefined;
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
	accessCache.set(accessCacheKey(repoId, userId), access);
}

async function resolveRepositoryAccess(
	repoId: number,
	userId?: string | null,
): Promise<RepositoryAccess | null> {
	const key = accessCacheKey(repoId, userId);

	return accessCache.get(key, async () => {
		// ponytail: fire the collaborator lookup alongside the repo fetch instead
		// of after it — most callers here are non-owners, so this is a real round
		// trip most of the time; the rare owner case just discards the wasted
		// query below.
		const [repository, speculativeCollaboratorRole] = await Promise.all([
			fetchRepoRow(repoId),
			userId ? getCollaboratorRole(repoId, userId) : Promise.resolve(null),
		]);

		if (!repository) return null;
		return buildAccess(repository, userId, speculativeCollaboratorRole);
	});
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
	const repository = await ensureRepositoryOwner(repoId, access.repository);
	if (!repository) throw new Error("Repository not found");
	return repository;
}

export async function getRepoWithWriteAccess(
	repoId: number,
	userId?: string | null,
) {
	const access = await resolveRepositoryAccess(repoId, userId);
	if (!access) throw new Error("Repository not found");
	if (!access.canWrite) throw new Error("No write access to repository");
	const repository = await ensureRepositoryOwner(repoId, access.repository);
	if (!repository) throw new Error("Repository not found");
	return repository;
}

// files.ts/issues.ts/pull-requests.ts each repeated the same four lines at
// nearly every read-side server function: wrap in perfContext, resolve the
// optional current user, resolve read access (throwing if denied), then run
// the actual read. This is that shape as one call — `fn` gets the resolved
// repository (already access-checked) for handlers that need its storage
// coordinates; handlers that only need the access gate can ignore it, since
// the underlying resolveRepositoryAccess call is the same either way (and
// shares its short-TTL cache with any sibling call for the same repoId+user).
export async function readWithAccess<T>(
	label: string,
	repoId: number,
	fn: (repo: Awaited<ReturnType<typeof getRepoWithReadAccess>>) => Promise<T>,
): Promise<T> {
	return perfContext(label, async () => {
		const currentUser = await perfStep("getCurrentUserOptional", () =>
			getCurrentUserOptional(),
		);
		const repo = await perfStep("getRepoWithReadAccess", () =>
			getRepoWithReadAccess(repoId, currentUser?.id),
		);
		return fn(repo);
	});
}

// repositories.ts repeated "fetch the repo, throw unless the caller is its
// owner" at every owner-only action (rename, delete, repack, manage
// collaborators) — same two lines, only the error message differed.
export async function requireOwner(
	repoId: number,
	userId: string,
	message: string,
) {
	const repo = await getRepoOrThrow(repoId);
	if (repo.ownerId !== userId) {
		throw new Error(message);
	}
	return repo;
}
