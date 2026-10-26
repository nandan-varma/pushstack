/**
 * Issue writes shared by the issue server functions and the REST API (plain
 * server-only module — see repository-lookup.ts for why this is not a
 * server-function file). Reads go through thread-store.ts. Permission checks
 * stay with the caller: the server functions throw their own errors, the API
 * answers 401/403/404.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { type Issue, issues } from "#/db/app-schema";
import { labelNameSchema } from "#/lib/labels";
import { MAX_LABELS_PER_THREAD } from "#/lib/limits";
import { deleteActivity, recordActivity } from "./activity";
import { replaceThreadAssignees } from "./assignees-store";
import { bestEffort } from "./best-effort";
import { setThreadLabels } from "./label-store";
import { recordThreadActivity } from "./notification-store";
import { logError } from "./perf-log";
import { claimNextIssueOrPrNumber } from "./repository-lookup";
import { recordCrossReferences, recordTimelineEvent } from "./timeline-store";

export type { Issue };

export const issueLabelsSchema = z
	.array(labelNameSchema)
	.max(MAX_LABELS_PER_THREAD);

/**
 * Create an issue with its labels and assignees. All-or-nothing: the Neon HTTP
 * driver has no interactive transactions, so any failure after the row exists
 * deletes it again (cascading to labels and assignees). A retry then creates
 * one issue when cleanup succeeds; cleanup failures are logged.
 */
export async function createIssueForUser(
	repoId: number,
	userId: string,
	data: {
		title: string;
		body?: string;
		labels: string[];
		assignees?: string[];
	},
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
	let activityId: number | undefined;
	try {
		const labels = await setThreadLabels(issue, data.labels, userId);
		if (data.assignees?.length)
			await replaceThreadAssignees(issue, data.assignees, userId);
		await recordCrossReferences(
			repoId,
			issue.id,
			{ kind: "issue", number: issue.number, title: issue.title },
			issue.body,
			userId,
		);
		// Record activity before the final author/mention notifications.
		activityId = await recordActivity(userId, repoId, {
			type: "issue",
			metadata: { number: issue.number, title: issue.title, action: "opened" },
		});
		await recordThreadActivity({
			thread: issue,
			actorId: userId,
			actorReason: "author",
			text: issue.body,
		});
		return { ...issue, labels };
	} catch (error) {
		// Cascades remove the issue's notifications; the activity row has no
		// foreign key, so it is removed here.
		if (activityId !== undefined)
			await deleteActivity(activityId).catch((cleanup: unknown) =>
				logError(
					"issue-store",
					`Activity ${activityId} was not removed after a failed issue write`,
					cleanup,
				),
			);
		await db
			.delete(issues)
			.where(eq(issues.id, issue.id))
			.catch((cleanup: unknown) =>
				logError(
					"issue-store",
					`Issue ${issue.id} was not removed after a failed write`,
					cleanup,
				),
			);
		throw error;
	}
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
	const statusChanged =
		fields.status !== undefined && fields.status !== issue.status;
	const now = new Date();
	const [updated] = await db
		.update(issues)
		.set({
			...(fields.title !== undefined && { title: fields.title }),
			...(fields.body !== undefined && { body: fields.body || null }),
			...(bodyChanged && { editedAt: now }),
			...(statusChanged && {
				status: fields.status,
				closedAt: fields.status === "closed" ? now : null,
				closedById: fields.status === "closed" ? userId : null,
				// Closing takes the given reason (default completed); reopening
				// records `reopened`.
				stateReason:
					fields.status === "closed"
						? (fields.stateReason ?? "completed")
						: ("reopened" as const),
			}),
			// An explicit reason on an issue that stays closed; a repeated close
			// without one keeps what it had.
			...(!statusChanged &&
				fields.stateReason &&
				issue.status === "closed" && { stateReason: fields.stateReason }),
			updatedAt: now,
		})
		.where(eq(issues.id, issue.id))
		.returning();
	if (!updated) throw new Error("Issue update returned no row");
	// The update above is committed: each follow-up is best-effort, so a failed
	// timeline row or notice does not fail an edit that happened.
	const followUp = (what: string, effect: () => Promise<unknown>) =>
		bestEffort("issue-store", `${what} of #${issue.number}`, effect);
	if (titleChanged) {
		await followUp("The rename event", () =>
			recordTimelineEvent(issue.id, userId, {
				event: "renamed",
				from: issue.title,
				to: updated.title,
			}),
		);
	}
	if (bodyChanged) {
		await followUp("The cross references", () =>
			recordCrossReferences(
				issue.repoId,
				issue.id,
				{ kind: "issue", number: issue.number, title: updated.title },
				fields.body,
				userId,
			),
		);
	}
	if (bodyChanged || statusChanged) {
		// New @mentions in an edited body notify; a close or reopen tells
		// every subscriber.
		await followUp("The notification", () =>
			recordThreadActivity({
				thread: issue,
				actorId: userId,
				...(statusChanged && { actorReason: "state_change" as const }),
				...(bodyChanged && { text: fields.body, previousText: issue.body }),
				notifySubscribers: statusChanged,
			}),
		);
	}
	if (fields.status && fields.status !== issue.status) {
		await followUp("The status event", () =>
			recordTimelineEvent(issue.id, userId, {
				...(fields.status === "closed"
					? {
							event: "closed" as const,
							stateReason: fields.stateReason ?? "completed",
						}
					: { event: "reopened" as const }),
			}),
		);
		await followUp("The status activity", () =>
			recordActivity(userId, issue.repoId, {
				type: "issue",
				metadata: {
					number: issue.number,
					title: issue.title,
					action: fields.status === "closed" ? "closed" : "reopened",
				},
			}),
		);
	}
	return updated;
}
