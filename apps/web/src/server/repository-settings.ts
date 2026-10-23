/**
 * Repository settings, shared by the server functions and the REST API:
 * update (rename, visibility, archive, topics, flags), delete, transfer and
 * generate-from-template. Callers authorize first; everything here assumes
 * `repo` is a fresh row (never the cached one) and the caller may change it.
 */
import { eq } from "drizzle-orm";
import { db } from "#/db";
import { type Repository, repositories } from "#/db/app-schema";
import { isUniqueViolation } from "./db-errors";
import {
	deleteRepositoryStorage,
	renameRepositoryStorage,
	transferRepositoryStorage,
} from "./git-repo";
import { withRepositoryLock } from "./git-repo-lock";
import { ownerKeyOf } from "./git-storage-naming";
import { setDefaultBranch } from "./git-write";
import { logError } from "./perf-log";
import {
	ARCHIVED_MESSAGE,
	evictRepositoryById,
	invalidateRepositoryAccess,
	type RepositoryWithOwner,
} from "./repo-access";
import { evictRepoByName } from "./repository-lookup";

export class ArchivedRepositoryError extends Error {
	constructor() {
		super(ARCHIVED_MESSAGE);
	}
}

export class RepositoryNameTakenError extends Error {
	constructor() {
		super("Repository with this name already exists");
	}
}

export interface RepositorySettingsPatch {
	name?: string;
	description?: string | null;
	homepage?: string | null;
	visibility?: "public" | "private";
	showLastCommitColumn?: boolean;
	autoRefreshPrDiffs?: boolean;
	defaultBranch?: string;
	archived?: boolean;
	isTemplate?: boolean;
	hasIssues?: boolean;
	hasWiki?: boolean;
	hasProjects?: boolean;
	topics?: string[];
}

function evictAll(repo: RepositoryWithOwner, newName?: string) {
	const ownerKey = ownerKeyOf(repo);
	evictRepoByName(ownerKey, repo.name, repo.id);
	if (newName) evictRepoByName(ownerKey, newName, repo.id);
	evictRepositoryById(repo.id);
	invalidateRepositoryAccess(repo.id);
}

/** Apply `patch`; an archived repository accepts only `archived: false`. */
export async function updateRepositorySettings(
	repo: RepositoryWithOwner,
	patch: RepositorySettingsPatch,
): Promise<Repository> {
	const { name, ...settings } = patch;
	const changes = Object.entries({ ...settings, name }).filter(
		([, value]) => value !== undefined,
	);
	if (
		repo.archived &&
		changes.some(([key, value]) => !(key === "archived" && value === false))
	) {
		throw new ArchivedRepositoryError();
	}
	const ownerKey = ownerKeyOf(repo);

	// HEAD before the row, so the row never names a branch git lacks.
	if (settings.defaultBranch && settings.defaultBranch !== repo.defaultBranch) {
		await setDefaultBranch(ownerKey, repo.name, settings.defaultBranch);
	}

	const update = () =>
		db
			.update(repositories)
			.set({
				...Object.fromEntries(
					Object.entries(settings).filter(([, value]) => value !== undefined),
				),
				...(settings.description !== undefined && {
					description: settings.description || null,
				}),
				...(settings.homepage !== undefined && {
					homepage: settings.homepage || null,
				}),
				...(name && { name }),
				updatedAt: new Date(),
			})
			.where(eq(repositories.id, repo.id))
			.returning()
			.then(([row]) => row as Repository)
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

	evictAll(repo, isRename ? name : undefined);
	return updated;
}

/** Delete the row (cascading), then the storage under the lock. */
export async function deleteRepositoryAndStorage(
	repo: RepositoryWithOwner,
): Promise<void> {
	const ownerKey = ownerKeyOf(repo);
	// The lock spans the row and the storage: a same-name create in between
	// inserts its row at once but initialises storage only under this lock, so
	// it cannot have its fresh storage wiped by our cleanup. The row goes
	// first (cascading to issues, PRs, …); a failed storage cleanup only leaves
	// unreachable objects, which the next create under this name clears.
	await withRepositoryLock(ownerKey, repo.name, async () => {
		await db.delete(repositories).where(eq(repositories.id, repo.id));
		evictAll(repo);
		await deleteRepositoryStorage(ownerKey, repo.name).catch((error: unknown) =>
			logError(
				"repositories",
				`Repository ${repo.id} deleted, but its storage cleanup failed`,
				error,
			),
		);
	});
}

/**
 * Move a repository to another user, optionally renaming it. Immediate (no
 * invitation to accept) and the old URL does not redirect. Storage keys
 * derive from the owner's username, so the move happens under both locks and
 * is undone if the row update fails.
 */
export async function transferRepository(
	repo: RepositoryWithOwner,
	newOwner: { id: string; username: string },
	newName?: string,
): Promise<Repository> {
	if (repo.archived) throw new ArchivedRepositoryError();
	const targetName = newName ?? repo.name;
	const from = ownerKeyOf(repo);
	const to = newOwner.username;
	if (newOwner.id === repo.ownerId && targetName === repo.name) return repo;
	const move = async () => {
		// Under both locks, so a concurrent create cannot take the name between
		// this check and the update.
		const clash = await db.query.repositories.findFirst({
			columns: { id: true },
			where: { ownerId: newOwner.id, name: targetName },
		});
		if (clash && clash.id !== repo.id) throw new RepositoryNameTakenError();
		// Leftovers of a failed delete under the destination must not merge in.
		await deleteRepositoryStorage(to, targetName);
		await transferRepositoryStorage(from, repo.name, to, targetName);
		try {
			return await db
				.update(repositories)
				.set({
					ownerId: newOwner.id,
					name: targetName,
					updatedAt: new Date(),
				})
				.where(eq(repositories.id, repo.id))
				.returning()
				.then(([row]) => row as Repository);
		} catch (error) {
			await transferRepositoryStorage(to, targetName, from, repo.name);
			if (isUniqueViolation(error)) throw new RepositoryNameTakenError();
			throw error;
		}
	};
	// Locks are taken in key order whatever the direction, so two opposite
	// transfers cannot each hold one lock and wait for the other's.
	const [first, second] = [
		[from, repo.name],
		[to, targetName],
	].sort((x, y) => `${x[0]}/${x[1]}`.localeCompare(`${y[0]}/${y[1]}`)) as [
		[string, string],
		[string, string],
	];
	const updated = await withRepositoryLock(first[0], first[1], () =>
		withRepositoryLock(second[0], second[1], move),
	);

	evictRepoByName(from, repo.name, repo.id);
	evictRepoByName(to, targetName, repo.id);
	evictRepositoryById(repo.id);
	invalidateRepositoryAccess(repo.id);
	return updated;
}
