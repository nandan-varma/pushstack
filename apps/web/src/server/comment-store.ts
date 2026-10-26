/**
 * Comment writes and reads shared by the comment server functions and the REST
 * API (plain server-only module — see repository-lookup.ts for why this is not
 * a server-function file). Permission checks return a boolean; each caller
 * turns that into its own error (the server functions throw, the API answers
 * 403).
 */
import { and, count, eq, gte, ne, sql } from "drizzle-orm";
import { db } from "#/db";
import { comments } from "#/db/app-schema";
import { getReferencedIssueNumbers } from "#/lib/issue-references";
import { deleteActivity, recordActivity } from "./activity";
import { recordThreadActivity } from "./notification-store";
import { logError } from "./perf-log";
import { canWriteRepo, getRepositoryAccess } from "./repo-access";
import { publicUserFields } from "./repository-lookup";
import { findThreadById, type ThreadRef } from "./thread-store";
import { recordCrossReferences, removeCrossReferences } from "./timeline-store";

export type Comment = typeof comments.$inferSelect;

export function findComment(commentId: number): Promise<Comment | undefined> {
	return db.query.comments.findFirst({ where: { id: commentId } });
}

export function findCommentWithAuthor(commentId: number) {
	return db.query.comments.findFirst({
		where: { id: commentId },
		with: { author: publicUserFields },
	});
}

/**
 * A thread's comments, oldest first. `options` bound one page for the API;
 * `since` keeps the comments updated at or after it (the REST `since`).
 */
export function listCommentsForThread(
	thread: ThreadRef,
	options?: { limit?: number; offset?: number; since?: Date },
) {
	return db.query.comments.findMany({
		where: {
			issueId: thread.id,
			...(options?.since && { updatedAt: { gte: options.since } }),
		},
		with: { author: publicUserFields },
		orderBy: (table) => [table.createdAt, table.id],
		...(options?.limit !== undefined && { limit: options.limit }),
		...(options?.offset !== undefined && { offset: options.offset }),
	});
}

export async function countCommentsForThread(
	thread: ThreadRef,
	since?: Date,
): Promise<number> {
	const [row] = await db
		.select({ total: count() })
		.from(comments)
		.where(
			and(
				eq(comments.issueId, thread.id),
				since ? gte(comments.updatedAt, since) : undefined,
			),
		);
	return row?.total ?? 0;
}

export async function createCommentForUser(
	thread: ThreadRef,
	userId: string,
	body: string,
): Promise<Comment> {
	const [comment] = await db
		.insert(comments)
		.values({
			repoId: thread.repoId,
			issueId: thread.id,
			authorId: userId,
			body,
		})
		.returning();
	if (!comment) throw new Error("Comment insert returned no row");
	// The Neon HTTP driver has no transactions: compensate a failed write by
	// removing its comment and the activity row it recorded. A retry is
	// duplicate-free when cleanup succeeds.
	let activityId: number | undefined;
	try {
		await recordCrossReferences(
			thread.repoId,
			thread.id,
			{ kind: thread.kind, number: thread.number, title: thread.title },
			body,
			userId,
		);
		activityId = await recordActivity(userId, thread.repoId, {
			type: "comment",
			metadata: {
				on: thread.kind === "issue" ? "issue" : "pr",
				number: thread.number,
			},
		});
		// Notifications last: they are one statement that cannot half-land, and
		// nobody is told about a comment that is then removed.
		await recordThreadActivity({
			thread,
			actorId: userId,
			actorReason: "comment",
			text: body,
		});
	} catch (error) {
		if (activityId !== undefined)
			await deleteActivity(activityId).catch((cleanup: unknown) =>
				logError(
					"comment-store",
					`Activity ${activityId} was not removed after a failed comment write`,
					cleanup,
				),
			);
		await deleteCommentRow(comment, thread).catch((cleanup: unknown) =>
			logError(
				"comment-store",
				`Comment ${comment.id} was not removed after a failed write`,
				cleanup,
			),
		);
		throw error;
	}
	return comment;
}

/**
 * Whether `userId` may change the comment: its author (while they can still
 * participate) or a write collaborator moderating — GitHub's rule.
 */
export async function canEditComment(
	comment: Comment,
	userId: string,
): Promise<boolean> {
	if (comment.authorId === userId) {
		return (
			(await getRepositoryAccess(comment.repoId, userId))?.canParticipate ??
			false
		);
	}
	return canWriteRepo(comment.repoId, userId);
}

export async function updateCommentRow(
	comment: Comment,
	userId: string,
	body: string,
): Promise<Comment> {
	if (body === comment.body) return comment;
	const now = new Date();
	const [updated] = await db
		.update(comments)
		.set({ body, editedAt: now, updatedAt: now })
		.where(eq(comments.id, comment.id))
		.returning();
	if (!updated) throw new Error("Comment update returned no row");
	const thread = await findThreadById(comment.issueId);
	if (thread) {
		await recordCrossReferences(
			thread.repoId,
			thread.id,
			{ kind: thread.kind, number: thread.number, title: thread.title },
			body,
			userId,
		);
		await recordThreadActivity({
			thread,
			actorId: userId,
			text: body,
			previousText: comment.body,
			notifySubscribers: false,
		});
	}
	return updated;
}

/**
 * Delete a comment and drop the cross-references only it created. `thread` is
 * the comment's thread (its body and the other comments keep theirs).
 *
 * Only the other comments that mention one of the numbers this comment did can
 * keep such a reference alive, so only those are read. The database filter is
 * a superset of the parser (`#007` is `#7`, so leading zeros are allowed); the
 * exact check stays in `removeCrossReferences`.
 */
export async function deleteCommentRow(
	comment: Comment,
	thread: ThreadRef,
): Promise<void> {
	await db.delete(comments).where(eq(comments.id, comment.id));
	const numbers = getReferencedIssueNumbers(comment.body);
	if (numbers.length === 0) return;
	// The numbers are integers the parser produced, so the pattern is plain.
	const mentions = `#0*(${numbers.join("|")})([^0-9]|$)`;
	const others = await db
		.select({ body: comments.body })
		.from(comments)
		.where(
			and(
				eq(comments.issueId, comment.issueId),
				ne(comments.id, comment.id),
				sql`${comments.body} ~ ${mentions}`,
			),
		);
	await removeCrossReferences(thread.repoId, thread.id, comment.body, [
		thread.body,
		...others.map((other) => other.body),
	]);
}
