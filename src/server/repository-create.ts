/**
 * Creating a repository, shared by the `createRepository` server function and
 * the REST API (plain server-only module — see repository-lookup.ts for why
 * this is not in repositories.ts).
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { repositories } from "#/db/app-schema";
import { MAX_STORAGE_NAME_LENGTH, STORAGE_NAME_RE } from "#/lib/storage-name";
import { recordActivity } from "./activity";
import { deleteRepositoryStorage, initBareRepo } from "./git-repo";
import { withRepositoryLock } from "./git-repo-lock";
import { evictRepoByName } from "./repository-lookup";

/** Also a storage-path segment, so this is a security boundary, not cosmetics. */
export const repoNameSchema = z
	.string()
	.max(MAX_STORAGE_NAME_LENGTH)
	.regex(
		STORAGE_NAME_RE,
		"Use letters, numbers, dots, hyphens and underscores, starting and ending with a letter or number",
	);

export const createRepositoryInputSchema = z.object({
	name: repoNameSchema,
	description: z.string().trim().max(500).optional(),
	visibility: z.enum(["public", "private"]).default("public"),
});
export type CreateRepositoryInput = z.infer<typeof createRepositoryInputSchema>;

const NEW_REPOSITORY_DEFAULT_BRANCH = "main";

/** The caller already owns a repository with this name. */
export class RepositoryExistsError extends Error {
	constructor() {
		super("Repository with this name already exists");
	}
}

/** Postgres SQLSTATE 23505; drizzle wraps driver errors, keeping it on `cause`. */
export function isUniqueViolation(error: unknown): boolean {
	const err = error as { code?: unknown; cause?: { code?: unknown } } | null;
	return err?.code === "23505" || err?.cause?.code === "23505";
}

/** Insert the row, then init storage under the lock; rolls the row back on failure. */
export async function createRepositoryForUser(
	owner: { id: string; username: string },
	data: CreateRepositoryInput,
) {
	// The row first: the (owner, name) unique index settles a creation race
	// before anything touches storage.
	const repo = await db
		.insert(repositories)
		.values({
			ownerId: owner.id,
			name: data.name,
			description: data.description || null,
			visibility: data.visibility,
			defaultBranch: NEW_REPOSITORY_DEFAULT_BRANCH,
		})
		.returning()
		.then(([row]) => row)
		.catch((error: unknown) => {
			if (isUniqueViolation(error)) throw new RepositoryExistsError();
			throw error;
		});
	if (!repo) throw new Error("Repository insert returned no row");

	try {
		// Anything already under this prefix is a leftover of a delete whose
		// storage cleanup failed; it must not become this repository's history.
		await withRepositoryLock(owner.username, repo.name, async () => {
			await deleteRepositoryStorage(owner.username, repo.name);
			await initBareRepo(
				owner.username,
				repo.name,
				NEW_REPOSITORY_DEFAULT_BRANCH,
			);
		});
	} catch (error) {
		await db.delete(repositories).where(eq(repositories.id, repo.id));
		throw error;
	}

	// A lookup that missed before the insert is cached as "not found".
	evictRepoByName(owner.username, repo.name);
	await recordActivity(owner.id, repo.id, {
		type: "create_repo",
		metadata: { repoName: repo.name },
	});
	return repo;
}
