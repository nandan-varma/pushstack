/**
 * GitHub's issue comments at `/api/v3`: list, get, create, update and delete.
 * A comment is addressed by its issue or pull request `#N` (GitHub serves a
 * pull request's comments through the issues endpoints too); the single-comment
 * routes address it by id.
 */
import { z } from "zod";
import { MAX_BODY_CHARS } from "#/lib/limits";
import {
	canEditComment,
	countCommentsForThread,
	createCommentForUser,
	deleteCommentRow,
	findCommentWithAuthor,
	listCommentsForThread,
	threadIdOf,
	updateCommentRow,
} from "../comment-store";
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
	readJsonObject,
	validationFailedError,
} from "./http";
import { readableRepository } from "./repo-lookup";
import { issueComment } from "./serializers";
import { fullNameOf, threadNumber } from "./threads";

const commentBodySchema = z.object({
	body: z.string().trim().min(1).max(MAX_BODY_CHARS),
});

const bodyError = (
	body: Record<string, unknown>,
): { resource: string; field: string; code: "missing_field" | "invalid" }[] => [
	{
		resource: "IssueComment",
		field: "body",
		code: body.body === undefined ? "missing_field" : "invalid",
	},
];

/** `GET /repos/{owner}/{repo}/issues/{number}/comments` */
export async function listComments(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const number = threadNumber(ctx.params.number);
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
	return json(
		comments.map((comment) =>
			issueComment({
				fullName,
				kind: thread.kind,
				number,
				comment,
				author: comment.author,
			}),
		),
		200,
		linkHeader(ctx.url, params, total),
	);
}

/** `POST /repos/{owner}/{repo}/issues/{number}/comments` */
export async function createComment(ctx: ApiContext) {
	const caller = requireScope(ctx, "repo:write");
	const { repo, access } = await readableRepository(ctx);
	if (!access.canParticipate) {
		throw forbiddenError("You can't comment on this issue");
	}
	const number = threadNumber(ctx.params.number);
	const thread = await findThreadByNumber(repo.id, number);
	if (!thread) throw notFoundError();
	const body = await readJsonObject(ctx.request);
	const parsed = commentBodySchema.safeParse(body);
	if (!parsed.success) {
		throw validationFailedError("Validation Failed", bodyError(body));
	}
	const created = await createCommentForUser(
		thread,
		caller.userId,
		parsed.data.body,
	);
	const comment = await findCommentWithAuthor(created.id);
	if (!comment) throw new Error("Comment missing after insert");
	return json(
		issueComment({
			fullName: fullNameOf(repo),
			kind: thread.kind,
			number,
			comment,
			author: comment.author,
		}),
		201,
		{
			Location: apiUrl(
				`/repos/${fullNameOf(repo)}/issues/comments/${created.id}`,
			),
		},
	);
}

/** The comment named by `:comment_id`, scoped to the repository, with its thread. */
async function requireComment(ctx: ApiContext, repoId: number) {
	const raw = ctx.params.comment_id;
	if (!raw || !/^\d+$/.test(raw)) throw notFoundError();
	const comment = await findCommentWithAuthor(Number(raw));
	if (!comment || comment.repoId !== repoId) throw notFoundError();
	const thread = await findThreadById(threadIdOf(comment));
	if (!thread) throw notFoundError();
	return { comment, thread };
}

/** `GET /repos/{owner}/{repo}/issues/comments/{comment_id}` */
export async function getComment(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const { comment, thread } = await requireComment(ctx, repo.id);
	return json(
		issueComment({
			fullName: fullNameOf(repo),
			kind: thread.kind,
			number: thread.number,
			comment,
			author: comment.author,
		}),
	);
}

/** `PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}` */
export async function updateComment(ctx: ApiContext) {
	const caller = requireScope(ctx, "repo:write");
	const { repo } = await readableRepository(ctx);
	const { comment, thread } = await requireComment(ctx, repo.id);
	if (!(await canEditComment(comment, caller.userId))) {
		throw forbiddenError("You do not have permission to edit this comment");
	}
	const body = await readJsonObject(ctx.request);
	const parsed = commentBodySchema.safeParse(body);
	if (!parsed.success) {
		throw validationFailedError("Validation Failed", bodyError(body));
	}
	const updated = await updateCommentRow(
		comment,
		caller.userId,
		parsed.data.body,
	);
	return json(
		issueComment({
			fullName: fullNameOf(repo),
			kind: thread.kind,
			number: thread.number,
			comment: updated,
			author: comment.author,
		}),
	);
}

/** `DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}` */
export async function deleteComment(ctx: ApiContext) {
	const caller = requireScope(ctx, "repo:write");
	const { repo } = await readableRepository(ctx);
	const { comment, thread } = await requireComment(ctx, repo.id);
	if (!(await canEditComment(comment, caller.userId))) {
		throw forbiddenError("You do not have permission to delete this comment");
	}
	await deleteCommentRow(comment, thread);
	return noContent();
}
