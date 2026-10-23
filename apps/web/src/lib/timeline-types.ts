/**
 * Issue and pull request timeline events, shared by server and client.
 *
 * Names and shapes follow GitHub's issue events (`closed`, `reopened`,
 * `merged`, `cross-referenced`, `head_ref_deleted`) so a GitHub import or a
 * GitHub-compatible API can map them one to one. Issues and pull requests
 * share one `#N` sequence per repository, so an event targets `(repo, number)`
 * whichever kind the thread is.
 */

import type { ReviewedState } from "./review-types";

/** A label as it was when an event happened (the label may be edited later). */
export interface LabelSnapshot {
	name: string;
	color: string;
}

export type IssueStateReason = "completed" | "not_planned" | "reopened";

export interface ThreadRef {
	kind: "issue" | "pull_request";
	number: number;
	title: string;
}

export interface TimelineUser {
	username: string;
	name: string;
}

export type TimelineEvent =
	/**
	 * Closed by hand, by merging the pull request `closer`, or by the pushed
	 * commit `commitSha` ("Fixes #N" on the default branch).
	 */
	| {
			event: "closed";
			closer?: ThreadRef;
			commitSha?: string;
			/** Why it was closed; absent on older events (read as `completed`). */
			stateReason?: "completed" | "not_planned";
	  }
	| { event: "referenced"; commitSha: string; message: string }
	| { event: "reopened" }
	| { event: "merged"; commitSha: string; base: string }
	| { event: "cross-referenced"; source: ThreadRef }
	| { event: "head_ref_deleted"; branch: string }
	| { event: "renamed"; from: string; to: string }
	/** A draft pull request was marked ready, or a ready one converted to a draft. */
	| { event: "ready_for_review" }
	| { event: "convert_to_draft" }
	/** A label was applied or removed; the name and color are a snapshot. */
	| { event: "labeled"; label: LabelSnapshot }
	| { event: "unlabeled"; label: LabelSnapshot }
	| { event: "assigned"; assignee: TimelineUser }
	| { event: "unassigned"; assignee: TimelineUser }
	/** Review requested from (or withdrawn for) a user; the actor is the requester. */
	| { event: "review_requested"; reviewer: TimelineUser }
	| { event: "review_request_removed"; reviewer: TimelineUser }
	| { event: "reviewed"; state: ReviewedState; reviewId: number };

export type TimelineEventType = TimelineEvent["event"];

export type TimelineEntry = TimelineEvent & {
	id: number;
	createdAt: Date;
	actor: {
		id: string;
		apiId: number;
		username: string;
		name: string;
		image: string | null;
	};
};
