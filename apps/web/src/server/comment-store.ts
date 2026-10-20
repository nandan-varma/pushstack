/**
 * Comment writes and reads shared by the comment server functions and the REST
 * API (plain server-only module — see repository-lookup.ts for why this is not
 * a server-function file). Permission checks return a boolean; each caller
 * turns that into its own error (the server functions throw, the API answers
 * 403).
 */
import { and, count, eq, ne } from "drizzle-orm";
import { db } from "#/db";
import { comments } from "#/db/app-schema";
import { recordActivity } from "./activity";
import { canWriteRepo, getRepositoryAccess } from "./repo-access";
import { publicUserFields } from "./repository-lookup";
import { findThreadById, type ThreadRef } from "./thread-store";
import { recordCrossReferences, removeCrossReferences } from "./timeline-store";

export type Comment = typeof comments.$inferSelect;

export function findComment(commentId: number): Promise<Comment | undefined> {
	return db.query.comments.findFirst({ where: { id: commentId } });
}

/** The comment with its author, for the API's response shape. */
export function findCommentWithAuthor(commentId: number) {
	return db.query.comments.findFirst({
		where: { id: commentId },
		with: { author: publicUserFields },
	});
}

/** A thread's comments, oldest first. `options` bound one page for the API. */
export function listCommentsForThread(
	thread: ThreadRef,
	options?: { limit?: number; offset?: number },
) {
	return db.query.comments.findMany({
		where: { issueId: thread.id },
		with: { author: publicUserFields },
		orderBy: (table) => [table.createdAt, table.id],
		...(options?.limit !== undefined && { limit: options.limit }),
		...(options?.offset !== undefined && { offset: options.offset }),
	});
}

export async function countCommentsForThread(
	thread: ThreadRef,
): Promise<number> {
	const [row] = await db
		.select({ total: count() })
		.from(comments)
		.where(eq(comments.issueId, thread.id));
	return row?.total ?? 0;
}

/** Add a comment to `thread` as `userId` (the caller checked participation). */
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
	await recordCrossReferences(
		thread.repoId,
		thread.id,
		{ kind: thread.kind, number: thread.number, title: thread.title },
		body,
		userId,
	);
	await recordActivity(userId, thread.repoId, {
		type: "comment",
		metadata: {
			on: thread.kind === "issue" ? "issue" : "pr",
			number: thread.number,
		},
	});
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

/** Update a comment's body and re-run its cross-references. */
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
	}
	return updated;
}

/**
 * Delete a comment and drop the cross-references only it created. `thread` is
 * the comment's thread (its body and the other comments keep theirs).
 */
export async function deleteCommentRow(
	comment: Comment,
	thread: ThreadRef,
): Promise<void> {
	await db.delete(comments).where(eq(comments.id, comment.id));
	const others = await db
		.select({ body: comments.body })
		.from(comments)
		.where(
			and(eq(comments.issueId, comment.issueId), ne(comments.id, comment.id)),
		);
	await removeCrossReferences(thread.repoId, thread.id, comment.body, [
		thread.body,
		...others.map((other) => other.body),
	]);
}
