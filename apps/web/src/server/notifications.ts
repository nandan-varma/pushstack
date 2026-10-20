import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { MAX_LIST_SKIP } from "#/lib/limits";
import {
	countUnreadNotifications,
	getThreadSubscriptionState,
	listNotificationsForUser,
	markAllNotificationsRead as markAllRead,
	markNotificationRead as markRead,
	setThreadSubscription as setSubscription,
} from "./notification-store";
import { getRepositoryAccess } from "./repo-access";
import { getCurrentUser, getCurrentUserOptional } from "./session";
import { findThreadByNumber } from "./thread-store";

/**
 * The current user's inbox: unread only unless `all`, and with
 * `participating` only threads they're directly involved in (GitHub's
 * `all` / `participating` parameters).
 */
export const getNotifications = createServerFn({ method: "GET" })
	.validator(
		z.object({
			all: z.boolean().default(false),
			participating: z.boolean().default(false),
			limit: z.number().int().min(1).max(50).default(50),
			skip: z.number().int().min(0).max(MAX_LIST_SKIP).default(0),
		}),
	)
	.handler(async ({ data }) => {
		const user = await getCurrentUser();
		return listNotificationsForUser(user.id, {
			all: data.all,
			participating: data.participating,
			limit: data.limit,
			offset: data.skip,
		});
	});

/** The header badge: 0 when signed out. */
export const getUnreadNotificationCount = createServerFn({
	method: "GET",
}).handler(async () => {
	const user = await getCurrentUserOptional();
	return user ? countUnreadNotifications(user.id) : 0;
});

export const markNotificationRead = createServerFn({ method: "POST" })
	.validator(z.object({ id: z.number().int().positive() }))
	.handler(async ({ data }) => {
		const user = await getCurrentUser();
		if (!(await markRead(user.id, data.id))) throw notFound();
		return { success: true };
	});

export const markAllNotificationsRead = createServerFn({
	method: "POST",
}).handler(async () => {
	const user = await getCurrentUser();
	await markAllRead(user.id);
	return { success: true };
});

async function readableThread(repoId: number, number: number, userId: string) {
	if (!(await getRepositoryAccess(repoId, userId))?.canRead) throw notFound();
	const thread = await findThreadByNumber(repoId, number);
	if (!thread) throw notFound();
	return thread;
}

/** The current user's subscription to issue/PR `#number`. */
export const getThreadSubscription = createServerFn({ method: "GET" })
	.validator(z.object({ repoId: z.number(), number: z.number().int() }))
	.handler(async ({ data }) => {
		const user = await getCurrentUserOptional();
		if (!user) return { subscribed: false, reason: null };
		const thread = await readableThread(data.repoId, data.number, user.id);
		return getThreadSubscriptionState(user.id, thread.id);
	});

/** Subscribe to or unsubscribe from issue/PR `#number`. */
export const setThreadSubscription = createServerFn({ method: "POST" })
	.validator(
		z.object({
			repoId: z.number(),
			number: z.number().int(),
			subscribed: z.boolean(),
		}),
	)
	.handler(async ({ data }) => {
		const user = await getCurrentUser();
		const thread = await readableThread(data.repoId, data.number, user.id);
		return setSubscription(user.id, thread.id, data.subscribed);
	});
