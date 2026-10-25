import { and, count, eq } from "drizzle-orm";
import { db } from "#/db";
import { pullRequestReviewComments, pullRequestReviews } from "#/db/app-schema";
import { anchorKey, collectDiffAnchors } from "#/lib/diff";
import { MAX_REVIEW_COMMENTS_PER_PULL_REQUEST } from "#/lib/limits";
import type {
	PullRequestReviewSummary,
	ReviewCommentView,
	ReviewedState,
	ReviewSide,
	ReviewState,
	ReviewThread,
} from "#/lib/review-types";
import { getBranchDiff, getBranches } from "./git-read";
import { ownerKeyOf } from "./git-storage-naming";
import { recordThreadActivity } from "./notification-store";
import type { RepositoryWithOwner } from "./repo-access";
import { publicUserFields } from "./repository-lookup";
import { clearReviewRequest } from "./review-request-store";
import type { PullRequest } from "./thread-store";
import { recordTimelineEvent } from "./timeline-store";

type PendingReview = NonNullable<Awaited<ReturnType<typeof pendingReviewFor>>>;

type ReviewCommentRow = Awaited<ReturnType<typeof listReviewComments>>[number];

/** Refuse a new review comment once the pull request holds the cap. */
export async function assertReviewCommentCapacity(pullRequestId: number) {
	const [row] = await db
		.select({ total: count() })
		.from(pullRequestReviewComments)
		.where(eq(pullRequestReviewComments.pullRequestId, pullRequestId));
	if ((row?.total ?? 0) >= MAX_REVIEW_COMMENTS_PER_PULL_REQUEST) {
		throw new Error(
			`A pull request holds at most ${MAX_REVIEW_COMMENTS_PER_PULL_REQUEST} review comments`,
		);
	}
}

export async function listReviewComments(pullRequestId: number) {
	return db.query.pullRequestReviewComments.findMany({
		limit: MAX_REVIEW_COMMENTS_PER_PULL_REQUEST,
		where: { pullRequestId },
		with: {
			author: publicUserFields,
			review: { columns: { state: true, authorId: true } },
		},
		orderBy: { createdAt: "asc", id: "asc" },
	});
}

/** Submitted reviews by id, with their authors (for the REST timeline). */
export function submittedReviewsByIds(pullRequestId: number, ids: number[]) {
	if (ids.length === 0) return Promise.resolve([]);
	return db.query.pullRequestReviews.findMany({
		where: { pullRequestId, id: { in: ids }, state: { ne: "pending" } },
		with: { author: publicUserFields },
	});
}

export type SubmittedReviewRow = Awaited<
	ReturnType<typeof submittedReviewsByIds>
>[number];

export function toView(row: ReviewCommentRow): ReviewCommentView {
	return {
		id: row.id,
		body: row.body,
		path: row.path,
		side: row.side,
		line: row.line,
		commitSha: row.commitSha,
		inReplyToId: row.inReplyToId,
		createdAt: row.createdAt,
		author: row.author,
	};
}

/**
 * Group flat comments into threads: a root comment (`inReplyToId` null) plus
 * its replies, root first. A reply may point at another reply, so the root is
 * found by walking the chain.
 */
