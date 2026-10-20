/**
 * In-app notifications with GitHub's semantics: one notification thread per
 * user and issue/PR, a `reason`, unread/read, and thread subscriptions that
 * decide who hears about new activity. Plain server-only module, called by
 * the issue, pull request, comment, assignee and review writes after their
 * own (so the REST API's writes notify too) and by notifications.ts.
 *
 * Recording is a fixed number of queries however many people are involved:
 * resolve mentions, upsert subscriptions, read subscribers, keep the readers,
 * upsert notifications. The actor is never notified.
 */
import {
	and,
	count,
	desc,
	eq,
	exists,
	inArray,
	ne,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "#/db";
import {
	issues,
	notifications,
	repositories,
	repositoryCollaborators,
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
}

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

/** `userColumn` may read the repository in `repoColumn` (correlated SQL). */
function canReadCondition(userColumn: SQL | typeof user.id, repoId: SQL) {
	return or(
		exists(
			db
				.select({ one: sql`1` })
				.from(repositories)
				.where(
					and(
						eq(repositories.id, repoId),
						or(
							eq(repositories.visibility, "public"),
							eq(repositories.ownerId, userColumn),
						),
					),
				),
		),
		exists(
			db
				.select({ one: sql`1` })
				.from(repositoryCollaborators)
				.where(
					and(
						eq(repositoryCollaborators.repoId, repoId),
						eq(repositoryCollaborators.userId, userColumn),
					),
				),
		),
	);
}

/**
 * Subscribe the people `activity` involves and notify everyone who should
 * hear about it, except the actor and anyone who can't read the repository.
 */
export async function recordThreadActivity(
	activity: ThreadActivity,
): Promise<void> {
	const { thread, actorId } = activity;
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

	const newSubscriptions = [
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
				),
			);
		for (const s of subscribers) offer(s.userId, s.reason);
	}
	for (const id of mentionedIds) offer(id, "mention");
	for (const id of activity.direct?.userIds ?? []) {
		offer(id, activity.direct?.reason ?? "manual");
	}
	if (reasons.size === 0) return;

	const readers = await db
		.select({ id: user.id })
		.from(user)
		.where(
			and(
				inArray(user.id, [...reasons.keys()]),
				canReadCondition(user.id, sql`${thread.repoId}`),
			),
		);
	if (readers.length === 0) return;

	const now = new Date();
	await db
		.insert(notifications)
		.values(
			readers.map(({ id }) => ({
				userId: id,
				repoId: thread.repoId,
				issueId: thread.id,
				reason: reasons.get(id) ?? "subscribed",
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

/** The user's notifications, newest first, only for repositories they can still read. */
export async function listNotificationsForUser(
	userId: string,
	options: {
		all?: boolean;
		participating?: boolean;
		limit: number;
		offset: number;
	},
): Promise<NotificationItem[]> {
	const rows = await db
		.select({
			id: notifications.id,
			reason: notifications.reason,
			unread: notifications.unread,
			updatedAt: notifications.updatedAt,
			lastReadAt: notifications.lastReadAt,
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
		.where(
			and(
				eq(notifications.userId, userId),
				options.all ? undefined : eq(notifications.unread, true),
				options.participating
					? inArray(notifications.reason, [...PARTICIPATING_REASONS])
					: undefined,
				canReadCondition(sql`${userId}`, sql`${notifications.repoId}`),
			),
		)
		.orderBy(desc(notifications.updatedAt), desc(notifications.id))
		.limit(options.limit)
		.offset(options.offset);
	return rows.map((row) => ({
		id: row.id,
		reason: row.reason,
		unread: row.unread,
		updatedAt: row.updatedAt,
		lastReadAt: row.lastReadAt,
		subject: {
			type: row.isPullRequest ? "PullRequest" : "Issue",
			number: row.number,
			title: row.title,
			state: row.state,
		},
		repository: { owner: row.ownerName, name: row.repoName },
	}));
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
				canReadCondition(sql`${userId}`, sql`${notifications.repoId}`),
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
		})
		.from(threadSubscriptions)
		.where(
			and(
				eq(threadSubscriptions.issueId, issueId),
				eq(threadSubscriptions.userId, userId),
			),
		)
		.limit(1);
	return row ?? { subscribed: false, reason: null };
}

/**
 * Subscribe (reason `manual` for a new subscription) or unsubscribe; an
 * unsubscribe is remembered so later activity doesn't resubscribe.
 */
export async function setThreadSubscription(
	userId: string,
	issueId: number,
	subscribed: boolean,
): Promise<ThreadSubscriptionState> {
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
		});
	if (!row) throw new Error("Subscription update returned no row");
	return row;
}
