import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { parseRepositoryQuery } from "#/lib/topics";
import { listUserActivity } from "./activity";
import { perfContext } from "./perf-log";
import { publicUserFields } from "./repository-lookup";
import { containsText, hasTopic } from "./repository-search";
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
				RAW: (table) =>
					and(
						text ? containsText(table.name, text) : undefined,
						...topics.map((topic) => hasTopic(table.topics, topic)),
						or(
							eq(table.visibility, "public"),
							currentUser ? eq(table.ownerId, currentUser.id) : undefined,
						),
					) as SQL,
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
				RAW: (table) =>
					or(
						containsText(table.name, data.query),
						containsText(table.username, data.query),
					) as SQL,
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
