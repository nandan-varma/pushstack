/**
 * Pull request reviews, shared by server and client.
 *
 * GitHub's model: a reviewer opens a *pending* review, attaches line comments
 * anchored to the diff, then submits it as a Comment, an Approval or a
 * Request-changes. A thread is a root comment plus its replies and can be
 * resolved; the states map one to one onto GitHub's REST enums
 * (`PENDING`, `COMMENTED`, `APPROVED`, `CHANGES_REQUESTED`).
 */

/** A review's state; `pending` is the unsubmitted draft only its author sees. */
export type ReviewState =
	| "pending"
	| "commented"
	| "approved"
	| "changes_requested";

export type ReviewedState = Exclude<ReviewState, "pending">;

export type ReviewSide = "LEFT" | "RIGHT";

export interface ReviewAuthor {
	id: string;
	username: string;
	name: string;
	image: string | null;
}

export interface ReviewCommentView {
	id: number;
	body: string;
	path: string;
	side: ReviewSide;
	line: number;
	/** The head tip the anchor was computed against. */
	commitSha: string | null;
	/** The comment this replies to; null for a thread root. */
	inReplyToId: number | null;
	createdAt: Date;
	author: ReviewAuthor;
}

/** A thread: the root comment, its replies, and whether it's resolved. */
export interface ReviewThread {
	/** The root comment's id (replies point at it). */
	id: number;
	path: string;
	side: ReviewSide;
	line: number;
	resolved: boolean;
	/** Root first, then replies oldest first. */
	comments: ReviewCommentView[];
}

export interface PullRequestReviewSummary {
	approved: number;
	changesRequested: number;
	commented: number;
	state: Exclude<ReviewState, "pending"> | null;
	/** A changes-requested review is outstanding (admins may still merge). */
	blocksMerge: boolean;
}
