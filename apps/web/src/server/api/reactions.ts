/**
 * GitHub's reactions at `/api/v3` for issues (and pull requests, through the
 * issues endpoints) and issue comments: list (with a `content` filter), create
 * (201 when new, 200 when the caller already had it) and delete (204).
 * Reading needs read access; reacting needs a signed-in participant with a
 * `repo:write` token; a reaction is deleted only by its author.
 */
import { findCommentWithAuthor } from "../comment-store";
import {
	addReaction,
	deleteReactionById,
	findReaction,
	findReactionWithUser,
	listReactions,
	type ReactionSubject,
} from "../reaction-store";
import { findThreadByNumber } from "../thread-store";
import { type ApiContext, requireScope } from "./auth";
import {
	forbiddenError,
	json,
	linkHeader,
	noContent,
	notFoundError,
	pageParams,
} from "./http";
import { pathParams, queryParams, requestBody } from "./input";
import { readableRepository } from "./repo-lookup";
import { reaction } from "./serializers";

type RepoAccess = Awaited<ReturnType<typeof readableRepository>>;

async function issueSubject(
	ctx: ApiContext,
	id:
		| "reactions/list-for-issue"
		| "reactions/create-for-issue"
		| "reactions/delete-for-issue",
	{ repo }: RepoAccess,
): Promise<ReactionSubject> {
	const { issue_number } = pathParams(ctx, id);
	const thread = await findThreadByNumber(repo.id, issue_number);
	if (!thread) throw notFoundError();
	return { issueId: thread.id };
}

async function commentSubject(
	ctx: ApiContext,
	id:
		| "reactions/list-for-issue-comment"
		| "reactions/create-for-issue-comment"
		| "reactions/delete-for-issue-comment",
	{ repo }: RepoAccess,
): Promise<ReactionSubject> {
	const { comment_id } = pathParams(ctx, id);
	const comment = await findCommentWithAuthor(comment_id);
	if (!comment || comment.repoId !== repo.id) throw notFoundError();
	return { issueId: comment.issueId, commentId: comment.id };
}

async function list(
	ctx: ApiContext,
	id: "reactions/list-for-issue" | "reactions/list-for-issue-comment",
	subject: ReactionSubject,
) {
	const { content } = queryParams(ctx, id, "Reaction");
	const params = pageParams(ctx.url.searchParams);
	const { reactions, total } = params.reachable
		? await listReactions(subject, {
				content,
				limit: params.perPage,
				offset: params.offset,
			})
		: { reactions: [], total: 0 };
	return json(reactions.map(reaction), 200, linkHeader(ctx.url, params, total));
}

async function create(
	ctx: ApiContext,
	id: "reactions/create-for-issue" | "reactions/create-for-issue-comment",
	access: RepoAccess,
	subject: ReactionSubject,
) {
	const caller = requireScope(ctx, "repo:write");
	if (!access.access.canParticipate) {
		throw forbiddenError("You can't react to this");
	}
	const { content } = await requestBody(ctx, id, "Reaction");
	const result = await addReaction(subject, caller.userId, content);
	const saved = await findReactionWithUser(result.reaction.id);
	if (!saved) throw new Error("Reaction missing after insert");
	return json(reaction(saved), result.created ? 201 : 200);
}

async function remove(
	ctx: ApiContext,
	id: "reactions/delete-for-issue" | "reactions/delete-for-issue-comment",
	subject: ReactionSubject,
) {
	const caller = requireScope(ctx, "repo:write");
	const { reaction_id } = pathParams(ctx, id);
	const found = await findReaction(subject, reaction_id);
	if (!found) throw notFoundError();
	if (found.userId !== caller.userId) {
		throw forbiddenError("You can only delete your own reactions");
	}
	await deleteReactionById(found.id);
	return noContent();
}

export async function listIssueReactions(ctx: ApiContext) {
	const access = await readableRepository(ctx);
	const id = "reactions/list-for-issue";
	return list(ctx, id, await issueSubject(ctx, id, access));
}

export async function createIssueReaction(ctx: ApiContext) {
	const access = await readableRepository(ctx);
	const id = "reactions/create-for-issue";
	return create(ctx, id, access, await issueSubject(ctx, id, access));
}

export async function deleteIssueReaction(ctx: ApiContext) {
	const access = await readableRepository(ctx);
	const id = "reactions/delete-for-issue";
	return remove(ctx, id, await issueSubject(ctx, id, access));
}

export async function listCommentReactions(ctx: ApiContext) {
	const access = await readableRepository(ctx);
	const id = "reactions/list-for-issue-comment";
	return list(ctx, id, await commentSubject(ctx, id, access));
}

export async function createCommentReaction(ctx: ApiContext) {
	const access = await readableRepository(ctx);
	const id = "reactions/create-for-issue-comment";
	return create(ctx, id, access, await commentSubject(ctx, id, access));
}

export async function deleteCommentReaction(ctx: ApiContext) {
	const access = await readableRepository(ctx);
	const id = "reactions/delete-for-issue-comment";
	return remove(ctx, id, await commentSubject(ctx, id, access));
}
