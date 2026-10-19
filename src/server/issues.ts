/** Server functions for issues. */
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, exists, notExists, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { issueAssignees, issues } from "#/db/app-schema";
import { user } from "#/db/schema";
import { MAX_BODY_CHARS, MAX_LIST_SKIP } from "#/lib/limits";
import { recordActivity } from "./activity";
import {
	canWriteRepo,
	getViewerRepositoryAccess,
	readWithAccess,
	requireParticipateAccess,
} from "./repo-access";
import {
	claimNextIssueOrPrNumber,
	publicUserFields,
	readRepoByName,
} from "./repository-lookup";
import { getCurrentUser } from "./session";
import { recordCrossReferences, recordTimelineEvent } from "./timeline-store";

/** Assignees as list rows and the detail page show them. */
const withAssignees = {
	assignees: { with: { user: publicUserFields } },
} as const;

/**
 * GitHub's `assignee:` / `no:assignee` filter: a username, `none` (unassigned)
 * or `*` (assigned to anyone).
 */
function assigneeCondition(assignee: string | undefined) {
	if (!assignee) return undefined;
	const rows = db
		.select({ one: sql`1` })
		.from(issueAssignees)
		.where(eq(issueAssignees.issueId, issues.id));
	if (assignee === "*") return exists(rows);
	if (assignee === "none") return notExists(rows);
	return exists(
		db
			.select({ one: sql`1` })
			.from(issueAssignees)
			.innerJoin(user, eq(user.id, issueAssignees.userId))
			.where(
				and(eq(issueAssignees.issueId, issues.id), eq(user.username, assignee)),
			),
	);
}

const labelsSchema = z.array(z.string().trim().min(1).max(50)).max(20);

export const createIssue = createServerFn({ method: "POST" })
	.validator(
		z.object({
			repoId: z.number(),
			title: z.string().trim().min(1).max(256),
			body: z.string().max(MAX_BODY_CHARS).optional(),
			labels: labelsSchema.default([]),
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
		const [issue] = await db
			.insert(issues)
			.values({
				repoId: data.repoId,
				number: await claimNextIssueOrPrNumber(data.repoId),
				authorId: currentUser.id,
				title: data.title,
				body: data.body || null,
				labels,
			})
			.returning();
		if (!issue) throw new Error("Issue insert returned no row");
		await recordCrossReferences(
			data.repoId,
			{ kind: "issue", number: issue.number, title: issue.title },
			issue.body,
			currentUser.id,
		);
		await recordActivity(currentUser.id, data.repoId, {
			type: "issue",
			metadata: { number: issue.number, title: issue.title, action: "opened" },
		});
		return issue;
	});

export const getIssues = createServerFn({ method: "GET" })
	.validator(
		z.object({
			repoId: z.number(),
			status: z.enum(["open", "closed", "all"]).default("open"),
			assignee: z.string().max(100).optional(),
			limit: z.number().int().min(1).max(100).default(100),
			skip: z.number().int().min(0).max(MAX_LIST_SKIP).default(0),
		}),
	)
	.handler(({ data }) =>
		readWithAccess(`getIssues ${data.status}`, data.repoId, () =>
			db.query.issues.findMany({
				where: and(
					eq(issues.repoId, data.repoId),
					data.status === "all" ? undefined : eq(issues.status, data.status),
					assigneeCondition(data.assignee),
				),
				with: { author: publicUserFields, ...withAssignees },
				orderBy: [desc(issues.createdAt)],
				limit: data.limit,
				offset: data.skip,
			}),
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
					where: and(
						eq(issues.repoId, repo.id),
						eq(issues.number, data.number),
					),
					with: { author: publicUserFields, ...withAssignees },
				});
				if (!issue) throw notFound();
				return { ...issue, viewer: await getViewerRepositoryAccess(repo.id) };
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
			labels: labelsSchema.optional(),
		}),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		const issue = await db.query.issues.findFirst({
			where: eq(issues.id, data.issueId),
		});
		if (!issue) throw notFound();
		// The author may edit, close and reopen their own issue; labels (and
		// anyone else's issue) need write access.
		const canWrite = await canWriteRepo(issue.repoId, currentUser.id);
		if (!canWrite && (issue.authorId !== currentUser.id || data.labels)) {
			throw new Error("Access denied");
		}
		const { issueId, status, ...fields } = data;
		const titleChanged =
			fields.title !== undefined && fields.title !== issue.title;
		const bodyChanged =
			fields.body !== undefined && (fields.body || null) !== issue.body;
		const [updated] = await db
			.update(issues)
			.set({
				...fields,
				...(fields.body !== undefined && { body: fields.body || null }),
				...(bodyChanged && { editedAt: new Date() }),
				...(status && {
					status,
					closedAt: status === "closed" ? new Date() : null,
				}),
				updatedAt: new Date(),
			})
			.where(eq(issues.id, issueId))
			.returning();
		if (!updated) throw notFound();
		if (titleChanged) {
			await recordTimelineEvent(issue.repoId, issue.number, currentUser.id, {
				event: "renamed",
				from: issue.title,
				to: updated.title,
			});
		}
		if (bodyChanged) {
			await recordCrossReferences(
				issue.repoId,
				{ kind: "issue", number: issue.number, title: updated.title },
				fields.body,
				currentUser.id,
			);
		}
		if (status && status !== issue.status) {
			await recordTimelineEvent(issue.repoId, issue.number, currentUser.id, {
				event: status === "closed" ? "closed" : "reopened",
			});
			await recordActivity(currentUser.id, issue.repoId, {
				type: "issue",
				metadata: {
					number: issue.number,
					title: issue.title,
					action: status === "closed" ? "closed" : "reopened",
				},
			});
		}
		return updated;
	});
