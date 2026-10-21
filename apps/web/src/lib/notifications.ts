/**
 * Notification types shared by the server and the inbox UI, named after
 * GitHub's notifications API (`reason`, `unread`, `subject.type`).
 */

/** GitHub's `reason` values this forge produces. */
const NOTIFICATION_REASONS = [
	"assign",
	"author",
	"comment",
	"manual",
	"mention",
	"review_requested",
	"state_change",
	"subscribed",
] as const;
export type NotificationReason = (typeof NOTIFICATION_REASONS)[number];

/**
 * Reasons GitHub's `participating=true` keeps: the user is directly involved
 * (wrote, commented, was mentioned, assigned or asked to review, or changed
 * the state) rather than merely watching.
 */
export const PARTICIPATING_REASONS = [
	"assign",
	"author",
	"comment",
	"mention",
	"review_requested",
	"state_change",
] as const satisfies readonly NotificationReason[];

export const NOTIFICATION_REASON_LABELS: Record<NotificationReason, string> = {
	assign: "Assigned",
	author: "Author",
	comment: "Commented",
	manual: "Subscribed",
	mention: "Mentioned",
	review_requested: "Review requested",
	state_change: "State change",
	subscribed: "Watching",
};

/** One inbox row: a thread the user is notified about. */
/** GitHub's `per_page` cap for the notifications list, and the inbox's page size. */
export const NOTIFICATIONS_PER_PAGE_MAX = 50;

export interface NotificationItem {
	id: number;
	reason: NotificationReason;
	unread: boolean;
	updatedAt: Date;
	lastReadAt: Date | null;
	issueId: number;
	repoId: number;
	subject: {
		type: "Issue" | "PullRequest";
		number: number;
		title: string;
		state: "open" | "closed";
	};
	repository: { owner: string; name: string };
}

/** The viewer's subscription to one thread (GitHub's thread subscription). */
export interface ThreadSubscriptionState {
	subscribed: boolean;
	/** Why: `author`, `comment`, `mention`, `manual`, …; null when never subscribed. */
	reason: NotificationReason | null;
	/** When the subscription row was created; null when there is none. */
	createdAt: Date | null;
}
