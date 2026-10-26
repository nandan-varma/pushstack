/**
 * Forking: a new repository owned by the caller whose git data is a copy of
 * its parent's.
 *
 * Ordering is what keeps a fork from ever being empty: the storage copy runs
 * first, under the parent's and the fork name's locks, and the row is inserted
 * only after the copy and HEAD are written. A row therefore means a complete
 * fork. A copy that fails, or is killed mid-way, leaves storage but no row,
 * and the next attempt under the same name clears that storage before copying.
 * Concurrent duplicates wait on the fork-name lock and then find the row.
 */

import { and, count, inArray } from "drizzle-orm";
import { PrefixTooLargeError } from "git-fs-s3";
import { db } from "#/db";
import { type Repository, repositories } from "#/db/app-schema";
import { MAX_FORK_COPY_BYTES } from "#/lib/limits";
import { isUniqueViolation } from "./db-errors";
import { deleteRepositoryStorage, forkRepositoryStorage } from "./git-repo";
import { withRepositoryLocks } from "./git-repo-lock";
import { logError } from "./perf-log";
import { getRepositoryAccess, readableForViewer } from "./repo-access";
import { RepositoryExistsError } from "./repository-create";
import {
	evictRepoByName,
	publicUserFields,
	type RepositoryRowWithOwner,
} from "./repository-lookup";
import { setRepoSubscription } from "./watch-store";

/** Forks of forks deeper than this are not walked to their root (`source` is then omitted). */
const MAX_FORK_CHAIN_DEPTH = 64;

/**
 * The root of a fork network (GitHub's `source`): the repository that is not
 * itself a fork, reached by following `fork_of_id`. Null when the walk is too
 * deep or a link was deleted, since the root is then unknown.
 */
export async function forkSourceOf(
	repo: Repository,
): Promise<RepositoryRowWithOwner | null> {
	let current = repo;
	for (let depth = 0; current.isFork; depth++) {
		if (current.forkOfId === null || depth >= MAX_FORK_CHAIN_DEPTH) return null;
		const parent = await db.query.repositories.findFirst({
			where: { id: current.forkOfId },
		});
		if (!parent) return null;
		current = parent;
	}
	const root = await db.query.repositories.findFirst({
		where: { id: current.id },
		with: { owner: publicUserFields },
	});
	return root ?? null;
}

/** The parent is too large to copy within one request. */
export class ForkTooLargeError extends Error {
	constructor(bytes: number) {
		super(
			`Repository is too large to fork: ${bytes} bytes, the limit is ${MAX_FORK_COPY_BYTES} bytes`,
		);
	}
}

/** The parent was renamed, transferred or deleted while the fork was being made. */
export class ForkParentChangedError extends Error {
	constructor() {
		super("The repository changed while it was being forked");
	}
}

/**
 * Fork `parent` into `owner`'s account under `name`. Answers the existing fork
 * when `owner` already forked this parent under that name (GitHub returns it
 * too); any other repository of that name is a {@link RepositoryExistsError}.
 */
export function forkRepositoryForUser(
	parent: Repository & { owner: { id: string; username: string } },
	owner: { id: string; username: string },
	name: string,
): Promise<Repository> {
	return withRepositoryLocks(
		[
			{ ownerKey: parent.owner.username, repoName: parent.name },
			{ ownerKey: owner.username, repoName: name },
		],
		() => forkUnderLocks(parent, owner, name),
	);
}

/** Runs under the parent's and the fork name's locks (see withRepositoryLocks). */
async function forkUnderLocks(
	parent: Repository & { owner: { id: string; username: string } },
	owner: { id: string; username: string },
	name: string,
): Promise<Repository> {
	// Re-read the parent under its lock: a rename or transfer that finished
	// after the caller's read would otherwise copy from a prefix that is gone.
	const current = await db.query.repositories.findFirst({
		where: { id: parent.id },
		with: { owner: { columns: { username: true } } },
	});
	if (
		!current ||
		current.name !== parent.name ||
		current.owner.username !== parent.owner.username
	) {
		throw new ForkParentChangedError();
	}
	// A row exists only once its copy has committed, so this answers only a
	// complete fork. A request that waited on the lock behind a copy lands here.
	const existing = await db.query.repositories.findFirst({
		where: { ownerId: owner.id, name },
	});
	if (existing) {
		if (existing.isFork && existing.forkOfId === parent.id) return existing;
		throw new RepositoryExistsError();
	}
	await copyStorage(parent, owner.username, name, current.defaultBranch);
	const fork = await insertForkRow(parent, owner, name);
	// Storage and row are both committed now: nothing below may fail the request.
	try {
		await setRepoSubscription(fork.id, owner.id, false);
	} catch (error) {
		logError("repository-fork", `subscribing to fork ${fork.id}`, error);
	}
	// A lookup that missed before the insert is cached as "not found".
	evictRepoByName(owner.username, name, fork.id);
	return fork;
}

