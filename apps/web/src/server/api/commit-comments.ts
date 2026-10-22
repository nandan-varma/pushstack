/**
 * GitHub's commit comments at `/api/v3`: a repository's (`…/comments`), one
 * commit's (`…/commits/{commit_sha}/comments`), and one by id.
 */

import {
	canEditCommitComment,
	countCommitComments,
	createCommitComment,
	deleteCommitComment,
	findCommitComment,
	listCommitComments,
	updateCommitCommentBody,
} from "../commit-comment-store";
import { getCommit, getCommitDiff } from "../git-read";
import {
	safeCommitRevSchema,
	safeCommitShaSchema,
	safeRepoPathSchema,
} from "../git-ref-name";
import { ownerKeyOf } from "../git-storage-naming";
import type { RepositoryRowWithOwner } from "../repository-lookup";
import { type ApiContext, requireScope } from "./auth";
import {
	ApiError,
	apiUrl,
	forbiddenError,
	json,
	linkHeader,
	noContent,
	notFoundError,
	pageParams,
	validationFailedError,
} from "./http";
import { pathParams, requestBody } from "./input";
import { readableRepository } from "./repo-lookup";
import { commitComment } from "./serializers";
import { fullNameOf } from "./threads";

const noCommitError = (rev: string) =>
	new ApiError(422, `No commit found for SHA: ${rev}`);

/** The full sha `rev` names in `repo`; GitHub's 422 when it names none. */
async function resolveCommitSha(
	repo: RepositoryRowWithOwner,
	rev: string,
): Promise<string> {
	if (!safeCommitRevSchema.safeParse(rev).success) throw noCommitError(rev);
	const info = await getCommit(ownerKeyOf(repo), repo.name, rev).catch(() => {
		throw noCommitError(rev);
	});
	const sha = safeCommitShaSchema.safeParse(info.oid);
	if (!sha.success) throw noCommitError(rev);
	return sha.data;
}

type CommentRow = NonNullable<Awaited<ReturnType<typeof findCommitComment>>>;

const serialize = (repo: RepositoryRowWithOwner) => (row: CommentRow) =>
	commitComment({
		fullName: fullNameOf(repo),
		comment: row,
		author: row.author,
	});

async function listPage(
	ctx: ApiContext,
	repo: RepositoryRowWithOwner,
	commitSha?: string,
) {
	const params = pageParams(ctx.url.searchParams);
	const [rows, total] = await Promise.all([
		params.reachable
			? listCommitComments(repo.id, commitSha, {
					limit: params.perPage,
					offset: params.offset,
				})
			: [],
		countCommitComments(repo.id, commitSha),
	]);
	return json(
		rows.map(serialize(repo)),
		200,
		linkHeader(ctx.url, params, total),
	);
}

export async function listRepoCommitComments(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	return listPage(ctx, repo);
}

export async function listCommentsForCommit(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const { commit_sha } = pathParams(ctx, "repos/list-comments-for-commit");
	return listPage(ctx, repo, await resolveCommitSha(repo, commit_sha));
}

export async function createCommitCommentHandler(ctx: ApiContext) {
	const caller = requireScope(ctx, "repo:write");
	const { repo, access } = await readableRepository(ctx);
	if (!access.canParticipate) {
		throw forbiddenError("You can't comment on this commit");
	}
	const { commit_sha } = pathParams(ctx, "repos/create-commit-comment");
	const commitSha = await resolveCommitSha(repo, commit_sha);
	const { body, path, position, line } = await requestBody(
		ctx,
		"repos/create-commit-comment",
		"CommitComment",
	);
	if (path !== undefined) {
		const diff = safeRepoPathSchema.safeParse(path).success
			? await getCommitDiff(ownerKeyOf(repo), repo.name, commitSha)
			: undefined;
		if (!diff?.files.some((file) => file.path === path)) {
			throw validationFailedError("Validation Failed", [
				{ resource: "CommitComment", field: "path", code: "invalid" },
			]);
		}
	}
	const created = await createCommitComment({
		repoId: repo.id,
		commitSha,
		authorId: caller.userId,
		body,
		anchor: {
			path: path ?? null,
			position: path === undefined ? null : (position ?? null),
			line: path === undefined ? null : (line ?? null),
		},
	});
	const row = await findCommitComment(repo.id, created.id);
	if (!row) throw new Error("Commit comment missing after insert");
	return json(serialize(repo)(row), 201, {
		Location: apiUrl(`/repos/${fullNameOf(repo)}/comments/${created.id}`),
	});
}

async function requireCommitComment(
	ctx: ApiContext,
	id:
		| "repos/get-commit-comment"
		| "repos/update-commit-comment"
		| "repos/delete-commit-comment",
	repoId: number,
) {
	const { comment_id } = pathParams(ctx, id);
	const row = await findCommitComment(repoId, comment_id);
	if (!row) throw notFoundError();
	return row;
}

export async function getCommitCommentHandler(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const row = await requireCommitComment(
		ctx,
		"repos/get-commit-comment",
		repo.id,
	);
	return json(serialize(repo)(row));
}

export async function updateCommitCommentHandler(ctx: ApiContext) {
	const caller = requireScope(ctx, "repo:write");
	const { repo } = await readableRepository(ctx);
	const row = await requireCommitComment(
		ctx,
		"repos/update-commit-comment",
		repo.id,
	);
	if (!(await canEditCommitComment(row, caller.userId))) {
		throw forbiddenError("You do not have permission to edit this comment");
	}
	const { body } = await requestBody(
		ctx,
		"repos/update-commit-comment",
		"CommitComment",
	);
	const updated = await updateCommitCommentBody(row, body);
	return json(serialize(repo)({ ...updated, author: row.author }));
}

export async function deleteCommitCommentHandler(ctx: ApiContext) {
	const caller = requireScope(ctx, "repo:write");
	const { repo } = await readableRepository(ctx);
	const row = await requireCommitComment(
		ctx,
		"repos/delete-commit-comment",
		repo.id,
	);
	if (!(await canEditCommitComment(row, caller.userId))) {
		throw forbiddenError("You do not have permission to delete this comment");
	}
	await deleteCommitComment(row);
	return noContent();
}
