/**
 * A gist's stars, forks, commits and comments at `/api/v3`. Reads need only
 * the gist's id (a secret gist is unlisted, not private); stars, forks and
 * comment writes need the caller and the `gist` token scope.
 */
import { PrefixTooLargeError } from "git-fs-s3";
import { MAX_FORK_COPY_BYTES, MAX_GISTS_PER_USER } from "#/lib/limits";
import { gistCommitPage } from "../gist-git";
import {
	addGistStar,
	countGistComments,
	countGistsForOwner,
	deleteGistCommentRow,
	findGistById,
	findGistComment,
	findUsersByEmail,
	type GistCommentWithAuthor,
	type GistRowWithOwner,
	generateGistId,
	insertGist,
	insertGistComment,
	isGistStarred,
	listGistComments,
	listGistForks,
	removeGistStar,
	updateGistCommentRow,
} from "../gist-store";
import { deleteGistStorage, forkGistGitStorage } from "../git-fs";
import { withGistLocks } from "../git-repo-lock";
import { logError } from "../perf-log";
import { type ApiContext, requireCaller, requireScope } from "./auth";
import { fullGist, gistListResponse } from "./gists";
import {
	ApiError,
	apiUrl,
	json,
	linkHeader,
	noContent,
	notFoundError,
	pageParams,
} from "./http";
import { pathParams, requestBody } from "./input";
import { gistComment, gistCommit } from "./serializers";

type GistSocialId =
	| "gists/check-is-starred"
	| "gists/star"
	| "gists/unstar"
	| "gists/list-forks"
	| "gists/fork"
	| "gists/list-commits"
	| "gists/list-comments"
	| "gists/create-comment";

type GistCommentId =
	| "gists/get-comment"
	| "gists/update-comment"
	| "gists/delete-comment";

async function gistByPath(
	ctx: ApiContext,
	id: GistSocialId,
): Promise<GistRowWithOwner> {
	const { gist_id } = pathParams(ctx, id);
	const row = await findGistById(gist_id);
	if (!row) throw notFoundError();
	return row;
}

async function commentByPath(
	ctx: ApiContext,
	id: GistCommentId,
): Promise<{ gist: GistRowWithOwner; comment: GistCommentWithAuthor }> {
	const { gist_id, comment_id } = pathParams(ctx, id);
	const gist = await findGistById(gist_id);
	if (!gist) throw notFoundError();
	const comment = await findGistComment(gist.id, comment_id);
	if (!comment) throw notFoundError();
	return { gist, comment };
}

/** `GET /gists/{gist_id}/star`: 204 when starred, 404 when not. */
export async function checkGistStarred(ctx: ApiContext) {
	const caller = requireCaller(ctx);
	const row = await gistByPath(ctx, "gists/check-is-starred");
	if (!(await isGistStarred(row.id, caller.userId))) throw notFoundError();
	return noContent();
}

export async function starGist(ctx: ApiContext) {
	const caller = requireScope(ctx, "gist");
	const row = await gistByPath(ctx, "gists/star");
	await addGistStar(row.id, caller.userId);
	return noContent();
}

export async function unstarGist(ctx: ApiContext) {
	const caller = requireScope(ctx, "gist");
	const row = await gistByPath(ctx, "gists/unstar");
	await removeGistStar(row.id, caller.userId);
	return noContent();
}

export async function listForks(ctx: ApiContext) {
	const row = await gistByPath(ctx, "gists/list-forks");
	const params = pageParams(ctx.url.searchParams);
	const data = await listGistForks(row.id, {
		limit: params.perPage,
		offset: params.offset,
	});
	return gistListResponse(ctx, data, params);
}

/**
 * `POST /gists/{gist_id}/forks`: copy the parent's git data under both gists'
 * locks, then insert the row — a row therefore always means a complete fork.
 * Any failure removes the partial copy, since the fork's id is fresh.
 */
