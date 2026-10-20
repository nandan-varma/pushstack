/**
 * Pull request reviews and review comments (src/lib/review-types.ts). Plain
 * server-only helpers, called from reviews.ts's server functions and from
 * pull-requests.ts's detail read; never a server-function file.
 */
import { db } from "#/db";
import { anchorKey, collectDiffAnchors } from "#/lib/diff";
import type {
	PullRequestReviewSummary,
	ReviewCommentView,
	ReviewSide,
	ReviewState,
	ReviewThread,
} from "#/lib/review-types";
import { getBranchDiff, getBranches } from "./git-read";
import { ownerKeyOf } from "./git-storage-naming";
import type { RepositoryWithOwner } from "./repo-access";
import { publicUserFields } from "./repository-lookup";
import type { PullRequest } from "./thread-store";

/** A review comment with its author and the state of its review. */
type ReviewCommentRow = Awaited<ReturnType<typeof listReviewComments>>[number];

/** Every review comment on a pull request, oldest first, with author + review. */
export async function listReviewComments(pullRequestId: number) {
	return db.query.pullRequestReviewComments.findMany({
		where: { pullRequestId },
		with: {
			author: publicUserFields,
			review: { columns: { state: true, authorId: true } },
		},
		orderBy: { createdAt: "asc", id: "asc" },
	});
}

/** A review comment row as the UI and API see it. */
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

/** The viewer's unsubmitted review, if they have one. */
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
		// Ordered oldest first, so the last write is the newest review.
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

/** The head branch's tip commit, or null when the branch is gone. */
export async function headShaFor(
	repo: RepositoryWithOwner,
	sourceBranch: string,
): Promise<string | null> {
	const tips = await getBranches(ownerKeyOf(repo), repo.name);
	return tips.find((branch) => branch.name === sourceBranch)?.commit ?? null;
}
