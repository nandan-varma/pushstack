import { eq, inArray } from "drizzle-orm";
import { db } from "#/db";
import { activities, repositories } from "#/db/app-schema";
import type { ActivityEvent } from "#/lib/activity-types";

/** Records one event and returns its id, so a failed write can remove it. */
export async function recordActivity(
	userId: string,
	repoId: number,
	event: ActivityEvent,
): Promise<number> {
	const [row] = await db
		.insert(activities)
		.values({ userId, repoId, ...event })
		.returning({ id: activities.id });
	if (!row) throw new Error("Activity insert returned no row");
	return row.id;
}

export async function deleteActivity(id: number): Promise<void> {
	await db.delete(activities).where(eq(activities.id, id));
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
		where: {
			userId,
			...(options.includePrivate
				? {}
				: { RAW: (table) => inArray(table.repoId, publicRepoIds) }),
		},
		columns: { id: true, type: true, metadata: true, createdAt: true },
		with: {
			repository: {
				columns: { name: true },
				with: { owner: { columns: { username: true } } },
			},
		},
		orderBy: { createdAt: "desc" },
		limit: options.limit,
	});
}