/**
 * Copy the parent's git data into the fork's prefix. On failure the partial
 * prefix is removed; if that removal fails too it is logged, and the orphan
 * is cleared by the next fork or create under this name (no row points at it).
 */
async function copyStorage(
	parent: Repository & { owner: { username: string } },
	forkOwnerKey: string,
	forkName: string,
	defaultBranch: string,
): Promise<void> {
	try {
		await forkRepositoryStorage(
			{ ownerKey: parent.owner.username, repoName: parent.name },
			{ ownerKey: forkOwnerKey, repoName: forkName },
			defaultBranch,
			MAX_FORK_COPY_BYTES,
		);
	} catch (error) {
		await removeOrphanStorage(forkOwnerKey, forkName);
		throw error instanceof PrefixTooLargeError
			? new ForkTooLargeError(error.bytes)
			: error;
	}
}

async function removeOrphanStorage(ownerKey: string, name: string) {
	await deleteRepositoryStorage(ownerKey, name).catch((cleanupError: unknown) =>
		logError(
			"repository-fork",
			`removing the storage of a failed fork ${ownerKey}/${name} (orphaned until the next fork or create of that name)`,
			cleanupError,
		),
	);
}

async function insertForkRow(
	parent: Repository & { owner: { id: string; username: string } },
	owner: { id: string; username: string },
	name: string,
): Promise<Repository> {
	try {
		const [repo] = await db
			.insert(repositories)
			.values({
				ownerId: owner.id,
				name,
				description: parent.description,
				visibility: parent.visibility,
				defaultBranch: parent.defaultBranch,
				forkOfId: parent.id,
				isFork: true,
			})
			.returning();
		if (!repo) throw new Error("Fork insert returned no row");
		return repo;
	} catch (error) {
		// A repository of this name was created outside the fork lock (its row
		// goes in before its lock), so the copy we made is not ours to keep.
		await removeOrphanStorage(owner.username, name);
		if (isUniqueViolation(error)) throw new RepositoryExistsError();
		throw error;
	}
}

/**
 * `forks_count` for each repository: the forks of it the viewer can read, so
 * a count never reveals a private fork. Repositories with none are absent.
 */
export async function readableForkCounts(
	repoIds: number[],
	viewerId: string | null | undefined,
): Promise<Map<number, number>> {
	if (repoIds.length === 0) return new Map();
	const rows = await db
		.select({ parentId: repositories.forkOfId, total: count() })
		.from(repositories)
		.where(
			and(inArray(repositories.forkOfId, repoIds), readableForViewer(viewerId)),
		)
		.groupBy(repositories.forkOfId);
	return new Map(
		rows.flatMap((row) =>
			row.parentId === null ? [] : [[row.parentId, row.total] as const],
		),
	);
}

/**
 * A fork's `parent` and `source` for a viewer, each present only when the
 * viewer can read it: an unreadable link is omitted, never named. A fork whose
 * parent was deleted has neither.
 */
export async function readableForkLinks(
	repo: Repository,
	viewerId: string | null | undefined,
): Promise<{
	parent?: RepositoryRowWithOwner;
	source?: RepositoryRowWithOwner;
}> {
	if (!repo.isFork) return {};
	const readable = async (row: RepositoryRowWithOwner | null) =>
		row && (await getRepositoryAccess(row.id, viewerId))?.canRead ? row : null;
	const parentRow =
		repo.forkOfId === null
			? null
			: await db.query.repositories.findFirst({
					where: { id: repo.forkOfId },
					with: { owner: publicUserFields },
				});
	const parent = await readable(parentRow ?? null);
	const sourceRow = await forkSourceOf(repo);
	const source =
		sourceRow && parent && sourceRow.id === parent.id
			? parent
			: await readable(sourceRow);
	return {
		...(parent && { parent }),
		...(source && { source }),
	};
}
