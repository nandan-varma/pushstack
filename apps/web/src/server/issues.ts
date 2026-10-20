/** Server functions for issues. */
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { issues } from "#/db/app-schema";
import { MAX_BODY_CHARS, MAX_LIST_SKIP } from "#/lib/limits";
import { andFilter } from "./db-filters";
import {
	assigneeCondition,
	createIssueForUser,
	issueLabelsSchema,
	updateIssueThreadFields,
	withAssignees,
} from "./issue-store";
import { threadsWithLabels, withLabels } from "./label-store";
import {
	canWriteRepo,
	getViewerRepositoryAccess,
	readWithAccess,
	requireParticipateAccess,
} from "./repo-access";
import { publicUserFields, readRepoByName } from "./repository-lookup";
import { getCurrentUser } from "./session";

export const createIssue = createServerFn({ method: "POST" })
	.validator(
		z.object({
			repoId: z.number(),
			title: z.string().trim().min(1).max(256),
			body: z.string().max(MAX_BODY_CHARS).optional(),
			labels: issueLabelsSchema.default([]),
		}),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		await requireParticipateAccess(data.repoId, currentUser.id);
		// Labels are triage: a participant without write access opens the issue
		// unlabeled, as on GitHub.
		const labels = (await canWriteRepo(data.repoId, currentUser.id))
			? data.labels
			: [];
		return createIssueForUser(data.repoId, currentUser.id, {
			title: data.title,
			body: data.body,
			labels,
		});
	});

export const getIssues = createServerFn({ method: "GET" })
	.validator(
		z.object({
			repoId: z.number(),
			status: z.enum(["open", "closed", "all"]).default("open"),
			assignee: z.string().max(100).optional(),
			/** Only issues carrying every one of these labels (`label:` filter). */
			labels: issueLabelsSchema.default([]),
			limit: z.number().int().min(1).max(100).default(100),
			skip: z.number().int().min(0).max(MAX_LIST_SKIP).default(0),
		}),
	)
	.handler(({ data: { assignee, ...data } }) =>
		readWithAccess(`getIssues ${data.status}`, data.repoId, async () =>
			withLabels(
				data.repoId,
				await db.query.issues.findMany({
					where: {
						repoId: data.repoId,
						...(data.status === "all" ? {} : { status: data.status }),
						...andFilter([
							...(assignee
								? [
										{
											RAW: (table: typeof issues) =>
												assigneeCondition(assignee, table),
										},
									]
								: []),
							...(data.labels.length > 0
								? [
										{
											RAW: (table: typeof issues) =>
												inArray(
													table.number,
													threadsWithLabels(data.repoId, data.labels),
												),
										},
									]
								: []),
						]),
					},
					with: { author: publicUserFields, ...withAssignees },
					orderBy: { createdAt: "desc" },
					limit: data.limit,
					offset: data.skip,
				}),
			),
		),
	);

/** Every issue number in a repository (resolves `#N` references in markdown). */
export const getIssueNumbers = createServerFn({ method: "GET" })
	.validator(z.object({ repoId: z.number() }))
	.handler(({ data }) =>
		readWithAccess("getIssueNumbers", data.repoId, async () => {
			const rows = await db
				.select({ number: issues.number })
				.from(issues)
				.where(eq(issues.repoId, data.repoId));
			return rows.map((row) => row.number);
		}),
	);

/** An issue by its repo-scoped number (the `#N` in URLs). */
export const getIssueByNumber = createServerFn({ method: "GET" })
	.validator(
		z.object({ owner: z.string(), name: z.string(), number: z.number().int() }),
	)
	.handler(({ data }) =>
		readRepoByName(
			`getIssueByNumber ${data.owner}/${data.name}#${data.number}`,
			data.owner,
			data.name,
			async (repo) => {
				const issue = await db.query.issues.findFirst({
					where: {
						repoId: repo.id,
						number: data.number,
					},
					with: { author: publicUserFields, ...withAssignees },
				});
				if (!issue) throw notFound();
				const [withIssueLabels] = await withLabels(repo.id, [issue]);
				return {
					...issue,
					labels: withIssueLabels?.labels ?? [],
					viewer: await getViewerRepositoryAccess(repo.id),
				};
			},
		),
	);

export const updateIssue = createServerFn({ method: "POST" })
	.validator(
		z.object({
			issueId: z.number(),
			title: z.string().trim().min(1).max(256).optional(),
			body: z.string().max(MAX_BODY_CHARS).optional(),
			status: z.enum(["open", "closed"]).optional(),
		}),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		const issue = await db.query.issues.findFirst({
			where: { id: data.issueId },
		});
		if (!issue) throw notFound();
		// The author may edit, close and reopen their own issue; anyone else's
		// needs write access.
		const canWrite = await canWriteRepo(issue.repoId, currentUser.id);
		if (!canWrite && issue.authorId !== currentUser.id) {
			throw new Error("Access denied");
		}
		const { issueId, status, ...fields } = data;
		return updateIssueThreadFields(issue, currentUser.id, {
			...fields,
			status,
		});
	});
