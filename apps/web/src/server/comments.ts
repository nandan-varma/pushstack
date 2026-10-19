/** Server functions for comments on issues and pull requests. */
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { comments } from "#/db/app-schema";
import { MAX_BODY_CHARS } from "#/lib/limits";
import { recordActivity } from "./activity";
import {
	canWriteRepo,
	getAccessForRepository,
	requireParticipateAccess,
} from "./repo-access";
import { publicUserFields } from "./repository-lookup";
import { getCurrentUser, getCurrentUserOptional } from "./session";
import { recordCrossReferences, removeCrossReferences } from "./timeline-store";

/** Exactly one of an issue id or a pull request id (row ids, not `#N`). */
const threadSchema = z.union([
	z.object({ issueId: z.number(), pullRequestId: z.undefined().optional() }),
	z.object({ pullRequestId: z.number(), issueId: z.undefined().optional() }),
]);
type Thread = z.infer<typeof threadSchema>;

/** The thread's repository and `#N`; 404 when it doesn't exist. */
async function findThread(thread: Thread) {
	const row =
		thread.issueId !== undefined
			? await db.query.issues.findFirst({
					columns: { number: true, title: true, body: true },
					where: { id: thread.issueId },
					with: { repository: true },
				})
			: await db.query.pullRequests.findFirst({
					columns: { number: true, title: true, body: true },
					where: { id: thread.pullRequestId },
					with: { repository: true },
				});
	if (!row) throw notFound();
	return row;
}

export const createComment = createServerFn({ method: "POST" })
	.validator(
		z
			.object({ body: z.string().trim().min(1).max(MAX_BODY_CHARS) })
			.and(threadSchema),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		const { repository, number, title } = await findThread(data);
		await requireParticipateAccess(repository.id, currentUser.id);
		const [comment] = await db
			.insert(comments)
			.values({
				repoId: repository.id,
				issueId: data.issueId ?? null,
				pullRequestId: data.pullRequestId ?? null,
				authorId: currentUser.id,
				body: data.body,
			})
			.returning();
		await recordCrossReferences(
			repository.id,
			{
				kind: data.issueId !== undefined ? "issue" : "pull_request",
				number,
				title,
			},
			data.body,
			currentUser.id,
		);
		await recordActivity(currentUser.id, repository.id, {
			type: "comment",
			metadata: { on: data.issueId !== undefined ? "issue" : "pr", number },
		});
		return comment;
	});

export const getComments = createServerFn({ method: "GET" })
	.validator(threadSchema)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUserOptional();
		const { repository } = await findThread(data);
		if (!(await getAccessForRepository(repository, currentUser?.id)).canRead) {
			throw notFound();
		}
		return db.query.comments.findMany({
			where: {
				RAW: (table) =>
					data.issueId !== undefined
						? eq(table.issueId, data.issueId)
						: eq(table.pullRequestId, data.pullRequestId),
			},
			with: { author: publicUserFields },
			orderBy: (table) => [table.createdAt],
		});
	});

/**
 * The comment, once the current user may change it: its author (while they can
 * still participate) or a write collaborator moderating — GitHub's rule.
 */
async function requireCommentEditor(commentId: number, userId: string) {
	const comment = await db.query.comments.findFirst({
		where: { id: commentId },
	});
	if (!comment) throw notFound();
	if (comment.authorId === userId) {
		await requireParticipateAccess(comment.repoId, userId);
	} else if (!(await canWriteRepo(comment.repoId, userId))) {
		throw new Error("Access denied");
	}
	return comment;
}

export const updateComment = createServerFn({ method: "POST" })
	.validator(
		z.object({
			commentId: z.number(),
			body: z.string().trim().min(1).max(MAX_BODY_CHARS),
		}),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		const comment = await requireCommentEditor(data.commentId, currentUser.id);
		if (data.body === comment.body) return comment;
		const now = new Date();
		const [updated] = await db
			.update(comments)
			.set({ body: data.body, editedAt: now, updatedAt: now })
			.where(eq(comments.id, comment.id))
			.returning();
		if (!updated) throw notFound();
		const { repository, number, title } = await findThread(
			comment.issueId !== null
				? { issueId: comment.issueId }
				: { pullRequestId: comment.pullRequestId as number },
		);
		await recordCrossReferences(
			repository.id,
			{
				kind: comment.issueId !== null ? "issue" : "pull_request",
				number,
				title,
			},
			data.body,
			currentUser.id,
		);
		return updated;
	});

export const deleteComment = createServerFn({ method: "POST" })
	.validator(z.object({ commentId: z.number() }))
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		const comment = await requireCommentEditor(data.commentId, currentUser.id);
		await db.delete(comments).where(eq(comments.id, comment.id));
		// GitHub drops the "mentioned in" events a deleted comment created.
		const thread = await findThread(
			comment.issueId !== null
				? { issueId: comment.issueId }
				: { pullRequestId: comment.pullRequestId as number },
		);
		const others = await db.query.comments.findMany({
			columns: { body: true },
			where: {
				RAW: (table) =>
					comment.issueId !== null
						? eq(table.issueId, comment.issueId)
						: eq(table.pullRequestId, comment.pullRequestId as number),
			},
		});
		await removeCrossReferences(
			thread.repository.id,
			thread.number,
			comment.body,
			[thread.body, ...others.map((other) => other.body)],
		);
		return { success: true };
	});
