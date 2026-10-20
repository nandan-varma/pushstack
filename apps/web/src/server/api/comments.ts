/**
 * GitHub's issue comments at `/api/v3`: list, get, create, update and delete.
 * A comment is addressed by its issue or pull request `#N` (GitHub serves a
 * pull request's comments through the issues endpoints too); the single-comment
 * routes address it by id.
 */

import { emptyReactionRollup } from "#/lib/reactions";
import {
	canEditComment,
	countCommentsForThread,
	createCommentForUser,
	deleteCommentRow,
	findCommentWithAuthor,
	listCommentsForThread,
	updateCommentRow,
} from "../comment-store";
import { commentReactionRollups } from "../reaction-store";
import { findThreadById, findThreadByNumber } from "../thread-store";
import { type ApiContext, requireScope } from "./auth";
import {
	apiUrl,
	forbiddenError,
	json,
	linkHeader,
	noContent,
	notFoundError,
	pageParams,
} from "./http";
import { pathParams, requestBody } from "./input";
import { readableRepository } from "./repo-lookup";
import { issueComment } from "./serializers";
import { fullNameOf } from "./threads";

export async function listComments(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const { issue_number: number } = pathParams(ctx, "issues/list-comments");
	const thread = await findThreadByNumber(repo.id, number);
	if (!thread) throw notFoundError();
	const params = pageParams(ctx.url.searchParams);
	const [comments, total] = await Promise.all([
		params.reachable
			? listCommentsForThread(thread, {
					limit: params.perPage,
					offset: params.offset,
				})
			: [],
		countCommentsForThread(thread),
	]);
	const fullName = fullNameOf(repo);
	const rollups = await commentReactionRollups(comments.map((c) => c.id));
	return json(
		comments.map((comment) =>
			issueComment({
				fullName,
				kind: thread.kind,
				number,
				comment,
				author: comment.author,
				reactions: rollups.get(comment.id) ?? emptyReactionRollup(),
			}),
		),
		200,
		linkHeader(ctx.url, params, total),
	);
}

export async function createComment(ctx: ApiContext) {
	const caller = requireScope(ctx, "repo:write");
	const { repo, access } = await readableRepository(ctx);
	if (!access.canParticipate) {
		throw forbiddenError("You can't comment on this issue");
	}
	const { issue_number: number } = pathParams(ctx, "issues/create-comment");
	const thread = await findThreadByNumber(repo.id, number);
	if (!thread) throw notFoundError();
	const { body } = await requestBody(
		ctx,
		"issues/create-comment",
		"IssueComment",
	);
	const created = await createCommentForUser(thread, caller.userId, body);
	const comment = await findCommentWithAuthor(created.id);
	if (!comment) throw new Error("Comment missing after insert");
	return json(
		issueComment({
			fullName: fullNameOf(repo),
			kind: thread.kind,
			number,
			comment,
			author: comment.author,
			reactions: emptyReactionRollup(),
		}),
		201,
		{
			Location: apiUrl(
				`/repos/${fullNameOf(repo)}/issues/comments/${created.id}`,
			),
		},
	);
}

async function requireComment(
	ctx: ApiContext,
	id: "issues/get-comment" | "issues/update-comment" | "issues/delete-comment",
	repoId: number,
) {
	const { comment_id } = pathParams(ctx, id);
	const comment = await findCommentWithAuthor(comment_id);
	if (!comment || comment.repoId !== repoId) throw notFoundError();
	const thread = await findThreadById(comment.issueId);
	if (!thread) throw notFoundError();
	return { comment, thread };
}

async function commentRollup(commentId: number) {
	const rollups = await commentReactionRollups([commentId]);
	return rollups.get(commentId) ?? emptyReactionRollup();
}

export async function getComment(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const { comment, thread } = await requireComment(
		ctx,
		"issues/get-comment",
		repo.id,
	);
	return json(
		issueComment({
			fullName: fullNameOf(repo),
			kind: thread.kind,
			number: thread.number,
			comment,
			author: comment.author,
			reactions: await commentRollup(comment.id),
		}),
	);
}

export async function updateComment(ctx: ApiContext) {
	const caller = requireScope(ctx, "repo:write");
	const { repo } = await readableRepository(ctx);
	const { comment, thread } = await requireComment(
		ctx,
		"issues/update-comment",
		repo.id,
	);
	if (!(await canEditComment(comment, caller.userId))) {
		throw forbiddenError("You do not have permission to edit this comment");
	}
	const { body } = await requestBody(
		ctx,
		"issues/update-comment",
		"IssueComment",
	);
	const updated = await updateCommentRow(comment, caller.userId, body);
	return json(
		issueComment({
			fullName: fullNameOf(repo),
			kind: thread.kind,
			number: thread.number,
			comment: updated,
			author: comment.author,
			reactions: await commentRollup(comment.id),
		}),
	);
}

export async function deleteComment(ctx: ApiContext) {
	const caller = requireScope(ctx, "repo:write");
	const { repo } = await readableRepository(ctx);
	const { comment, thread } = await requireComment(
		ctx,
		"issues/delete-comment",
		repo.id,
	);
	if (!(await canEditComment(comment, caller.userId))) {
		throw forbiddenError("You do not have permission to delete this comment");
	}
	await deleteCommentRow(comment, thread);
	return noContent();
}
