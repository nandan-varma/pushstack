/**
 * Issue and pull request timeline events, shared by server and client.
 *
 * Names and shapes follow GitHub's issue events (`closed`, `reopened`,
 * `merged`, `cross-referenced`, `head_ref_deleted`) so a GitHub import or a
 * GitHub-compatible API can map them one to one. Issues and pull requests
 * share one `#N` sequence per repository, so an event targets `(repo, number)`
 * whichever kind the thread is.
 */

/** The issue or pull request an event points at (same repository). */
export interface ThreadRef {
	kind: "issue" | "pull_request";
	number: number;
	title: string;
}

export type TimelineEvent =
	/** Closed by hand, or — with `closer` — by merging that pull request. */
	| { event: "closed"; closer?: ThreadRef }
	| { event: "reopened" }
	| { event: "merged"; commitSha: string; base: string }
	/** Another thread mentioned this one (`#N` in its body or a comment). */
	| { event: "cross-referenced"; source: ThreadRef }
	| { event: "head_ref_deleted"; branch: string };

export type TimelineEventType = TimelineEvent["event"];

/** An event as the timeline API returns it. */
export type TimelineEntry = TimelineEvent & {
	id: number;
	createdAt: Date;
	actor: { id: string; username: string; name: string; image: string | null };
};