export async function forkGist(ctx: ApiContext) {
	const caller = requireScope(ctx, "gist");
	const parent = await gistByPath(ctx, "gists/fork");
	if ((await countGistsForOwner(caller.userId)) >= MAX_GISTS_PER_USER) {
		throw new ApiError(422, "Maximum number of gists reached");
	}
	const id = generateGistId();
	await withGistLocks([parent.id, id], async () => {
		try {
			const copied = await forkGistGitStorage(
				parent.id,
				id,
				MAX_FORK_COPY_BYTES,
			);
			if (copied === 0) {
				throw new Error(`Cannot fork gist ${parent.id}: its storage is empty`);
			}
			await insertGist({
				id,
				ownerId: caller.userId,
				description: parent.description,
				visibility: parent.visibility,
				forkOfId: parent.id,
			});
		} catch (error) {
			await deleteGistStorage(id).catch((cleanup: unknown) =>
				logError("gists", `Storage for ${id} was not removed`, cleanup),
			);
			if (error instanceof PrefixTooLargeError) {
				throw new ApiError(422, error.message);
			}
			throw error;
		}
	});
	const fork = await findGistById(id);
	if (!fork) throw new Error("Gist missing after insert");
	const shaped = await fullGist(fork);
	return json(shaped, 201, { Location: shaped.url });
}

export async function listCommits(ctx: ApiContext) {
	const row = await gistByPath(ctx, "gists/list-commits");
	const params = pageParams(ctx.url.searchParams);
	const entries = params.reachable
		? await gistCommitPage(row.id, params.perPage, params.offset)
		: [];
	const authors = await findUsersByEmail(
		entries.map((entry) => entry.commit.commit.committer.email),
	);
	return json(
		entries.map((entry) => {
			const email = entry.commit.commit.committer.email;
			return gistCommit(row, entry, authors.get(email) ?? null);
		}),
	);
}

export async function listComments(ctx: ApiContext) {
	const row = await gistByPath(ctx, "gists/list-comments");
	const params = pageParams(ctx.url.searchParams);
	const [comments, total] = await Promise.all([
		params.reachable
			? listGistComments(row.id, {
					limit: params.perPage,
					offset: params.offset,
				})
			: [],
		countGistComments(row.id),
	]);
	return json(
		comments.map((comment) => gistComment(row, comment)),
		200,
		linkHeader(ctx.url, params, total),
	);
}

export async function getComment(ctx: ApiContext) {
	const { gist, comment } = await commentByPath(ctx, "gists/get-comment");
	return json(gistComment(gist, comment));
}

export async function createComment(ctx: ApiContext) {
	const caller = requireScope(ctx, "gist");
	const row = await gistByPath(ctx, "gists/create-comment");
	const { body } = await requestBody(
		ctx,
		"gists/create-comment",
		"GistComment",
	);
	const created = await insertGistComment({
		gistId: row.id,
		userId: caller.userId,
		body,
	});
	const comment = await findGistComment(row.id, created.id);
	if (!comment) throw new Error("Gist comment missing after insert");
	return json(gistComment(row, comment), 201, {
		Location: apiUrl(`/gists/${row.id}/comments/${created.id}`),
	});
}

/** Only the comment's author may change it; GitHub answers anyone else 404. */
async function ownComment(
	ctx: ApiContext,
	id: "gists/update-comment" | "gists/delete-comment",
) {
	const { userId } = requireScope(ctx, "gist");
	const { gist, comment } = await commentByPath(ctx, id);
	if (comment.userId !== userId) throw notFoundError();
	return { gist, comment };
}

export async function updateComment(ctx: ApiContext) {
	const { gist, comment } = await ownComment(ctx, "gists/update-comment");
	const { body } = await requestBody(
		ctx,
		"gists/update-comment",
		"GistComment",
	);
	await updateGistCommentRow(comment.id, body);
	const updated = await findGistComment(gist.id, comment.id);
	if (!updated) throw new Error("Gist comment missing after update");
	return json(gistComment(gist, updated));
}

export async function deleteComment(ctx: ApiContext) {
	const { comment } = await ownComment(ctx, "gists/delete-comment");
	await deleteGistCommentRow(comment.id);
	return noContent();
}
