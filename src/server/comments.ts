import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
	activities,
	comments,
	issues,
	pullRequests,
} from "../db/github-schema";
import {
	canModerateRepo,
	canWriteRepo,
	getAccessForRepository,
	requireWriteAccess,
} from "./repo-access";
import { getCurrentUser, getCurrentUserOptional } from "./session";

// ============ COMMENTS ============

// Create comment
export const createComment = createServerFn({ method: "POST" })
	.validator((data: unknown) =>
		z
			.object({
				repoId: z.number(),
				issueId: z.number().optional(),
				pullRequestId: z.number().optional(),
				body: z.string().min(1),
			})
			.parse(data),
	)
	.handler(async ({ data }) => {
		const user = await getCurrentUser();

		await requireWriteAccess(data.repoId, user.id);

		if (!data.issueId && !data.pullRequestId) {
			throw new Error("Must specify issueId or pullRequestId");
		}

		if (data.issueId) {
			const issue = await db.query.issues.findFirst({
				where: eq(issues.id, data.issueId),
			});
			if (!issue || issue.repoId !== data.repoId) {
				throw new Error("Issue does not belong to the specified repository");
			}
		}

		if (data.pullRequestId) {
			const pullRequest = await db.query.pullRequests.findFirst({
				where: eq(pullRequests.id, data.pullRequestId),
			});
			if (!pullRequest || pullRequest.repoId !== data.repoId) {
				throw new Error(
					"Pull request does not belong to the specified repository",
				);
			}
		}

		const [comment] = await db
			.insert(comments)
			.values({
				repoId: data.repoId,
				issueId: data.issueId || null,
				pullRequestId: data.pullRequestId || null,
				authorId: user.id,
				body: data.body,
			})
			.returning();

		// Log activity
		await db.insert(activities).values({
			userId: user.id,
			repoId: data.repoId,
			type: "comment",
			metadata: {
				commentId: comment.id,
				issueId: data.issueId,
				prId: data.pullRequestId,
			},
		});

		return comment;
	});

// Get comments
export const getComments = createServerFn({ method: "GET" })
	.validator((data: unknown) =>
		z
			.object({
				issueId: z.number().optional(),
				pullRequestId: z.number().optional(),
			})
			.parse(data),
	)
	.handler(async ({ data }) => {
		if (!data.issueId && !data.pullRequestId) {
			throw new Error("Must specify issueId or pullRequestId");
		}

		const user = await getCurrentUserOptional();

		if (data.issueId) {
			const issue = await db.query.issues.findFirst({
				where: eq(issues.id, data.issueId),
				with: { repository: true },
			});

			// ponytail: fetch the repository via the relation above instead of a
			// second round trip inside canReadRepo.
			const access =
				issue && (await getAccessForRepository(issue.repository, user?.id));
			if (!access?.canRead) {
				throw new Error("Access denied");
			}
		}

		if (data.pullRequestId) {
			const pullRequest = await db.query.pullRequests.findFirst({
				where: eq(pullRequests.id, data.pullRequestId),
				with: { repository: true },
			});

			const access =
				pullRequest &&
				(await getAccessForRepository(pullRequest.repository, user?.id));
			if (!access?.canRead) {
				throw new Error("Access denied");
			}
		}

		const commentList = await db.query.comments.findMany({
			where: data.issueId
				? eq(comments.issueId, data.issueId)
				: eq(comments.pullRequestId, data.pullRequestId as number),
			with: {
				author: true,
			},
			orderBy: [comments.createdAt],
		});

		return commentList;
	});

// Update comment
export const updateComment = createServerFn({ method: "POST" })
	.validator((data: unknown) =>
		z
			.object({
				commentId: z.number(),
				body: z.string().min(1),
			})
			.parse(data),
	)
	.handler(async ({ data }) => {
		const user = await getCurrentUser();

		const comment = await db.query.comments.findFirst({
			where: eq(comments.id, data.commentId),
		});

		if (!comment) {
			throw new Error("Comment not found");
		}

		if (
			comment.authorId !== user.id &&
			!(await canWriteRepo(comment.repoId, user.id))
		) {
			throw new Error("Only comment author can edit");
		}

		const [updated] = await db
			.update(comments)
			.set({
				body: data.body,
				updatedAt: new Date(),
			})
			.where(eq(comments.id, data.commentId))
			.returning();

		return updated;
	});

// Delete comment
export const deleteComment = createServerFn({ method: "POST" })
	.validator((data: unknown) =>
		z
			.object({
				commentId: z.number(),
			})
			.parse(data),
	)
	.handler(async ({ data }) => {
		const user = await getCurrentUser();

		const comment = await db.query.comments.findFirst({
			where: eq(comments.id, data.commentId),
			with: {
				repository: true,
			},
		});

		if (!comment) {
			throw new Error("Comment not found");
		}

		if (
			comment.authorId !== user.id &&
			!(await canModerateRepo(comment.repoId, user.id))
		) {
			throw new Error("Not authorized to delete this comment");
		}

		await db.delete(comments).where(eq(comments.id, data.commentId));

		return { success: true };
	});
