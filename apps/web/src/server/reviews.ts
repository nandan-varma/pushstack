import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { pullRequestReviewComments, pullRequestReviews } from "#/db/app-schema";
import { MAX_BODY_CHARS, MAX_REVIEW_PATH_CHARS } from "#/lib/limits";
import type { ReviewState } from "#/lib/review-types";
import { safeRepoPathSchema } from "./git-ref-name";
import {
	canWriteRepo,
	readWithAccess,
	requireParticipateAccess,
} from "./repo-access";
import {
	assertReviewAnchor,
	assertReviewCommentCapacity,
	buildReviewThreads,
	findOrCreatePendingReview,
	listReviewComments,
	pendingReviewFor,
	submitPendingReview,
	toView,
} from "./review-store";
import { getCurrentUser, getCurrentUserOptional } from "./session";
import { findPullRequestById, type PullRequest } from "./thread-store";

const reviewSideSchema = z.enum(["LEFT", "RIGHT"]);
const reviewEventSchema = z.enum(["comment", "approve", "request_changes"]);

async function findPullRequest(prId: number): Promise<PullRequest> {
	const pr = await findPullRequestById(prId);
	if (!pr) throw notFound();
	return pr;
}

export const getPullRequestReviewThreads = createServerFn({ method: "GET" })
	.validator(z.object({ prId: z.number().int().positive() }))
	.handler(async ({ data }) => {
		const pr = await findPullRequest(data.prId);
		return readWithAccess(
			`getPullRequestReviewThreads #${pr.number}`,
			pr.repoId,
			async () => {
				const viewer = await getCurrentUserOptional();
				const rows = await listReviewComments(pr.id);
				// Another reviewer's pending comments stay private until they submit.
				return buildReviewThreads(
					rows.filter(
						(row) =>
							row.review.state !== "pending" ||
							row.review.authorId === viewer?.id,
					),
				);
			},
		);
	});

export const getMyPendingReview = createServerFn({ method: "GET" })
	.validator(z.object({ prId: z.number().int().positive() }))
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		const pr = await findPullRequest(data.prId);
		return readWithAccess(
			`getMyPendingReview #${pr.number}`,
			pr.repoId,
			async () => {
				const review = await pendingReviewFor(pr.id, currentUser.id);
				if (!review) return null;
				const comments = (await listReviewComments(pr.id)).filter(
					(row) => row.reviewId === review.id,
				);
				return {
					...review,
					comments: comments.map(toView),
				};
			},
		);
	});

/**
 * Add a line comment to the viewer's pending review, or a reply to an existing
 * thread. A root comment's `(path, side, line)` must be on the pull request's
 * current diff; a reply inherits the anchor it answers.
 */
export const createReviewComment = createServerFn({ method: "POST" })
	.validator(
		z.object({
			prId: z.number().int().positive(),
			body: z.string().trim().min(1).max(MAX_BODY_CHARS),
			path: safeRepoPathSchema.min(1).max(MAX_REVIEW_PATH_CHARS).optional(),
			line: z.number().int().min(1).optional(),
			side: reviewSideSchema.default("RIGHT"),
			inReplyToId: z.number().int().positive().optional(),
		}),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		const pr = await findPullRequest(data.prId);
		return readWithAccess(
			`createReviewComment #${pr.number}`,
			pr.repoId,
			async (repo) => {
				await requireParticipateAccess(pr.repoId, currentUser.id);
				await assertReviewCommentCapacity(pr.id);

				if (data.inReplyToId !== undefined) {
					const parent = await db.query.pullRequestReviewComments.findFirst({
						where: { id: data.inReplyToId },
					});
					if (!parent || parent.pullRequestId !== pr.id) {
						throw new Error(
							"The comment being replied to isn't on this pull request",
						);
					}
					// A reply to someone else's unsubmitted draft would inject into a
					// review they can't see, so it's rejected like a missing comment.
					const parentReview = await db.query.pullRequestReviews.findFirst({
						columns: { state: true, authorId: true },
						where: { id: parent.reviewId },
					});
					if (
						parentReview?.state === "pending" &&
						parentReview.authorId !== currentUser.id
					) {
						throw new Error(
							"The comment being replied to isn't on this pull request",
						);
					}
					const [reply] = await db
						.insert(pullRequestReviewComments)
						.values({
							repoId: pr.repoId,
							pullRequestId: pr.id,
							reviewId: parent.reviewId,
							authorId: currentUser.id,
							body: data.body,
							path: parent.path,
							side: parent.side,
							line: parent.line,
							commitSha: parent.commitSha,
							inReplyToId: parent.id,
						})
						.returning();
					if (!reply) throw new Error("Review comment insert returned no row");
					return reply;
				}

				if (data.path === undefined || data.line === undefined) {
					throw new Error("A line comment needs a path and a line");
				}
				const commitSha = await assertReviewAnchor(repo, pr, {
					path: data.path,
					side: data.side,
					line: data.line,
				});
				const review = await findOrCreatePendingReview(pr, currentUser.id);
				const [comment] = await db
					.insert(pullRequestReviewComments)
					.values({
						repoId: pr.repoId,
						pullRequestId: pr.id,
						reviewId: review.id,
						authorId: currentUser.id,
						body: data.body,
						path: data.path,
						side: data.side,
						line: data.line,
						commitSha,
					})
					.returning();
				if (!comment) throw new Error("Review comment insert returned no row");
				return comment;
			},
		);
	});

