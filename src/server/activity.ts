import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "#/db";
import { activities, repositories } from "#/db/app-schema";
import type { ActivityEvent } from "#/lib/activity-types";

/** Append one entry to the activity feed. */
export async function recordActivity(
	userId: string,
	repoId: number,
	event: ActivityEvent,
): Promise<void> {
	await db.insert(activities).values({ userId, repoId, ...event });
}

/**
 * A user's recent activity, newest first — in public repositories only,
 * unless `includePrivate` (the user viewing their own feed). The visibility
 * filter is part of the query, so `limit` rows really come back.
 */
export function listUserActivity(
	userId: string,
	options: { includePrivate: boolean; limit: number },
) {
	const publicRepoIds = db
		.select({ id: repositories.id })
		.from(repositories)
		.where(eq(repositories.visibility, "public"));
	return db.query.activities.findMany({
		where: options.includePrivate
			? eq(activities.userId, userId)
			: and(
					eq(activities.userId, userId),
					inArray(activities.repoId, publicRepoIds),
				),
		columns: { id: true, type: true, metadata: true, createdAt: true },
		with: {
			repository: {
				columns: { name: true },
				with: { owner: { columns: { username: true } } },
			},
		},
		orderBy: [desc(activities.createdAt)],
		limit: options.limit,
	});
}
