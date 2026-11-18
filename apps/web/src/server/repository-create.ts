import { inputs } from "@pushstack/api-contract";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { repositories } from "#/db/app-schema";
import {
	MAX_ARCHIVE_BYTES,
	MAX_REPO_DESCRIPTION_CHARS,
	MAX_REPO_HOMEPAGE_CHARS,
} from "#/lib/limits";
import {
	GITIGNORE_TEMPLATE_NAMES,
	GITIGNORE_TEMPLATES,
	LICENSE_TEMPLATE_KEYS,
	renderLicense,
	renderReadme,
} from "#/lib/templates";
import { recordActivity } from "./activity";
import { isUniqueViolation } from "./db-errors";
import { createDefaultDiscussionCategories } from "./discussion-store";
import { ArchiveLimitError, planArchive, readArchiveBlob } from "./git-read";
import { deleteRepositoryStorage, initBareRepo } from "./git-repo";
import { withRepositoryLock } from "./git-repo-lock";
import { createInitialCommitUnlocked } from "./git-write";
import { createDefaultLabels } from "./label-store";
import { evictRepoByName } from "./repository-lookup";
import { deleteRepositoryAndStorage } from "./repository-settings";
import { setRepoSubscription } from "./watch-store";

/** Also a storage-path segment, so this is a security boundary, not cosmetics. */
export const repoNameSchema = inputs.repoName;

export const createRepositoryInputSchema = z.object({
	name: repoNameSchema,
	description: z.string().trim().max(MAX_REPO_DESCRIPTION_CHARS).optional(),
	/** An http(s) URL; the REST handler checks it before the row is written. */
	homepage: z.string().trim().max(MAX_REPO_HOMEPAGE_CHARS).optional(),
	hasIssues: z.boolean().optional(),
	hasWiki: z.boolean().optional(),
	hasProjects: z.boolean().optional(),
	isTemplate: z.boolean().optional(),
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

/**
 * A repository owner: the column it fills (`owner_id` or `organization_id`),
 * its row id and its storage key. Name and email author the initial commit.
 */
export type RepositoryOwnerInput =
	| {
			kind: "user";
			id: string;
			login: string;
			name: string;
			email: string;
	  }
	| {
			kind: "organization";
			id: number;
			login: string;
			name: string;
			email: string;
	  };

function ownerColumns(owner: RepositoryOwnerInput) {
	return owner.kind === "user"
		? { ownerId: owner.id }
		: { organizationId: owner.id };
}

/** Insert the row, then init storage under the lock; rolls the row back on failure. */
export async function createRepositoryForOwner(
	owner: RepositoryOwnerInput,
	data: CreateRepositoryInput,
	/** Files for the initial commit, instead of the README and templates (a generated repository). */
	templateFiles?: Array<{ path: string; content: Uint8Array }>,
) {
	const initialFiles: Array<{ path: string; content: string | Uint8Array }> =
		templateFiles ? [...templateFiles] : [];
	if (data.autoInit && !templateFiles) {
		initialFiles.push({
			path: "README.md",
			content: renderReadme(data.name, data.description),
		});
	}
	if (data.gitignoreTemplate && !templateFiles) {
		initialFiles.push({
			path: ".gitignore",
			content: GITIGNORE_TEMPLATES[data.gitignoreTemplate],
		});
	}
	if (data.licenseTemplate && !templateFiles) {
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
			...ownerColumns(owner),
			name: data.name,
			description: data.description || null,
			homepage: data.homepage || null,
			visibility: data.visibility,
			defaultBranch: NEW_REPOSITORY_DEFAULT_BRANCH,
			hasIssues: data.hasIssues ?? true,
			hasWiki: data.hasWiki ?? true,
			hasProjects: data.hasProjects ?? false,
			isTemplate: data.isTemplate ?? false,
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
		await withRepositoryLock(owner.login, repo.name, async () => {
			await deleteRepositoryStorage(owner.login, repo.name);
			await initBareRepo(owner.login, repo.name, NEW_REPOSITORY_DEFAULT_BRANCH);
			if (initialFiles.length > 0) {
				await createInitialCommitUnlocked(owner.login, repo.name, {
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

	try {
		await createDefaultLabels(repo.id);
		await createDefaultDiscussionCategories(repo.id);
	} catch (error) {
		await deleteRepositoryAndStorage({
			...repo,
			owner: { username: owner.login, login: owner.login },
		});
		throw error;
	}
	// A lookup that missed before the insert is cached as "not found".
	evictRepoByName(owner.login, repo.name, repo.id);
	if (owner.kind === "user") {
		// GitHub subscribes the creator to their new repository.
		await setRepoSubscription(repo.id, owner.id, false);
		await recordActivity(owner.id, repo.id, {
			type: "create_repo",
			metadata: { repoName: repo.name },
		});
	}
	return repo;
}

/**
 * A new repository holding a snapshot of a template's default branch as one
 * `Initial commit` (no history, as on GitHub). Files only: symlinks and
 * submodule pointers are skipped, the executable bit is not kept, and the
 * archive limits bound the copy.
 */
export async function generateRepositoryFromTemplate(
	template: {
		name: string;
		defaultBranch: string;
		owner: { login: string };
	},
	owner: RepositoryOwnerInput,
	data: {
		name: string;
		description?: string;
		visibility: "public" | "private";
	},
) {
	const plan = await planArchive(
		template.owner.login,
		template.name,
		template.defaultBranch,
	);
	const budget = { remaining: MAX_ARCHIVE_BYTES };
	const files: Array<{ path: string; content: Uint8Array }> = [];
	for (const node of plan.nodes) {
		if (node.kind !== "file") continue;
		files.push({
			path: node.path,
			content: await readArchiveBlob(
				template.owner.login,
				template.name,
				node.oid,
				budget,
			),
		});
	}
	if (files.length === 0) {
		throw new ArchiveLimitError("The template repository has no files");
	}
	return createRepositoryForOwner(owner, { ...data, autoInit: false }, files);
}
