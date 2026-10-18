/** Search and activity-feed server functions; anonymous visitors see public data. */
import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { repositories } from "#/db/app-schema";
import { user } from "#/db/schema";
import { listUserActivity } from "./activity";
import { perfContext } from "./perf-log";
import { publicUserFields } from "./repositories";
import { getCurrentUserOptional } from "./session";

/** An ILIKE pattern matching `text` literally anywhere (escapes `%`, `_`, `\`). */
const containing = (text: string) => `%${text.replace(/[\\%_]/g, "\\$&")}%`;

const searchSchema = z.object({
	query: z.string().trim().min(1).max(100),
	limit: z.number().int().min(1).max(100).default(20),
});

/** Repositories by name: public ones, plus the caller's own private ones. */
export const searchRepositories = createServerFn({ method: "GET" })
	.validator(searchSchema)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUserOptional();
		const visible = currentUser
			? or(
					eq(repositories.visibility, "public"),
					eq(repositories.ownerId, currentUser.id),
				)
			: eq(repositories.visibility, "public");
		return db.query.repositories.findMany({
			where: and(ilike(repositories.name, containing(data.query)), visible),
			with: { owner: publicUserFields },
			orderBy: [desc(repositories.updatedAt)],
			limit: data.limit,
		});
	});

/** Users by name or username (public profile fields only). */
export const searchUsers = createServerFn({ method: "GET" })
	.validator(searchSchema)
	.handler(({ data }) =>
		db.query.user.findMany({
			...publicUserFields,
			where: or(
				ilike(user.name, containing(data.query)),
				ilike(user.username, containing(data.query)),
			),
			limit: data.limit,
		}),
	);

/** A user's activity feed (the caller's own by default). */
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
