import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { issues, repositoryCollaborators, stars } from "#/db/app-schema";
import {
	MAX_LIST_SKIP,
	MAX_REPO_DESCRIPTION_CHARS,
	MAX_REPO_HOMEPAGE_CHARS,
	MAX_REPO_TOPIC_CHARS,
	MAX_REPO_TOPICS,
} from "#/lib/limits";
import { STORAGE_NAME_RE } from "#/lib/storage-name";
import { parseTopics } from "#/lib/topics";
import { recordActivity } from "./activity";
import { safeBranchNameSchema } from "./git-ref-name";
import { repackRepositoryNow } from "./git-repo";
import { ownerKeyOf } from "./git-storage-naming";
import { perfContext, perfStep } from "./perf-log";
import {
	canReadRepo,
	getAccessForRepository,
	getRepositoryAccess,
	invalidateRepositoryAccess,
	requireOwner,
} from "./repo-access";
import {
	createRepositoryForUser,
	createRepositoryInputSchema,
	generateRepositoryFromTemplate,
	repoNameSchema,
} from "./repository-create";
import { findRepositoryByName, publicUserFields } from "./repository-lookup";
import {
	deleteRepositoryAndStorage,
	transferRepository,
	updateRepositorySettings,
} from "./repository-settings";
import { getCurrentUser, getCurrentUserOptional } from "./session";

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

export const createRepository = createServerFn({ method: "POST" })
	.validator(createRepositoryInputSchema)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		const repo = await createRepositoryForUser(currentUser, data);
		return { ...repo, owner: { username: currentUser.username } };
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
			where: {
				ownerId,
				...(ownerId !== currentUser.id && { visibility: "public" }),
			},
			orderBy: (table) => [desc(table.updatedAt)],
			with: { owner: publicUserFields },
			limit: data.limit,
			offset: data.skip,
		});
	});

/** Open issues and open pull requests, for the repository navigation. */
async function openThreadCounts(repoId: number) {
	const rows = await db
		.select({ isPullRequest: issues.isPullRequest, n: count() })
		.from(issues)
		.where(and(eq(issues.repoId, repoId), eq(issues.status, "open")))
		.groupBy(issues.isPullRequest);
	return {
		openIssueCount: rows.find((row) => !row.isPullRequest)?.n ?? 0,
		openPullRequestCount: rows.find((row) => row.isPullRequest)?.n ?? 0,
	};
}

async function starState(repoId: number, userId: string | undefined) {
	const [[total], mine] = await Promise.all([
		db.select({ value: count() }).from(stars).where(eq(stars.repoId, repoId)),
		userId
			? db.query.stars.findFirst({
					columns: { id: true },
					where: { repoId: repoId, userId: userId },
				})
			: undefined,
	]);
	return { starCount: total?.value ?? 0, isStarred: !!mine };
}

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
			const [access, stars, counts] = await perfStep(
				"access + stars + counts",
				() =>
					Promise.all([
						getAccessForRepository(repo, currentUser?.id),
						starState(repo.id, currentUser?.id),
						openThreadCounts(repo.id),
					]),
			);
			if (!access.canRead) throw notFound();
			return {
				...repo,
				...stars,
				...counts,
				viewer: { canWrite: access.canWrite },
			};
		}),
	);

export const updateRepository = createServerFn({ method: "POST" })
	.validator(
		z.object({
			id: z.number(),
			name: repoNameSchema.optional(),
			description: z.string().trim().max(MAX_REPO_DESCRIPTION_CHARS).optional(),
			homepage: z.string().trim().max(MAX_REPO_HOMEPAGE_CHARS).optional(),
			visibility: z.enum(["public", "private"]).optional(),
			showLastCommitColumn: z.boolean().optional(),
			autoRefreshPrDiffs: z.boolean().optional(),
			defaultBranch: safeBranchNameSchema.optional(),
			archived: z.boolean().optional(),
			isTemplate: z.boolean().optional(),
			hasIssues: z.boolean().optional(),
			hasWiki: z.boolean().optional(),
			hasProjects: z.boolean().optional(),
		}),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		const repo = await requireOwner(
			data.id,
			currentUser.id,
			"Only the repository owner can change settings",
		);
		const { id, ...patch } = data;
		return updateRepositorySettings(repo, patch);
	});

export const setRepositoryTopics = createServerFn({ method: "POST" })
	.validator(
		z.object({
			id: z.number(),
			topics: z.array(z.string().trim().toLowerCase()).max(MAX_REPO_TOPICS * 2),
		}),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		const repo = await requireOwner(
			data.id,
			currentUser.id,
			"Only the repository owner can change topics",
		);
		const { topics, invalid, tooMany } = parseTopics(data.topics);
		if (invalid.length > 0) {
			throw new Error(
				`Invalid topic: ${invalid[0]}. Use lowercase letters, numbers and hyphens (up to ${MAX_REPO_TOPIC_CHARS} characters).`,
			);
		}
		if (tooMany) {
			throw new Error(
				`A repository can have at most ${MAX_REPO_TOPICS} topics`,
			);
		}
		await updateRepositorySettings(repo, { topics });
		return { topics };
	});

export const transferRepositoryToUser = createServerFn({ method: "POST" })
	.validator(
		z.object({
			id: z.number(),
			newOwner: usernameSchema,
			newName: repoNameSchema.optional(),
		}),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		const repo = await requireOwner(
			data.id,
			currentUser.id,
			"Only the repository owner can transfer it",
		);
		const target = await db.query.user.findFirst({
			columns: { id: true, username: true },
			where: { username: data.newOwner },
		});
		if (!target) throw new Error(`User "${data.newOwner}" not found`);
		const updated = await transferRepository(repo, target, data.newName);
		return { ...updated, owner: { username: target.username } };
	});

export const generateRepository = createServerFn({ method: "POST" })
	.validator(
		z.object({
			templateId: z.number(),
			name: repoNameSchema,
			description: z.string().trim().max(MAX_REPO_DESCRIPTION_CHARS).optional(),
			visibility: z.enum(["public", "private"]).default("public"),
		}),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		const access = await getRepositoryAccess(data.templateId, currentUser.id);
		if (!access?.canRead || !access.repository.isTemplate) throw notFound();
		const template = await db.query.repositories.findFirst({
			where: { id: data.templateId },
			with: { owner: publicUserFields },
		});
		if (!template) throw notFound();
		const repo = await generateRepositoryFromTemplate(template, currentUser, {
			name: data.name,
			description: data.description,
			visibility: data.visibility,
		});
		return { ...repo, owner: { username: currentUser.username } };
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
		await deleteRepositoryAndStorage(repo);
	});

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
		const access = await getRepositoryAccess(data.repoId, currentUser.id);
		if (access?.role !== "owner" && access?.role !== "admin") {
			throw new Error("Access denied");
		}
		return db.query.repositoryCollaborators.findMany({
			where: { repoId: data.repoId },
			with: { user: publicUserFields },
		});
	});

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
			where: { username: data.username },
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
