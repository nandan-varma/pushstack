/** Server functions for repositories: create, read, settings, stars, collaborators. */
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { repositories, repositoryCollaborators, stars } from "#/db/app-schema";
import { user } from "#/db/schema";
import { MAX_LIST_SKIP } from "#/lib/limits";
import { MAX_STORAGE_NAME_LENGTH, STORAGE_NAME_RE } from "#/lib/storage-name";
import { recordActivity } from "./activity";
import { safeBranchNameSchema } from "./git-ref-name";
import {
	deleteRepositoryStorage,
	initBareRepo,
	renameRepositoryStorage,
	repackRepositoryNow,
} from "./git-repo";
import { withRepositoryLock } from "./git-repo-lock";
import { ownerKeyOf } from "./git-storage-naming";
import { setDefaultBranch } from "./git-write";
import { logError, perfContext, perfStep } from "./perf-log";
import {
	canModerateRepo,
	canReadRepo,
	getAccessForRepository,
	invalidateRepositoryAccess,
	requireOwner,
} from "./repo-access";
import {
	evictRepoByName,
	findRepositoryByName,
	publicUserFields,
} from "./repository-lookup";
import { getCurrentUser, getCurrentUserOptional } from "./session";

/** Also a storage-path segment, so this is a security boundary, not cosmetics. */
const repoNameSchema = z
	.string()
	.max(MAX_STORAGE_NAME_LENGTH)
	.regex(
		STORAGE_NAME_RE,
		"Use letters, numbers, dots, hyphens and underscores, starting and ending with a letter or number",
	);

/**
 * A username used to look someone up. The same shape the username plugin
 * allows at sign-up (3–30 characters, `STORAGE_NAME_RE`), so a value that
 * cannot name a user fails validation instead of becoming a query that can
 * only miss.
 */
const usernameSchema = z
	.string()
	.min(3)
	.max(30)
	.regex(STORAGE_NAME_RE, "Not a valid username");

const NEW_REPOSITORY_DEFAULT_BRANCH = "main";
/** Postgres SQLSTATE 23505; drizzle wraps driver errors, keeping it on `cause`. */
function isUniqueViolation(error: unknown): boolean {
	const err = error as { code?: unknown; cause?: { code?: unknown } } | null;
	return err?.code === "23505" || err?.cause?.code === "23505";
}

export const createRepository = createServerFn({ method: "POST" })
	.validator(
		z.object({
			name: repoNameSchema,
			description: z.string().trim().max(500).optional(),
			visibility: z.enum(["public", "private"]).default("public"),
		}),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		// The row first: the (owner, name) unique index settles a creation race
		// before anything touches storage.
		const repo = await db
			.insert(repositories)
			.values({
				ownerId: currentUser.id,
				name: data.name,
				description: data.description || null,
				visibility: data.visibility,
				defaultBranch: NEW_REPOSITORY_DEFAULT_BRANCH,
			})
			.returning()
			.then(([row]) => row)
			.catch((error: unknown) => {
				if (isUniqueViolation(error)) {
					throw new Error("Repository with this name already exists");
				}
				throw error;
			});
		if (!repo) throw new Error("Repository insert returned no row");

		const ownerKey = currentUser.username;
		try {
			// Anything already under this prefix is a leftover of a delete whose
			// storage cleanup failed; it must not become this repository's history.
			await withRepositoryLock(ownerKey, repo.name, async () => {
				await deleteRepositoryStorage(ownerKey, repo.name);
				await initBareRepo(ownerKey, repo.name, NEW_REPOSITORY_DEFAULT_BRANCH);
			});
		} catch (error) {
			await db.delete(repositories).where(eq(repositories.id, repo.id));
			throw error;
		}

		await recordActivity(currentUser.id, repo.id, {
			type: "create_repo",
			metadata: { repoName: repo.name },
		});
		return { ...repo, owner: { username: ownerKey } };
	});

