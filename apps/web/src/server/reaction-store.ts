/**
 * Reactions on issues, pull requests and their comments (GitHub's
 * `content` values), shared by the server functions and, later, the REST API.
 * Plain server-only module: no permission checks here.
 */
import { and, count, eq, isNull, sql } from "drizzle-orm";
import { db } from "#/db";
import { reactions } from "#/db/app-schema";
import {
	emptyReactionSummary,
	type ReactionContent,
	type ReactionSummary,
	type ThreadReactions,
} from "#/lib/reactions";

export type Reaction = typeof reactions.$inferSelect;

/** The issue/PR itself (`commentId` absent) or one of its comments. */
export interface ReactionSubject {
	issueId: number;
	commentId?: number;
}

const subjectFilter = (subject: ReactionSubject) =>
	and(
		eq(reactions.issueId, subject.issueId),
		subject.commentId === undefined
			? isNull(reactions.commentId)
			: eq(reactions.commentId, subject.commentId),
	);

/** Rollups for a thread and all its comments, in one grouped read. */
export async function listThreadReactions(
	issueId: number,
	viewerId?: string,
): Promise<ThreadReactions> {
	const rows = await db
		.select({
			commentId: reactions.commentId,
			content: reactions.content,
			total: count(),
			viewer: viewerId
				? sql<boolean>`bool_or(${reactions.userId} = ${viewerId})`
				: sql<boolean>`false`,
		})
		.from(reactions)
		.where(eq(reactions.issueId, issueId))
		.groupBy(reactions.commentId, reactions.content);

	const result: ThreadReactions = {
		issue: emptyReactionSummary(),
		comments: {},
	};
	for (const row of rows) {
		let summary: ReactionSummary;
		if (row.commentId === null) {
			summary = result.issue;
		} else {
			result.comments[row.commentId] ??= emptyReactionSummary();
			summary = result.comments[row.commentId];
		}
		summary.reactions[row.content] += row.total;
		summary.reactions.total_count += row.total;
		if (row.viewer) summary.viewerReactions.push(row.content);
	}
	return result;
}

/**
 * Add the user's reaction; an existing identical one is returned unchanged
 * (`created: false`), as GitHub's create answers 200 rather than 201.
 */
export async function addReaction(
	subject: ReactionSubject,
	userId: string,
	content: ReactionContent,
): Promise<{ reaction: Reaction; created: boolean }> {
	const [inserted] = await db
		.insert(reactions)
		.values({
			issueId: subject.issueId,
			commentId: subject.commentId ?? null,
			userId,
			content,
		})
		.onConflictDoNothing()
		.returning();
	if (inserted) return { reaction: inserted, created: true };
	const [existing] = await db
		.select()
		.from(reactions)
		.where(
			and(
				subjectFilter(subject),
				eq(reactions.userId, userId),
				eq(reactions.content, content),
			),
		)
		.limit(1);
	if (!existing) throw new Error("Reaction could not be saved");
	return { reaction: existing, created: false };
}

/** Remove the user's reaction; false when there was none. */
export async function removeReaction(
	subject: ReactionSubject,
	userId: string,
	content: ReactionContent,
): Promise<boolean> {
	const deleted = await db
		.delete(reactions)
		.where(
			and(
				subjectFilter(subject),
				eq(reactions.userId, userId),
				eq(reactions.content, content),
			),
		)
		.returning({ id: reactions.id });
	return deleted.length > 0;
}