/**
 * Submit the viewer's pending review as a Comment, an Approval or a Request
 * for changes, recording a `reviewed` timeline event. Approving and requesting
 * changes need write access and can't be done on one's own pull request.
 */
export const submitReview = createServerFn({ method: "POST" })
	.validator(
		z.object({
			prId: z.number().int().positive(),
			event: reviewEventSchema,
			body: z.string().trim().max(MAX_BODY_CHARS).optional(),
		}),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		const pr = await findPullRequest(data.prId);
		return readWithAccess(
			`submitReview #${pr.number}`,
			pr.repoId,
			async (repo) => {
				await requireParticipateAccess(pr.repoId, currentUser.id);
				if (data.event !== "comment") {
					if (!(await canWriteRepo(pr.repoId, currentUser.id))) {
						throw new Error(
							"You need write access to approve or request changes",
						);
					}
					if (pr.authorId === currentUser.id) {
						throw new Error("You can't review your own pull request");
					}
				}

				const state: ReviewState =
					data.event === "approve"
						? "approved"
						: data.event === "request_changes"
							? "changes_requested"
							: "commented";
				const review = await findOrCreatePendingReview(pr, currentUser.id);
				return submitPendingReview(
					repo,
					pr,
					review,
					state,
					data.body?.trim() ? data.body.trim() : null,
				);
			},
		);
	});

export const discardPendingReview = createServerFn({ method: "POST" })
	.validator(z.object({ prId: z.number().int().positive() }))
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		const pr = await findPullRequest(data.prId);
		return readWithAccess(
			`discardPendingReview #${pr.number}`,
			pr.repoId,
			async () => {
				const review = await pendingReviewFor(pr.id, currentUser.id);
				if (review) {
					await db
						.delete(pullRequestReviews)
						.where(eq(pullRequestReviews.id, review.id));
				}
				return { success: true };
			},
		);
	});

/**
 * Resolve or unresolve a thread. GitHub's rule: write access or the pull
 * request's author; only the root comment carries the state.
 */
export const resolveReviewThread = createServerFn({ method: "POST" })
	.validator(
		z.object({
			commentId: z.number().int().positive(),
			resolved: z.boolean(),
		}),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUser();
		const comment = await db.query.pullRequestReviewComments.findFirst({
			where: { id: data.commentId },
		});
		if (!comment) throw notFound();
		if (comment.inReplyToId !== null) {
			throw new Error("Only a thread's first comment can be resolved");
		}
		const pr = await findPullRequest(comment.pullRequestId);
		return readWithAccess(
			`resolveReviewThread #${pr.number}`,
			pr.repoId,
			async () => {
				const allowed =
					pr.authorId === currentUser.id ||
					(await canWriteRepo(pr.repoId, currentUser.id));
				if (!allowed) {
					throw new Error(
						"You can't resolve conversations on this pull request",
					);
				}
				const [updated] = await db
					.update(pullRequestReviewComments)
					.set({
						resolvedAt: data.resolved ? new Date() : null,
						resolvedById: data.resolved ? currentUser.id : null,
						updatedAt: new Date(),
					})
					.where(eq(pullRequestReviewComments.id, comment.id))
					.returning();
				if (!updated) throw notFound();
				return updated;
			},
		);
	});