export function buildReviewThreads(rows: ReviewCommentRow[]): ReviewThread[] {
	const byId = new Map(rows.map((row) => [row.id, row]));
	const rootOf = (row: ReviewCommentRow): ReviewCommentRow => {
		let current = row;
		const seen = new Set<number>([row.id]);
		while (current.inReplyToId !== null) {
			const parent = byId.get(current.inReplyToId);
			if (!parent || seen.has(parent.id)) break;
			seen.add(parent.id);
			current = parent;
		}
		return current;
	};

	const threads = new Map<number, ReviewThread>();
	for (const row of rows) {
		if (row.inReplyToId !== null) continue;
		threads.set(row.id, {
			id: row.id,
			path: row.path,
			side: row.side,
			line: row.line,
			resolved: row.resolvedAt !== null,
			comments: [],
		});
	}
	for (const row of rows) {
		const thread = threads.get(rootOf(row).id);
		if (thread) thread.comments.push(toView(row));
	}
	return [...threads.values()].sort(
		(a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.id - b.id,
	);
}

export function pendingReviewFor(pullRequestId: number, authorId: string) {
	return db.query.pullRequestReviews.findFirst({
		where: { pullRequestId, authorId, state: "pending" },
	});
}

/**
 * What the PR header shows: each reviewer's latest submitted review decides
 * their contribution; a `changes_requested` blocks the merge.
 */
export async function reviewSummaryFor(
	pullRequestId: number,
): Promise<PullRequestReviewSummary> {
	const rows = await db.query.pullRequestReviews.findMany({
		columns: { authorId: true, state: true },
		where: { pullRequestId },
		orderBy: { createdAt: "asc", id: "asc" },
	});
	const latest = new Map<string, ReviewState>();
	for (const row of rows) {
		if (row.state === "pending") continue;
		latest.set(row.authorId, row.state);
	}

	let approved = 0;
	let changesRequested = 0;
	let commented = 0;
	for (const state of latest.values()) {
		if (state === "approved") approved += 1;
		else if (state === "changes_requested") changesRequested += 1;
		else commented += 1;
	}
	return {
		approved,
		changesRequested,
		commented,
		state:
			changesRequested > 0
				? "changes_requested"
				: approved > 0
					? "approved"
					: commented > 0
						? "commented"
						: null,
		blocksMerge: changesRequested > 0,
	};
}

/**
 * Reject an anchor that isn't on the pull request's current diff, and return
 * the head tip it was computed against. A path, side or line outside the diff
 * would let a caller attach a comment to a file the PR never touched.
 */
export async function assertReviewAnchor(
	repo: RepositoryWithOwner,
	pullRequest: Pick<PullRequest, "sourceBranch" | "targetBranch">,
	anchor: { path: string; side: ReviewSide; line: number },
): Promise<string> {
	const diff = await getBranchDiff(
		ownerKeyOf(repo),
		repo.name,
		pullRequest.targetBranch,
		pullRequest.sourceBranch,
	);
	if (!collectDiffAnchors(diff.files).has(anchorKey(anchor))) {
		throw new Error("That line isn't part of this pull request's diff");
	}
	return diff.newRef;
}

export async function headShaFor(
	repo: RepositoryWithOwner,
	sourceBranch: string,
): Promise<string | null> {
	const tips = await getBranches(ownerKeyOf(repo), repo.name);
	return tips.find((branch) => branch.name === sourceBranch)?.commit ?? null;
}

/**
 * The reviewer's pending review, created on first use. The partial unique index
 * on `(repo, pull request, author) WHERE state = 'pending'` makes the
 * concurrent double-click safe: the loser of the insert re-reads the winner's.
 */
export async function findOrCreatePendingReview(
	pr: PullRequest,
	authorId: string,
) {
	const existing = await pendingReviewFor(pr.id, authorId);
	if (existing) return existing;
	const [created] = await db
		.insert(pullRequestReviews)
		.values({ repoId: pr.repoId, pullRequestId: pr.id, authorId })
		.onConflictDoNothing()
		.returning();
	if (created) return created;
	const raced = await pendingReviewFor(pr.id, authorId);
	if (!raced) throw new Error("Could not open a pending review");
	return raced;
}

/**
 * Submits a pending review as `state` and records it: the timeline event, the
 * cleared review request and thread activity. The caller checked the
 * reviewer's access.
 */
export async function submitPendingReview(
	repo: RepositoryWithOwner,
	pr: PullRequest,
	review: PendingReview,
	state: ReviewedState,
	body: string | null,
) {
	const [submitted] = await db
		.update(pullRequestReviews)
		.set({
			state,
			body,
			commitSha: review.commitSha ?? (await headShaFor(repo, pr.sourceBranch)),
			submittedAt: new Date(),
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(pullRequestReviews.id, review.id),
				eq(pullRequestReviews.state, "pending"),
			),
		)
		.returning();
	if (!submitted) throw new Error("That review was already submitted");
	await clearReviewRequest(pr.id, review.authorId);
	await recordTimelineEvent(pr.id, review.authorId, {
		event: "reviewed",
		state,
		reviewId: submitted.id,
	});
	await recordThreadActivity({
		thread: pr,
		actorId: review.authorId,
		actorReason: "comment",
		text: submitted.body,
	});
	return submitted;
}
