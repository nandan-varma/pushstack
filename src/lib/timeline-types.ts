/**
 * Issue and pull request timeline events, shared by server and client.
 *
 * Names and shapes follow GitHub's issue events (`closed`, `reopened`,
 * `merged`, `cross-referenced`, `head_ref_deleted`) so a GitHub import or a
 * GitHub-compatible API can map them one to one. Issues and pull requests
 * share one `#N` sequence per repository, so an event targets `(repo, number)`
 * whichever kind the thread is.
 */

/** A label as it was when an event happened (the label may be edited later). */
export interface LabelSnapshot {
	name: string;
	color: string;
}

/** The issue or pull request an event points at (same repository). */
export interface ThreadRef {
	kind: "issue" | "pull_request";
	number: number;
	title: string;
}

/** The person an `assigned`/`unassigned` event is about. */
export interface TimelineUser {
	username: string;
	name: string;
}

export type TimelineEvent =
	/**
	 * Closed by hand, by merging the pull request `closer`, or by the pushed
	 * commit `commitSha` ("Fixes #N" on the default branch).
	 */
	| { event: "closed"; closer?: ThreadRef; commitSha?: string }
	/** A pushed commit's message mentioned this thread (`#N`). */
	| { event: "referenced"; commitSha: string; message: string }
	| { event: "reopened" }
	| { event: "merged"; commitSha: string; base: string }
	/** Another thread mentioned this one (`#N` in its body or a comment). */
	| { event: "cross-referenced"; source: ThreadRef }
	| { event: "head_ref_deleted"; branch: string }
	/** The title changed (GitHub's `renamed` issue event). */
	| { event: "renamed"; from: string; to: string }
	/** A label was applied or removed; the name and color are a snapshot. */
	| { event: "labeled"; label: LabelSnapshot }
	| { event: "unlabeled"; label: LabelSnapshot }
	/** Someone was assigned to / unassigned from the thread. */
	| { event: "assigned"; assignee: TimelineUser }
	| { event: "unassigned"; assignee: TimelineUser };

export type TimelineEventType = TimelineEvent["event"];

/** An event as the timeline API returns it. */
export type TimelineEntry = TimelineEvent & {
	id: number;
	createdAt: Date;
	actor: { id: string; username: string; name: string; image: string | null };
};
