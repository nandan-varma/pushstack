/** Server functions for comments on issues and pull requests. */
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { MAX_BODY_CHARS } from "#/lib/limits";
import {
	type Comment,
	canEditComment,
	createCommentForUser,
	deleteCommentRow,
	findComment,
	listCommentsForThread,
	threadIdOf,
	updateCommentRow,
} from "./comment-store";
import { getRepositoryAccess, requireParticipateAccess } from "./repo-access";
import { getCurrentUser, getCurrentUserOptional } from "./session";
import { findThreadById, type ThreadRef } from "./thread-store";

/** Exactly one of an issue id or a pull request id (row ids, not `#N`). */
const threadSchema = z.union([
	z.object({ issueId: z.number(), pullRequestId: z.undefined().optional() }),
	z.object({ pullRequestId: z.number(), issueId: z.undefined().optional() }),
]);
type Thread = z.infer<typeof threadSchema>;

/** The thread's repository and `#N`; 404 when it doesn't exist. */
async function requireThread(thread: Thread): Promise<ThreadRef> {
	const found = await findThreadById(thread);
	if (!found) throw notFound();
	return found;
}

/**
 * The comment, once the current user may change it: its author (while they can
 * still participate) or a write collaborator moderating — GitHub's rule.
 */
async function requireCommentEditor(
	comment: Comment,
	userId: string,
): Promise<Comment> {
	if (!(await canEditComment(comment, userId))) {
		throw new Error("Access denied");
	}
	return comment;
}

export const createComment = createServerFn({ method: "POST" })
	.validator(
		z
			.object({ body: z.string().trim().min(1).max(MAX_BODY_CHARS) })
			.and(threadSchema),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		const thread = await requireThread(data);
		await requireParticipateAccess(thread.repoId, currentUser.id);
		return createCommentForUser(thread, currentUser.id, data.body);
	});

export const getComments = createServerFn({ method: "GET" })
	.validator(threadSchema)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUserOptional();
		const thread = await requireThread(data);
		if (!(await getRepositoryAccess(thread.repoId, currentUser?.id))?.canRead) {
			throw notFound();
		}
		return listCommentsForThread(thread);
	});

export const updateComment = createServerFn({ method: "POST" })
	.validator(
		z.object({
			commentId: z.number(),
			body: z.string().trim().min(1).max(MAX_BODY_CHARS),
		}),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		const comment = await findComment(data.commentId);
		if (!comment) throw notFound();
		await requireCommentEditor(comment, currentUser.id);
		return updateCommentRow(comment, currentUser.id, data.body);
	});

export const deleteComment = createServerFn({ method: "POST" })
	.validator(z.object({ commentId: z.number() }))
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		const comment = await findComment(data.commentId);
		if (!comment) throw notFound();
		await requireCommentEditor(comment, currentUser.id);
		const thread = await requireThread(threadIdOf(comment));
		await deleteCommentRow(comment, thread);
		return { success: true };
	});
