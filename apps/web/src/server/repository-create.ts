import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { repositories } from "#/db/app-schema";
import { MAX_REPO_DESCRIPTION_CHARS } from "#/lib/limits";
import { MAX_STORAGE_NAME_LENGTH, STORAGE_NAME_RE } from "#/lib/storage-name";
import {
	GITIGNORE_TEMPLATE_NAMES,
	GITIGNORE_TEMPLATES,
	LICENSE_TEMPLATE_KEYS,
	renderLicense,
	renderReadme,
} from "#/lib/templates";
import { recordActivity } from "./activity";
import { isUniqueViolation } from "./db-errors";
import { deleteRepositoryStorage, initBareRepo } from "./git-repo";
import { withRepositoryLock } from "./git-repo-lock";
import { createInitialCommitUnlocked } from "./git-write";
import { createDefaultLabels } from "./label-store";
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
	description: z.string().trim().max(MAX_REPO_DESCRIPTION_CHARS).optional(),
	visibility: z.enum(["public", "private"]).default("public"),
	autoInit: z.boolean().default(false),
	gitignoreTemplate: z.enum(GITIGNORE_TEMPLATE_NAMES).optional(),
	licenseTemplate: z.enum(LICENSE_TEMPLATE_KEYS).optional(),
});
export type CreateRepositoryInput = z.infer<typeof createRepositoryInputSchema>;

const NEW_REPOSITORY_DEFAULT_BRANCH = "main";

export class RepositoryExistsError extends Error {
	constructor() {
		super("Repository with this name already exists");
	}
}

/** Insert the row, then init storage under the lock; rolls the row back on failure. */
export async function createRepositoryForUser(
	owner: { id: string; username: string; name: string; email: string },
	data: CreateRepositoryInput,
) {
	const initialFiles: Array<{ path: string; content: string }> = [];
	if (data.autoInit) {
		initialFiles.push({
			path: "README.md",
			content: renderReadme(data.name, data.description),
		});
	}
	if (data.gitignoreTemplate) {
		initialFiles.push({
			path: ".gitignore",
			content: GITIGNORE_TEMPLATES[data.gitignoreTemplate],
		});
	}
	if (data.licenseTemplate) {
		initialFiles.push({
			path: "LICENSE",
			content: renderLicense(data.licenseTemplate, {
				year: new Date().getUTCFullYear(),
				fullname: owner.name,
			}),
		});
	}
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
			if (initialFiles.length > 0) {
				await createInitialCommitUnlocked(owner.username, repo.name, {
					branch: NEW_REPOSITORY_DEFAULT_BRANCH,
					message: "Initial commit",
					files: initialFiles,
					author: { name: owner.name, email: owner.email },
				});
			}
		});
	} catch (error) {
		await db.delete(repositories).where(eq(repositories.id, repo.id));
		throw error;
	}

	await createDefaultLabels(repo.id);
	// A lookup that missed before the insert is cached as "not found".
	evictRepoByName(owner.username, repo.name, repo.id);
	await recordActivity(owner.id, repo.id, {
		type: "create_repo",
		metadata: { repoName: repo.name },
	});
	return repo;
}
