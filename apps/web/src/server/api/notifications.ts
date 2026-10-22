/**
 * GitHub's notifications API over notification-store.ts: the caller's inbox
 * (all of it or one repository's), single threads, marking read or done, and
 * thread subscriptions. A thread is the caller's notification row for one
 * issue or pull request; someone else's id, or one in a repository the caller
 * can no longer read, is a 404.
 */
import { inArray, max } from "drizzle-orm";
import { db } from "#/db";
import { comments } from "#/db/app-schema";
import { MAX_LIST_SKIP } from "#/lib/limits";
import type { NotificationItem } from "#/lib/notifications";
import {
	countNotificationsForUser,
	deleteThreadSubscriptionRow,
	getNotificationForUser,
	getThreadSubscriptionState,
	listNotificationsForUser,
	markNotificationDone,
	markNotificationRead,
	markNotificationsReadBefore,
	type NotificationFilter,
	setThreadSubscription,
} from "../notification-store";
import { publicUserFields } from "../repository-lookup";
import { type ApiContext, requireCaller } from "./auth";
import {
	apiUrl,
	isoTimestamp,
	json,
	linkHeader,
	noContent,
	notFoundError,
} from "./http";
import { pathParams, queryParams, requestBody } from "./input";
import { readableRepository } from "./repo-lookup";
import { openIssueCounts, starCounts } from "./repos";
import { repository, type Shape } from "./serializers";

const threadUrl = (id: number) => apiUrl(`/notifications/threads/${id}`);

/** Serialize a page of notifications: repositories, stars, open issue counts and latest comments in four queries. */
async function serializeNotifications(
	items: NotificationItem[],
): Promise<Shape<"notificationThread">[]> {
	if (items.length === 0) return [];
	const repoIds = [...new Set(items.map((item) => item.repoId))];
	const issueIds = [...new Set(items.map((item) => item.issueId))];
	const [repos, stars, openIssues, latest] = await Promise.all([
		db.query.repositories.findMany({
			where: { id: { in: repoIds } },
			with: { owner: publicUserFields },
		}),
		starCounts(repoIds),
		openIssueCounts(repoIds),
		db
			.select({ issueId: comments.issueId, id: max(comments.id) })
			.from(comments)
			.where(inArray(comments.issueId, issueIds))
			.groupBy(comments.issueId),
	]);
	const repoById = new Map(repos.map((repo) => [repo.id, repo]));
	const latestComment = new Map(latest.map((row) => [row.issueId, row.id]));
	return items.map((item) => {
		const repo = repoById.get(item.repoId);
		if (!repo) throw new Error(`Repository ${item.repoId} missing`);
		const fullName = `${repo.owner.username}/${repo.name}`;
		const subjectUrl = apiUrl(
			`/repos/${fullName}/${item.subject.type === "PullRequest" ? "pulls" : "issues"}/${item.subject.number}`,
		);
		const commentId = latestComment.get(item.issueId);
		return {
			id: String(item.id),
			repository: repository(repo, {
				stars: stars.get(repo.id) ?? 0,
				openIssues: openIssues.get(repo.id) ?? 0,
			}),
			subject: {
				title: item.subject.title,
				url: subjectUrl,
				latest_comment_url: commentId
					? apiUrl(`/repos/${fullName}/issues/comments/${commentId}`)
					: subjectUrl,
				type: item.subject.type,
			},
			reason: item.reason,
			unread: item.unread,
			updated_at: isoTimestamp(item.updatedAt),
			last_read_at: item.lastReadAt ? isoTimestamp(item.lastReadAt) : null,
			url: threadUrl(item.id),
			subscription_url: `${threadUrl(item.id)}/subscription`,
		};
	});
}

type ListOperation =
	| "activity/list-notifications-for-authenticated-user"
	| "activity/list-repo-notifications-for-authenticated-user";

async function listNotifications(
	ctx: ApiContext,
	id: ListOperation,
	repoId?: number,
) {
	const caller = requireCaller(ctx);
	const query = queryParams(ctx, id, "Notification");
	const perPage = query.per_page;
	const page = query.page ?? 1;
	const offset = (page - 1) * perPage;
	const params = { page, perPage, offset, reachable: offset <= MAX_LIST_SKIP };
	if (!params.reachable) return json([]);
	const filter: NotificationFilter = {
		all: query.all,
		participating: query.participating,
		since: query.since ? new Date(query.since) : undefined,
		before: query.before ? new Date(query.before) : undefined,
		repoId,
	};
	const [items, total] = await Promise.all([
		listNotificationsForUser(caller.userId, {
			...filter,
			limit: perPage,
			offset: params.offset,
		}),
		countNotificationsForUser(caller.userId, filter),
	]);
	return json(
		await serializeNotifications(items),
		200,
		linkHeader(ctx.url, params, total),
	);
}

/** `GET /notifications`: unread unless `all`; `participating`, `since`, `before`. */
export function listNotificationsForCaller(ctx: ApiContext) {
	return listNotifications(
		ctx,
		"activity/list-notifications-for-authenticated-user",
	);
}

