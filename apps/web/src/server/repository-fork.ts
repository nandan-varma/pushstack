/**
 * Forking: a new repository owned by the caller whose git data is a copy of
 * its parent's. The fork's row is inserted first, so the (owner, name) unique
 * index settles a name race before storage is touched; the storage copy runs
 * under both repositories' locks and is undone (storage and row) on failure.
 */
import { eq } from "drizzle-orm";
import { PrefixTooLargeError } from "git-fs-s3";
import { db } from "#/db";
import { type Repository, repositories } from "#/db/app-schema";
import { MAX_FORK_COPY_BYTES } from "#/lib/limits";
import { isUniqueViolation } from "./db-errors";
import { deleteRepositoryStorage, forkRepositoryStorage } from "./git-repo";
import { withRepositoryLock } from "./git-repo-lock";
import { logError } from "./perf-log";
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
export async function forkRepositoryForUser(
	parent: Repository & { owner: { id: string; username: string } },
	owner: { id: string; username: string },
	name: string,
): Promise<Repository> {
	const row = await insertForkRow(parent, owner, name);
	if (!row.created) return row.repo;
	const fork = row.repo;
	try {
		await withRepositoryLock(parent.owner.username, parent.name, () =>
			withRepositoryLock(owner.username, name, () =>
				copyParentIntoFork(parent, fork, owner.username),
			),
		);
	} catch (error) {
		await db.delete(repositories).where(eq(repositories.id, fork.id));
		throw error;
	}
	await setRepoSubscription(fork.id, owner.id, false);
	// A lookup that missed before the insert is cached as "not found".
	evictRepoByName(owner.username, name, fork.id);
	return fork;
}

async function insertForkRow(
	parent: Repository & { owner: { id: string; username: string } },
	owner: { id: string; username: string },
	name: string,
): Promise<{ repo: Repository; created: boolean }> {
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
		return { repo, created: true };
	} catch (error) {
		if (!isUniqueViolation(error)) throw error;
	}
	const existing = await db.query.repositories.findFirst({
		where: { ownerId: owner.id, name },
	});
	if (existing?.isFork && existing.forkOfId === parent.id) {
		return { repo: existing, created: false };
	}
	throw new RepositoryExistsError();
}

/** Runs under the parent's and the fork's locks. */
async function copyParentIntoFork(
	parent: Repository & { owner: { username: string } },
	fork: Repository,
	forkOwnerKey: string,
): Promise<void> {
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
	try {
		await forkRepositoryStorage(
			{ ownerKey: parent.owner.username, repoName: parent.name },
			{ ownerKey: forkOwnerKey, repoName: fork.name },
			current.defaultBranch,
			MAX_FORK_COPY_BYTES,
		);
	} catch (error) {
		await deleteRepositoryStorage(forkOwnerKey, fork.name).catch(
			(cleanupError: unknown) =>
				logError(
					"repository-fork",
					"removing a failed fork's storage",
					cleanupError,
				),
		);
		throw translateCopyError(error);
	}
}

function translateCopyError(error: unknown): unknown {
	return error instanceof PrefixTooLargeError
		? new ForkTooLargeError(error.bytes)
		: error;
}
