/** Public profile pages. */
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { repositories } from "#/db/app-schema";
import { user } from "#/db/schema";
import { listUserActivity } from "./activity";
import { perfContext } from "./perf-log";
import { publicUserFields } from "./repositories";
import { getCurrentUserOptional } from "./session";

/**
 * A profile's public fields, repositories and recent activity in one round
 * trip; the user themselves also sees their private ones.
 */
export const getUserProfile = createServerFn({ method: "GET" })
	.validator(z.object({ username: z.string().min(1) }))
	.handler(({ data }) =>
		perfContext(`getUserProfile ${data.username}`, async () => {
			const [currentUser, profileUser] = await Promise.all([
				getCurrentUserOptional(),
				db.query.user.findFirst({
					columns: {
						id: true,
						username: true,
						displayUsername: true,
						name: true,
						image: true,
						createdAt: true,
					},
					where: eq(user.username, data.username),
				}),
			]);
			if (!profileUser) throw notFound();
			const isSelf = currentUser?.id === profileUser.id;

			const [repos, activities] = await Promise.all([
				db.query.repositories.findMany({
					where: isSelf
						? eq(repositories.ownerId, profileUser.id)
						: and(
								eq(repositories.ownerId, profileUser.id),
								eq(repositories.visibility, "public"),
							),
					with: { owner: publicUserFields },
					orderBy: [desc(repositories.updatedAt)],
					limit: 100,
				}),
				listUserActivity(profileUser.id, { includePrivate: isSelf, limit: 30 }),
			]);
			return { user: profileUser, isSelf, repositories: repos, activities };
		}),
	);