/** `GET /repos/{owner}/{repo}/notifications`. */
export async function listRepoNotificationsForCaller(ctx: ApiContext) {
	requireCaller(ctx);
	const { repo } = await readableRepository(ctx);
	return listNotifications(
		ctx,
		"activity/list-repo-notifications-for-authenticated-user",
		repo.id,
	);
}

/** `PUT /notifications`: mark everything updated at or before `last_read_at` (default now) read. */
export async function markNotificationsRead(ctx: ApiContext) {
	const caller = requireCaller(ctx);
	const body = await requestBody(
		ctx,
		"activity/mark-notifications-as-read",
		"Notification",
		{ allowEmpty: true },
	);
	await markNotificationsReadBefore(
		caller.userId,
		body.last_read_at ? new Date(body.last_read_at) : new Date(),
	);
	return noContent(205);
}

/** `PUT /repos/{owner}/{repo}/notifications`. */
export async function markRepoNotificationsRead(ctx: ApiContext) {
	const caller = requireCaller(ctx);
	const { repo } = await readableRepository(ctx);
	const body = await requestBody(
		ctx,
		"activity/mark-repo-notifications-as-read",
		"Notification",
		{ allowEmpty: true },
	);
	await markNotificationsReadBefore(
		caller.userId,
		body.last_read_at ? new Date(body.last_read_at) : new Date(),
		repo.id,
	);
	return noContent(205);
}

type ThreadOperation =
	| "activity/get-thread"
	| "activity/mark-thread-as-read"
	| "activity/mark-thread-as-done"
	| "activity/get-thread-subscription-for-authenticated-user"
	| "activity/set-thread-subscription"
	| "activity/delete-thread-subscription";

/** The caller's notification thread named by the path, else 404. */
async function callerThread(ctx: ApiContext, id: ThreadOperation) {
	const caller = requireCaller(ctx);
	const { thread_id } = pathParams(ctx, id);
	const item = await getNotificationForUser(caller.userId, thread_id);
	if (!item) throw notFoundError();
	return { caller, item };
}

/** `GET /notifications/threads/{thread_id}`. */
export async function getThread(ctx: ApiContext) {
	const { item } = await callerThread(ctx, "activity/get-thread");
	const [thread] = await serializeNotifications([item]);
	return json(thread);
}

/** `PATCH /notifications/threads/{thread_id}`: mark read. */
export async function markThreadRead(ctx: ApiContext) {
	const { caller, item } = await callerThread(
		ctx,
		"activity/mark-thread-as-read",
	);
	await markNotificationRead(caller.userId, item.id);
	return noContent(205);
}

/** `DELETE /notifications/threads/{thread_id}`: mark done. */
export async function markThreadDone(ctx: ApiContext) {
	const { caller, item } = await callerThread(
		ctx,
		"activity/mark-thread-as-done",
	);
	await markNotificationDone(caller.userId, item.id);
	return noContent();
}

function subscriptionShape(
	threadId: number,
	state: { subscribed: boolean; createdAt: Date },
): Shape<"threadSubscription"> {
	return {
		subscribed: state.subscribed,
		ignored: !state.subscribed,
		reason: null,
		created_at: isoTimestamp(state.createdAt),
		url: `${threadUrl(threadId)}/subscription`,
		thread_url: threadUrl(threadId),
	};
}

/** `GET /notifications/threads/{thread_id}/subscription`: 404 when never subscribed. */
export async function getThreadSubscription(ctx: ApiContext) {
	const { caller, item } = await callerThread(
		ctx,
		"activity/get-thread-subscription-for-authenticated-user",
	);
	const state = await getThreadSubscriptionState(caller.userId, item.issueId);
	if (!state.createdAt) throw notFoundError();
	return json(
		subscriptionShape(item.id, {
			subscribed: state.subscribed,
			createdAt: state.createdAt,
		}),
	);
}

/** `PUT /notifications/threads/{thread_id}/subscription`: `ignored` mutes the thread. */
export async function putThreadSubscription(ctx: ApiContext) {
	const { caller, item } = await callerThread(
		ctx,
		"activity/set-thread-subscription",
	);
	const body = await requestBody(
		ctx,
		"activity/set-thread-subscription",
		"Subscription",
		{ allowEmpty: true },
	);
	const state = await setThreadSubscription(
		caller.userId,
		item.issueId,
		!body.ignored,
	);
	return json(subscriptionShape(item.id, state));
}

/**
 * `DELETE /notifications/threads/{thread_id}/subscription`: forget the
 * subscription — no notifications from watching until involved again.
 */
export async function deleteThreadSubscription(ctx: ApiContext) {
	const { caller, item } = await callerThread(
		ctx,
		"activity/delete-thread-subscription",
	);
	await deleteThreadSubscriptionRow(caller.userId, item.issueId);
	return noContent();
}
