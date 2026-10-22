import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { MAX_BODY_CHARS } from "#/lib/limits";
import { threadPageSchema } from "#/lib/thread-page";
import {
	type CommitComment,
	canEditCommitComment,
	createCommitComment,
	deleteCommitComment,
	findCommitComment,
	listCommitComments,
	updateCommitCommentBody,
} from "./commit-comment-store";
import { getCommit } from "./git-read";
import { safeCommitShaSchema } from "./git-ref-name";
import { ownerKeyOf } from "./git-storage-naming";
import {
	getRepositoryAccess,
	readWithAccess,
	requireParticipateAccess,
} from "./repo-access";
import { getCurrentUser, getCurrentUserOptional } from "./session";

const commentBody = () => z.string().trim().min(1).max(MAX_BODY_CHARS);

export const getCommitComments = createServerFn({ method: "GET" })
	.validator(
		threadPageSchema.extend({ repoId: z.number(), sha: safeCommitShaSchema }),
	)
	.handler(({ data }) =>
		readWithAccess("getCommitComments", data.repoId, async () => {
			const user = await getCurrentUserOptional();
			const [rows, access] = await Promise.all([
				listCommitComments(data.repoId, data.sha.toLowerCase(), {
					limit: data.limit,
					offset: data.skip,
				}),
				getRepositoryAccess(data.repoId, user?.id),
			]);
			const canParticipate = Boolean(user && access?.canParticipate);
			const canModerate = Boolean(user && access?.canWrite);
			return {
				canComment: canParticipate,
				comments: rows.map(({ author, ...comment }) => ({
					...comment,
					author: {
						name: author.name,
						username: author.username,
						image: author.image,
					},
					canEdit:
						canModerate || (canParticipate && comment.authorId === user?.id),
				})),
			};
		}),
	);

export const addCommitComment = createServerFn({ method: "POST" })
	.validator(
		z.object({
			repoId: z.number(),
			sha: safeCommitShaSchema,
			body: commentBody(),
		}),
	)
	.handler(async ({ data }) => {
		const user = await getCurrentUser();
		return readWithAccess("addCommitComment", data.repoId, async (repo) => {
			await requireParticipateAccess(repo.id, user.id);
			const sha = data.sha.toLowerCase();
			// Missing commit = notFound (readWithAccess maps the git error).
			await getCommit(ownerKeyOf(repo), repo.name, sha);
			return createCommitComment({
				repoId: repo.id,
				commitSha: sha,
				authorId: user.id,
				body: data.body,
			});
		});
	});

async function requireEditable(
	repoId: number,
	commentId: number,
	userId: string,
): Promise<CommitComment> {
	const comment = await findCommitComment(repoId, commentId);
	if (!comment) throw notFound();
	if (!(await canEditCommitComment(comment, userId))) {
		throw new Error("Access denied");
	}
	return comment;
}

export const editCommitComment = createServerFn({ method: "POST" })
	.validator(
		z.object({
			repoId: z.number(),
			commentId: z.number(),
			body: commentBody(),
		}),
	)
	.handler(async ({ data }) => {
		const user = await getCurrentUser();
		const comment = await requireEditable(data.repoId, data.commentId, user.id);
		return updateCommitCommentBody(comment, data.body);
	});

export const removeCommitComment = createServerFn({ method: "POST" })
	.validator(z.object({ repoId: z.number(), commentId: z.number() }))
	.handler(async ({ data }) => {
		const user = await getCurrentUser();
		const comment = await requireEditable(data.repoId, data.commentId, user.id);
		await deleteCommitComment(comment);
		return { success: true };
	});
