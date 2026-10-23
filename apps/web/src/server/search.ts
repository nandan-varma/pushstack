import { createServerFn } from "@tanstack/react-start";
import { and, desc, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { parseRepositoryQuery } from "#/lib/topics";
import { listUserActivity } from "./activity";
import { containing } from "./db-filters";
import { perfContext } from "./perf-log";
import { publicUserFields } from "./repository-lookup";
import { getCurrentUserOptional } from "./session";

const searchSchema = z.object({
	query: z.string().trim().min(1).max(100),
	limit: z.number().int().min(1).max(100).default(20),
});

/**
 * Repositories by name or `topic:` qualifier: public ones, plus the caller's
 * own private ones.
 */
export const searchRepositories = createServerFn({ method: "GET" })
	.validator(searchSchema)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUserOptional();
		const { text, topics } = parseRepositoryQuery(data.query);
		return db.query.repositories.findMany({
			where: {
				...(text && { name: { ilike: containing(text) } }),
				...(topics.length > 0 && {
					RAW: (table) =>
						and(
							...topics.map(
								(topic) =>
									sql`${table.topics} @> ${JSON.stringify([topic])}::jsonb`,
							),
						) as SQL,
				}),
				OR: [
					{ visibility: "public" },
					...(currentUser ? [{ ownerId: currentUser.id }] : []),
				],
			},
			with: { owner: publicUserFields },
			orderBy: (table) => [desc(table.updatedAt)],
			limit: data.limit,
		});
	});

/** Users by name or username (public profile fields only). */
export const searchUsers = createServerFn({ method: "GET" })
	.validator(searchSchema)
	.handler(({ data }) =>
		db.query.user.findMany({
			...publicUserFields,
			where: {
				OR: [
					{ name: { ilike: containing(data.query) } },
					{ username: { ilike: containing(data.query) } },
				],
			},
			limit: data.limit,
		}),
	);

export const getUserActivity = createServerFn({ method: "GET" })
	.validator(
		z.object({
			userId: z.string().optional(),
			limit: z.number().int().min(1).max(100).default(50),
		}),
	)
	.handler(({ data }) =>
		perfContext(`getUserActivity ${data.userId ?? "self"}`, async () => {
			const currentUser = await getCurrentUserOptional();
			const userId = data.userId ?? currentUser?.id;
			if (!userId) throw new Error("Authentication required");
			return listUserActivity(userId, {
				includePrivate: userId === currentUser?.id,
				limit: data.limit,
			});
		}),
	);