/** A user's repositories, newest first: all of them for the owner, public ones for others. */
export const getUserRepositories = createServerFn({ method: "GET" })
	.validator(
		z.object({
			userId: z.string().optional(),
			limit: z.number().int().min(1).max(100).default(100),
			skip: z.number().int().min(0).max(MAX_LIST_SKIP).default(0),
		}),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		const ownerId = data.userId ?? currentUser.id;
		return db.query.repositories.findMany({
			where:
				ownerId === currentUser.id
					? eq(repositories.ownerId, ownerId)
					: and(
							eq(repositories.ownerId, ownerId),
							eq(repositories.visibility, "public"),
						),
			orderBy: [desc(repositories.updatedAt)],
			with: { owner: publicUserFields },
			limit: data.limit,
			offset: data.skip,
		});
	});

async function starState(repoId: number, userId: string | undefined) {
	const [[total], mine] = await Promise.all([
		db.select({ value: count() }).from(stars).where(eq(stars.repoId, repoId)),
		userId
			? db.query.stars.findFirst({
					columns: { id: true },
					where: and(eq(stars.repoId, repoId), eq(stars.userId, userId)),
				})
			: undefined,
	]);
	return { starCount: total?.value ?? 0, isStarred: !!mine };
}

/** A repository page's repository, with stars; 404 when missing or unreadable. */
export const getRepositoryByName = createServerFn({ method: "GET" })
	.validator(z.object({ owner: z.string(), name: z.string() }))
	.handler(({ data }) =>
		perfContext(`getRepositoryByName ${data.owner}/${data.name}`, async () => {
			const [currentUser, repo] = await perfStep("session + repository", () =>
				Promise.all([
					getCurrentUserOptional(),
					findRepositoryByName(data.owner, data.name),
				]),
			);
			if (!repo) throw notFound();
			// Also primes the access cache the page's follow-up reads hit.
			const [access, stars] = await perfStep("access + stars", () =>
				Promise.all([
					getAccessForRepository(repo, currentUser?.id),
					starState(repo.id, currentUser?.id),
				]),
			);
			if (!access.canRead) throw notFound();
			return { ...repo, ...stars };
		}),
	);

export const updateRepository = createServerFn({ method: "POST" })
	.validator(
		z.object({
			id: z.number(),
			name: repoNameSchema.optional(),
			description: z.string().trim().max(500).optional(),
			visibility: z.enum(["public", "private"]).optional(),
			showLastCommitColumn: z.boolean().optional(),
			autoRefreshPrDiffs: z.boolean().optional(),
			defaultBranch: safeBranchNameSchema.optional(),
		}),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		const repo = await requireOwner(
			data.id,
			currentUser.id,
			"Only the repository owner can change settings",
		);
		const ownerKey = ownerKeyOf(repo);
		const { id, name, ...settings } = data;

		// HEAD before the row, so the row never names a branch git lacks.
		if (
			settings.defaultBranch &&
			settings.defaultBranch !== repo.defaultBranch
		) {
			await setDefaultBranch(ownerKey, repo.name, settings.defaultBranch);
		}

		const update = () =>
			db
				.update(repositories)
				.set({ ...settings, ...(name && { name }), updatedAt: new Date() })
				.where(eq(repositories.id, id))
				.returning()
				.then(([row]) => row)
				.catch((error: unknown) => {
					if (isUniqueViolation(error)) {
						throw new Error("Repository with this name already exists");
					}
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

		evictRepoByName(ownerKey, repo.name);
		if (isRename) evictRepoByName(ownerKey, name);
		// A visibility flip changes who may read the repository, and the access
		// cache is keyed per (repo, user) — drop every entry for it.
		if (settings.visibility !== undefined) invalidateRepositoryAccess(id);
		return updated;
	});

export const deleteRepository = createServerFn({ method: "POST" })
	.validator(z.object({ id: z.number() }))
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		const repo = await requireOwner(
			data.id,
			currentUser.id,
			"Only the repository owner can delete it",
		);
		const ownerKey = ownerKeyOf(repo);

		// The row first (cascading to issues, PRs, …): once it's gone nothing
		// resolves this repository, so a failed storage cleanup only leaves
		// unreachable objects, which the next create under this name clears.
		await db.delete(repositories).where(eq(repositories.id, data.id));
		evictRepoByName(ownerKey, repo.name);
		invalidateRepositoryAccess(data.id);
		await withRepositoryLock(ownerKey, repo.name, () =>
			deleteRepositoryStorage(ownerKey, repo.name),
		).catch((error: unknown) =>
			logError(
				"repositories",
				`Repository ${repo.id} deleted, but its storage cleanup failed`,
				error,
			),
		);
	});

