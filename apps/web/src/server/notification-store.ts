/**
 * In-app notifications with GitHub's semantics: one notification thread per
 * user and issue/PR, a `reason`, unread/read, and thread subscriptions that
 * decide who hears about new activity. Plain server-only module, called by
 * the issue, pull request, comment, assignee and review writes after their
 * own (so the REST API's writes notify too) and by notifications.ts.
 *
 * Recording is a fixed number of queries however many people are involved:
 * resolve mentions, keep the involved users who can read, upsert their
 * subscriptions, read the subscribers who can read, upsert notifications.
 * The actor is never notified. Read access is repo-access.ts's rule
 * (`canReadRepositoryCondition`), checked again when the inbox is read so
 * losing access hides old notifications.
 */
import {
	and,
	count,
	desc,
	eq,
	gte,
	inArray,
	lt,
	lte,
	ne,
	sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "#/db";
import {
	issues,
	notifications,
	repositories,
	threadSubscriptions,
} from "#/db/app-schema";
import { user } from "#/db/schema";
import { getMentionedUsernames } from "#/lib/issue-references";
import {
	type NotificationItem,
	type NotificationReason,
	PARTICIPATING_REASONS,
	type ThreadSubscriptionState,
} from "#/lib/notifications";
import { canReadRepositoryCondition } from "./repo-access";
import { ignoringUsers, watcherIds } from "./watch-store";

export interface ThreadActivity {
	thread: { id: number; repoId: number };
	actorId: string;
	/** What subscribes the actor (`author`, `comment`, `state_change`). */
	actorReason?: NotificationReason;
	/** New text (a body or comment) whose `@mentions` notify. */
	text?: string | null;
	/** The text before an edit: mentions already there aren't notified again. */
	previousText?: string | null;
	/** Users addressed directly (assignees, requested reviewers). */
	direct?: { userIds: string[]; reason: NotificationReason };
	/** Whether the thread's subscribers hear about it (default true). */
	notifySubscribers?: boolean;
	/** A just-opened issue or pull request: the repository's watchers hear about it. */
	newThread?: boolean;
}

/** What still reaches someone who ignores the repository. */
const DIRECT_REASONS: ReadonlySet<NotificationReason> = new Set([
	"mention",
	"assign",
	"review_requested",
]);

/** Ranks a recipient's reasons: the most direct one names the notification. */
const REASON_RANK: Record<NotificationReason, number> = {
	review_requested: 0,
	assign: 1,
	mention: 2,
	author: 3,
	comment: 4,
	state_change: 5,
	manual: 6,
	subscribed: 7,
};

/**
 * Subscribe the people `activity` involves and notify everyone who should
 * hear about it, except the actor and anyone who can't read the repository.
 *
 * Callers run this after their own write has committed rather than in one
 * transaction with it, like `recordTimelineEvent` and `recordActivity`: the
 * write is what the user asked for (and a merge's git side is already done,
 * so it can't roll back with the row). A failure here is never swallowed; it
 * surfaces as an error for a write that did land.
 */
export async function recordThreadActivity(
	activity: ThreadActivity,
): Promise<void> {
	const { thread, actorId } = activity;
	const repoId = sql`${thread.repoId}`;
	const reasons = new Map<string, NotificationReason>();
	const offer = (userId: string, reason: NotificationReason) => {
		if (userId === actorId) return;
		const current = reasons.get(userId);
		if (!current || REASON_RANK[reason] < REASON_RANK[current]) {
			reasons.set(userId, reason);
		}
	};

	const before = new Set(getMentionedUsernames(activity.previousText ?? null));
	const mentioned = getMentionedUsernames(activity.text ?? null).filter(
		(name) => !before.has(name),
	);
	const mentionedIds =
		mentioned.length === 0
			? []
			: (
					await db
						.select({ id: user.id })
						.from(user)
						.where(inArray(sql`lower(${user.username})`, mentioned))
				).map((row) => row.id);

	const involved: { userId: string; reason: NotificationReason }[] = [
		...(activity.actorReason
			? [{ userId: actorId, reason: activity.actorReason }]
			: []),
		...mentionedIds
			.filter((id) => id !== actorId)
			.map((userId) => ({ userId, reason: "mention" as const })),
		...(activity.direct?.userIds ?? [])
			.filter((id) => id !== actorId)
			.map((userId) => ({
				userId,
				reason: activity.direct?.reason ?? "manual",
			})),
	];
	// Only readers are subscribed or notified directly: a non-reader mentioned
	// or assigned gets no row, so granting access later doesn't start a feed.
	const readers =
		involved.length === 0
			? new Set<string>()
			: new Set(
					(
						await db
							.select({ id: user.id })
							.from(user)
							.where(
								and(
									inArray(user.id, [...new Set(involved.map((i) => i.userId))]),
									canReadRepositoryCondition(user.id, repoId),
								),
							)
					).map((row) => row.id),
				);
	// Watchers (all activity) hear about a new thread and follow it from then on.
	const watching = new Set(
		activity.newThread
			? (await watcherIds(thread.repoId)).filter((id) => id !== actorId)
			: [],
	);
	const newSubscriptions = [
		...involved.filter((i) => readers.has(i.userId)),
		...[...watching]
			.filter((userId) => !involved.some((i) => i.userId === userId))
			.map((userId) => ({ userId, reason: "subscribed" as const })),
	];
	if (newSubscriptions.length > 0) {
		// An existing row wins: it keeps its first reason and an explicit
		// unsubscribe stays one.
		await db
			.insert(threadSubscriptions)
			.values(newSubscriptions.map((s) => ({ ...s, issueId: thread.id })))
			.onConflictDoNothing();
	}

	if (activity.notifySubscribers !== false) {
		const subscribers = await db
			.select({
				userId: threadSubscriptions.userId,
				reason: threadSubscriptions.reason,
			})
			.from(threadSubscriptions)
			.where(
				and(
					eq(threadSubscriptions.issueId, thread.id),
					eq(threadSubscriptions.subscribed, true),
					ne(threadSubscriptions.userId, actorId),
					// A subscriber who has since lost access hears nothing.
					canReadRepositoryCondition(threadSubscriptions.userId, repoId),
				),
			);
		for (const s of subscribers) offer(s.userId, s.reason);
	}
	for (const s of newSubscriptions) offer(s.userId, s.reason);
	// Someone who ignores the repository hears only what is addressed to them.
	const ignoring = await ignoringUsers(thread.repoId, [...reasons.keys()]);
	for (const [userId, reason] of reasons) {
		if (ignoring.has(userId) && !DIRECT_REASONS.has(reason)) {
			reasons.delete(userId);
		}
	}
	if (reasons.size === 0) return;

	const now = new Date();
	await db
		.insert(notifications)
		.values(
			[...reasons].map(([userId, reason]) => ({
				userId,
				repoId: thread.repoId,
				issueId: thread.id,
				reason,
				unread: true,
				updatedAt: now,
			})),
		)
		.onConflictDoUpdate({
			target: [notifications.userId, notifications.issueId],
			set: {
				reason: sql`excluded.reason`,
				unread: true,
				updatedAt: now,
			},
		});
}

const owner = alias(user, "notification_repo_owner");

/** Which of a user's notifications a listing covers (GitHub's list parameters). */
export interface NotificationFilter {
	/** Read ones too (default: unread only). */
	all?: boolean;
	/** Only threads the user is directly involved in. */
	participating?: boolean;
	/** Updated at or after. */
	since?: Date;
	/** Updated before. */
	before?: Date;
	repoId?: number;
	id?: number;
}

function notificationWhere(userId: string, filter: NotificationFilter) {
	return and(
		eq(notifications.userId, userId),
		filter.all ? undefined : eq(notifications.unread, true),
		filter.participating
			? inArray(notifications.reason, [...PARTICIPATING_REASONS])
			: undefined,
		filter.since ? gte(notifications.updatedAt, filter.since) : undefined,
		filter.before ? lt(notifications.updatedAt, filter.before) : undefined,
		filter.repoId === undefined
			? undefined
			: eq(notifications.repoId, filter.repoId),
		filter.id === undefined ? undefined : eq(notifications.id, filter.id),
		canReadRepositoryCondition(sql`${userId}`, notifications.repoId),
	);
}

/** The user's notifications, newest first, only for repositories they can still read. */
export async function listNotificationsForUser(
	userId: string,
	options: NotificationFilter & { limit: number; offset: number },
): Promise<NotificationItem[]> {
	const rows = await db
		.select({
			id: notifications.id,
			reason: notifications.reason,
			unread: notifications.unread,
			updatedAt: notifications.updatedAt,
			lastReadAt: notifications.lastReadAt,
			issueId: notifications.issueId,
			repoId: notifications.repoId,
			number: issues.number,
			title: issues.title,
			state: issues.status,
			isPullRequest: issues.isPullRequest,
			repoName: repositories.name,
			ownerName: owner.username,
		})
		.from(notifications)
		.innerJoin(issues, eq(issues.id, notifications.issueId))
		.innerJoin(repositories, eq(repositories.id, notifications.repoId))
		.innerJoin(owner, eq(owner.id, repositories.ownerId))
		.where(notificationWhere(userId, options))
		.orderBy(desc(notifications.updatedAt), desc(notifications.id))
		.limit(options.limit)
		.offset(options.offset);
	return rows.map((row) => ({
		id: row.id,
		reason: row.reason,
		unread: row.unread,
		updatedAt: row.updatedAt,
		lastReadAt: row.lastReadAt,
		issueId: row.issueId,
		repoId: row.repoId,
		subject: {
			type: row.isPullRequest ? "PullRequest" : "Issue",
			number: row.number,
			title: row.title,
			state: row.state,
		},
		repository: { owner: row.ownerName, name: row.repoName },
	}));
}

export async function countNotificationsForUser(
	userId: string,
	filter: NotificationFilter,
): Promise<number> {
	const [row] = await db
		.select({ total: count() })
		.from(notifications)
		.where(notificationWhere(userId, filter));
	return row?.total ?? 0;
}

/** One of the user's notifications (read or not), or null if it isn't theirs or readable. */
export async function getNotificationForUser(
	userId: string,
	id: number,
): Promise<NotificationItem | null> {
	const [row] = await listNotificationsForUser(userId, {
		all: true,
		limit: 1,
		offset: 0,
		id,
	});
	return row ?? null;
}

/**
 * Mark the user's unread notifications updated at or before `lastReadAt`
 * read (GitHub's "mark as read", optionally for one repository).
 */
export async function markNotificationsReadBefore(
	userId: string,
	lastReadAt: Date,
	repoId?: number,
): Promise<void> {
	await db
		.update(notifications)
		.set({ unread: false, lastReadAt: new Date() })
		.where(
			and(
				eq(notifications.userId, userId),
				eq(notifications.unread, true),
				lte(notifications.updatedAt, lastReadAt),
				repoId === undefined ? undefined : eq(notifications.repoId, repoId),
			),
		);
}

/**
 * GitHub's "mark as done": the thread leaves the inbox until new activity
 * brings it back (recordThreadActivity re-creates the row).
 */
export async function markNotificationDone(
	userId: string,
	id: number,
): Promise<void> {
	await db
		.delete(notifications)
		.where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
}

export async function countUnreadNotifications(
	userId: string,
): Promise<number> {
	const [row] = await db
		.select({ total: count() })
		.from(notifications)
		.where(
			and(
				eq(notifications.userId, userId),
				eq(notifications.unread, true),
				canReadRepositoryCondition(sql`${userId}`, notifications.repoId),
			),
		);
	return row?.total ?? 0;
}

/** Mark one of the user's notifications read; false when it isn't theirs. */
export async function markNotificationRead(
	userId: string,
	id: number,
): Promise<boolean> {
	const updated = await db
		.update(notifications)
		.set({ unread: false, lastReadAt: new Date() })
		.where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
		.returning({ id: notifications.id });
	return updated.length > 0;
}

/** Mark the user's notification for thread `issueId` read (viewing it); true when one was unread. */
export async function markThreadNotificationRead(
	userId: string,
	issueId: number,
): Promise<boolean> {
	const updated = await db
		.update(notifications)
		.set({ unread: false, lastReadAt: new Date() })
		.where(
			and(
				eq(notifications.userId, userId),
				eq(notifications.issueId, issueId),
				eq(notifications.unread, true),
			),
		)
		.returning({ id: notifications.id });
	return updated.length > 0;
}

/** Mark every unread notification read (GitHub's "mark all as read"). */
export async function markAllNotificationsRead(userId: string): Promise<void> {
	await db
		.update(notifications)
		.set({ unread: false, lastReadAt: new Date() })
		.where(
			and(eq(notifications.userId, userId), eq(notifications.unread, true)),
		);
}

export async function getThreadSubscriptionState(
	userId: string,
	issueId: number,
): Promise<ThreadSubscriptionState> {
	const [row] = await db
		.select({
			subscribed: threadSubscriptions.subscribed,
			reason: threadSubscriptions.reason,
			createdAt: threadSubscriptions.createdAt,
		})
		.from(threadSubscriptions)
		.where(
			and(
				eq(threadSubscriptions.issueId, issueId),
				eq(threadSubscriptions.userId, userId),
			),
		)
		.limit(1);
	return row ?? { subscribed: false, reason: null, createdAt: null };
}

/**
 * Forget the user's subscription to a thread (GitHub's "delete a thread
 * subscription"): unlike an unsubscribe, it isn't remembered, so being
 * involved again (a comment, a mention, an assignment) resubscribes.
 */
export async function deleteThreadSubscriptionRow(
	userId: string,
	issueId: number,
): Promise<void> {
	await db
		.delete(threadSubscriptions)
		.where(
			and(
				eq(threadSubscriptions.issueId, issueId),
				eq(threadSubscriptions.userId, userId),
			),
		);
}

/**
 * Subscribe (reason `manual` for a new subscription) or unsubscribe; an
 * unsubscribe is remembered so later activity doesn't resubscribe.
 */
export async function setThreadSubscription(
	userId: string,
	issueId: number,
	subscribed: boolean,
): Promise<ThreadSubscriptionState & { createdAt: Date }> {
	const [row] = await db
		.insert(threadSubscriptions)
		.values({ issueId, userId, subscribed, reason: "manual" })
		.onConflictDoUpdate({
			target: [threadSubscriptions.issueId, threadSubscriptions.userId],
			set: { subscribed, updatedAt: new Date() },
		})
		.returning({
			subscribed: threadSubscriptions.subscribed,
			reason: threadSubscriptions.reason,
			createdAt: threadSubscriptions.createdAt,
		});
	if (!row) throw new Error("Subscription update returned no row");
	return row;
}
