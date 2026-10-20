/**
 * Reactions on issues, pull requests and their comments (GitHub's
 * `content` values), shared by the server functions and, later, the REST API.
 * Plain server-only module: no permission checks here.
 */
import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "#/db";
import { reactions } from "#/db/app-schema";
import { user } from "#/db/schema";
import {
	emptyReactionRollup,
	emptyReactionSummary,
	type ReactionContent,
	type ReactionRollup,
	type ReactionSummary,
	type ThreadReactions,
} from "#/lib/reactions";
import type { PublicUser } from "./repository-lookup";

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

/** Rollups grouped by subject (issues/PRs themselves, or comments), one read. */
async function rollupsBy(
	key: "issue" | "comment",
	ids: number[],
): Promise<Map<number, ReactionRollup>> {
	const result = new Map<number, ReactionRollup>(
		ids.map((id) => [id, emptyReactionRollup()]),
	);
	if (ids.length === 0) return result;
	const column = key === "issue" ? reactions.issueId : reactions.commentId;
	const rows = await db
		.select({ id: column, content: reactions.content, total: count() })
		.from(reactions)
		.where(
			key === "issue"
				? and(inArray(reactions.issueId, ids), isNull(reactions.commentId))
				: inArray(reactions.commentId, ids),
		)
		.groupBy(column, reactions.content);
	for (const row of rows) {
		const rollup = row.id === null ? undefined : result.get(row.id);
		if (!rollup) continue;
		rollup[row.content] += row.total;
		rollup.total_count += row.total;
	}
	return result;
}

/** Each issue's/PR's own reaction rollup (not its comments'), by issue id. */
export const issueReactionRollups = (issueIds: number[]) =>
	rollupsBy("issue", issueIds);

/** Each comment's reaction rollup, by comment id. */
export const commentReactionRollups = (commentIds: number[]) =>
	rollupsBy("comment", commentIds);

export type ReactionWithUser = Reaction & { user: PublicUser };

/** A subject's reactions, oldest first, optionally of one `content`. */
export async function listReactions(
	subject: ReactionSubject,
	options: { content?: ReactionContent; limit: number; offset: number },
): Promise<{ reactions: ReactionWithUser[]; total: number }> {
	const where = and(
		subjectFilter(subject),
		options.content ? eq(reactions.content, options.content) : undefined,
	);
	const [rows, [counted]] = await Promise.all([
		selectWithUser()
			.where(where)
			.orderBy(asc(reactions.id))
			.limit(options.limit)
			.offset(options.offset),
		db.select({ total: count() }).from(reactions).where(where),
	]);
	return {
		reactions: rows.map((row) => ({ ...row.reaction, user: row.user })),
		total: counted?.total ?? 0,
	};
}

function selectWithUser() {
	return db
		.select({
			reaction: reactions,
			user: {
				id: user.id,
				apiId: user.apiId,
				username: user.username,
				name: user.name,
				image: user.image,
			},
		})
		.from(reactions)
		.innerJoin(user, eq(user.id, reactions.userId));
}

/** One reaction with its author's public fields. */
export async function findReactionWithUser(
	id: number,
): Promise<ReactionWithUser | undefined> {
	const [row] = await selectWithUser().where(eq(reactions.id, id)).limit(1);
	return row && { ...row.reaction, user: row.user };
}

/** One reaction by id, only when it belongs to `subject`. */
export async function findReaction(
	subject: ReactionSubject,
	id: number,
): Promise<Reaction | undefined> {
	const [row] = await db
		.select()
		.from(reactions)
		.where(and(subjectFilter(subject), eq(reactions.id, id)))
		.limit(1);
	return row;
}

export async function deleteReactionById(id: number): Promise<void> {
	await db.delete(reactions).where(eq(reactions.id, id));
}