/** Consolidate a repository's packs now (otherwise pushes do it past a threshold). */
export const repackRepository = createServerFn({ method: "POST" })
	.validator(z.object({ id: z.number() }))
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		const repo = await requireOwner(
			data.id,
			currentUser.id,
			"Only the repository owner can repack it",
		);
		return {
			removedFiles: await repackRepositoryNow(ownerKeyOf(repo), repo.name),
		};
	});

export const toggleStar = createServerFn({ method: "POST" })
	.validator(z.object({ repoId: z.number() }))
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		if (!(await canReadRepo(data.repoId, currentUser.id))) throw notFound();

		const removed = await db
			.delete(stars)
			.where(
				and(eq(stars.repoId, data.repoId), eq(stars.userId, currentUser.id)),
			)
			.returning({ id: stars.id });
		if (removed.length > 0) return { starred: false };

		const added = await db
			.insert(stars)
			.values({ repoId: data.repoId, userId: currentUser.id })
			.onConflictDoNothing()
			.returning({ id: stars.id });
		if (added.length > 0) {
			await recordActivity(currentUser.id, data.repoId, {
				type: "star",
				metadata: null,
			});
		}
		return { starred: true };
	});

export const getCollaborators = createServerFn({ method: "GET" })
	.validator(z.object({ repoId: z.number() }))
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		if (!(await canModerateRepo(data.repoId, currentUser.id))) {
			throw new Error("Access denied");
		}
		return db.query.repositoryCollaborators.findMany({
			where: eq(repositoryCollaborators.repoId, data.repoId),
			with: { user: publicUserFields },
		});
	});

/** Add a collaborator by username, or change an existing one's role. */
export const addCollaboratorByUsername = createServerFn({ method: "POST" })
	.validator(
		z.object({
			repoId: z.number(),
			username: usernameSchema,
			role: z.enum(["read", "write", "admin"]).default("read"),
		}),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		await requireOwner(
			data.repoId,
			currentUser.id,
			"Only the repository owner can add collaborators",
		);
		const target = await db.query.user.findFirst({
			columns: { id: true },
			where: eq(user.username, data.username),
		});
		if (!target) throw new Error(`User "${data.username}" not found`);
		if (target.id === currentUser.id)
			throw new Error("You already own this repository");

		const [collaborator] = await db
			.insert(repositoryCollaborators)
			.values({ repoId: data.repoId, userId: target.id, role: data.role })
			.onConflictDoUpdate({
				target: [
					repositoryCollaborators.repoId,
					repositoryCollaborators.userId,
				],
				set: { role: data.role },
			})
			.returning();
		invalidateRepositoryAccess(data.repoId);
		return collaborator;
	});

export const removeCollaborator = createServerFn({ method: "POST" })
	.validator(z.object({ repoId: z.number(), userId: z.string() }))
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		await requireOwner(
			data.repoId,
			currentUser.id,
			"Only the repository owner can remove collaborators",
		);
		await db
			.delete(repositoryCollaborators)
			.where(
				and(
					eq(repositoryCollaborators.repoId, data.repoId),
					eq(repositoryCollaborators.userId, data.userId),
				),
			);
		invalidateRepositoryAccess(data.repoId);
	});
