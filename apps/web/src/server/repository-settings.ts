/**
 * Repository settings writes shared by the settings server functions and the
 * REST API (`repos/update`, `repos/delete`): rename, description, visibility,
 * default branch and delete. Callers check that the caller owns the
 * repository first.
 */
import { eq } from "drizzle-orm";
import { db } from "#/db";
import { type Repository, repositories } from "#/db/app-schema";
import { isUniqueViolation } from "./db-errors";
import { deleteRepositoryStorage, renameRepositoryStorage } from "./git-repo";
import { withRepositoryLock } from "./git-repo-lock";
import { ownerKeyOf } from "./git-storage-naming";
import { setDefaultBranch } from "./git-write";
import { logError } from "./perf-log";
import { invalidateRepositoryAccess } from "./repo-access";
import { evictRepoByName } from "./repository-lookup";

export interface RepositorySettings {
	name?: string;
	description?: string | null;
	visibility?: "public" | "private";
	showLastCommitColumn?: boolean;
	autoRefreshPrDiffs?: boolean;
	defaultBranch?: string;
}

/** Another repository of the owner already has the requested name. */
export class RepositoryNameTakenError extends Error {
	constructor() {
		super("Repository with this name already exists");
		this.name = "RepositoryNameTakenError";
	}
}

/**
 * Apply `changes` to `repo` (owned by the username `repo` keys storage under).
 * A missing default branch rejects with the git library's not-found error
 * before anything changes.
 */
export async function updateRepositorySettings(
	repo: Repository & { owner: { username: string } },
	changes: RepositorySettings,
): Promise<Repository> {
	const ownerKey = ownerKeyOf(repo);
	const { name, ...settings } = changes;

	// HEAD before the row, so the row never names a branch git lacks.
	if (settings.defaultBranch && settings.defaultBranch !== repo.defaultBranch) {
		await setDefaultBranch(ownerKey, repo.name, settings.defaultBranch);
	}

	const update = () =>
		db
			.update(repositories)
			.set({ ...settings, ...(name && { name }), updatedAt: new Date() })
			.where(eq(repositories.id, repo.id))
			.returning()
			.then(([row]) => {
				if (!row) throw new Error(`Repository ${repo.id} vanished mid-update`);
				return row;
			})
			.catch((error: unknown) => {
				if (isUniqueViolation(error)) throw new RepositoryNameTakenError();
				throw error;
			});

	// A rename moves the storage (keyed by name) and the row in one lock span,
	// so nothing observes a half-renamed repository.
	const isRename = !!name && name !== repo.name;
	const updated = isRename
		? await withRepositoryLock(ownerKey, repo.name, async () => {
				await renameRepositoryStorage(ownerKey, repo.name, name);
				try {
					return await update();
				} catch (error) {
					await renameRepositoryStorage(ownerKey, name, repo.name);
					throw error;
				}
			})
		: await update();

	evictRepoByName(ownerKey, repo.name, repo.id);
	if (isRename) evictRepoByName(ownerKey, name, repo.id);
	// A visibility flip changes who may read the repository, and the access
	// cache is keyed per (repo, user) — drop every entry for it.
	if (settings.visibility !== undefined) invalidateRepositoryAccess(repo.id);
	return updated;
}

/** Delete `repo`: its row (cascading to issues, PRs, …), then its storage. */
export async function deleteRepositoryAndStorage(
	repo: Repository & { owner: { username: string } },
): Promise<void> {
	const ownerKey = ownerKeyOf(repo);
	// The row first: once it's gone nothing resolves this repository, so a
	// failed storage cleanup only leaves unreachable objects, which the next
	// create under this name clears.
	await db.delete(repositories).where(eq(repositories.id, repo.id));
	evictRepoByName(ownerKey, repo.name, repo.id);
	invalidateRepositoryAccess(repo.id);
	await withRepositoryLock(ownerKey, repo.name, () =>
		deleteRepositoryStorage(ownerKey, repo.name),
	).catch((error: unknown) =>
		logError(
			"repositories",
			`Repository ${repo.id} deleted, but its storage cleanup failed`,
			error,
		),
	);
}
