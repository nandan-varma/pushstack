/**
 * Issue writes and the assignee filter, shared by the issue server functions
 * and the REST API (plain server-only module — see repository-lookup.ts for
 * why this is not a server-function file). Permission checks stay with the
 * caller: the server functions throw their own errors, the API answers
 * 401/403/404.
 */
import { and, eq, exists, notExists, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { issueAssignees, issues } from "#/db/app-schema";
import { user } from "#/db/schema";
import { labelNameSchema } from "#/lib/labels";
import { MAX_LABELS_PER_THREAD } from "#/lib/limits";
import { recordActivity } from "./activity";
import { setThreadLabels } from "./label-store";
import {
	claimNextIssueOrPrNumber,
	publicUserFields,
} from "./repository-lookup";
import { recordCrossReferences, recordTimelineEvent } from "./timeline-store";

export type Issue = typeof issues.$inferSelect;

/** Assignees as list rows and the detail page show them. */
export const withAssignees = {
	assignees: { with: { user: publicUserFields } },
} as const;

/**
 * GitHub's `assignee:` / `no:assignee` filter: a username, `none` (unassigned)
 * or `*` (assigned to anyone).
 */
export function assigneeCondition(assignee: string, table: typeof issues) {
	const rows = db
		.select({ one: sql`1` })
		.from(issueAssignees)
		.where(eq(issueAssignees.issueId, table.id));
	if (assignee === "*") return exists(rows);
	if (assignee === "none") return notExists(rows);
	return exists(
		db
			.select({ one: sql`1` })
			.from(issueAssignees)
			.innerJoin(user, eq(user.id, issueAssignees.userId))
			.where(
				and(eq(issueAssignees.issueId, table.id), eq(user.username, assignee)),
			),
	);
}

export const issueLabelsSchema = z
	.array(labelNameSchema)
	.max(MAX_LABELS_PER_THREAD);

/** Open an issue as `userId` (the caller checked participation and labels). */
export async function createIssueForUser(
	repoId: number,
	userId: string,
	data: { title: string; body?: string; labels: string[] },
) {
	const [issue] = await db
		.insert(issues)
		.values({
			repoId,
			number: await claimNextIssueOrPrNumber(repoId),
			authorId: userId,
			title: data.title,
			body: data.body || null,
		})
		.returning();
	if (!issue) throw new Error("Issue insert returned no row");
	const labels = await setThreadLabels(
		repoId,
		issue.number,
		data.labels,
		userId,
	);
	await recordCrossReferences(
		repoId,
		{ kind: "issue", number: issue.number, title: issue.title },
		issue.body,
		userId,
	);
	await recordActivity(userId, repoId, {
		type: "issue",
		metadata: { number: issue.number, title: issue.title, action: "opened" },
	});
	return { ...issue, labels };
}

/**
 * Apply an edit to `issue` (the caller checked access): title/body edits leave
 * an "edited" marker and a `renamed` event, a status change records
 * `closed`/`reopened`.
 */
export async function updateIssueThreadFields(
	issue: Issue,
	userId: string,
	fields: {
		title?: string;
		body?: string;
		status?: "open" | "closed";
		/** `completed` (default) or `not_planned` when closing. */
		stateReason?: "completed" | "not_planned";
	},
): Promise<Issue> {
	const titleChanged =
		fields.title !== undefined && fields.title !== issue.title;
	const bodyChanged =
		fields.body !== undefined && (fields.body || null) !== issue.body;
	const [updated] = await db
		.update(issues)
		.set({
			...(fields.title !== undefined && { title: fields.title }),
			...(fields.body !== undefined && { body: fields.body || null }),
			...(bodyChanged && { editedAt: new Date() }),
			...(fields.status && {
				status: fields.status,
				closedAt: fields.status === "closed" ? new Date() : null,
				// Reopening an issue that was closed records `reopened`; an issue
				// that is already open keeps what it had.
				stateReason:
					fields.status === "closed"
						? (fields.stateReason ?? "completed")
						: issue.status === "closed"
							? ("reopened" as const)
							: issue.stateReason,
			}),
			// A new reason on an issue that stays closed.
			...(!fields.status &&
				fields.stateReason &&
				issue.status === "closed" && { stateReason: fields.stateReason }),
			updatedAt: new Date(),
		})
		.where(eq(issues.id, issue.id))
		.returning();
	if (!updated) throw new Error("Issue update returned no row");
	if (titleChanged) {
		await recordTimelineEvent(issue.repoId, issue.number, userId, {
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
			userId,
		);
	}
	if (fields.status && fields.status !== issue.status) {
		await recordTimelineEvent(issue.repoId, issue.number, userId, {
			...(fields.status === "closed"
				? {
						event: "closed" as const,
						stateReason: fields.stateReason ?? "completed",
					}
				: { event: "reopened" as const }),
		});
		await recordActivity(userId, issue.repoId, {
			type: "issue",
			metadata: {
				number: issue.number,
				title: issue.title,
				action: fields.status === "closed" ? "closed" : "reopened",
			},
		});
	}
	return updated;
}
