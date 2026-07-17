import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { activities, repositories, user } from "../db/schema";
import { perfContext, perfStep } from "./perf-log";
import { getCurrentUserOptional } from "./session";

// Public profile page data: the user's public fields plus their visible
// repositories and recent activity in one round trip. Follows the same
// "public + anonymous = read" model as search.ts — an anonymous visitor can
// see exactly what a direct public-repo URL visit would show, nothing more.
export const getUserProfile = createServerFn({ method: "GET" })
	.validator((data: unknown) =>
		z.object({ username: z.string().min(1) }).parse(data),
	)
	.handler(async ({ data }) =>
		perfContext(`getUserProfile ${data.username}`, async () => {
			const [currentUser, profileUser] = await Promise.all([
				perfStep("getCurrentUserOptional", () => getCurrentUserOptional()),
				perfStep("db: user.findFirst", () =>
					db.query.user.findFirst({
						where: eq(user.username, data.username),
					}),
				),
			]);

			if (!profileUser) {
				throw new Error("User not found");
			}

			const isSelf = currentUser?.id === profileUser.id;

			const publicRepoIds = db
				.select({ id: repositories.id })
				.from(repositories)
				.where(eq(repositories.visibility, "public"));

			const [repos, activityList] = await Promise.all([
				perfStep("db: repositories.findMany", () =>
					db.query.repositories.findMany({
						where: isSelf
							? eq(repositories.ownerId, profileUser.id)
							: and(
									eq(repositories.ownerId, profileUser.id),
									eq(repositories.visibility, "public"),
								),
						with: { owner: true },
						orderBy: [desc(repositories.updatedAt)],
						limit: 100,
					}),
				),
				perfStep("db: activities.findMany", () =>
					db.query.activities.findMany({
						where: isSelf
							? eq(activities.userId, profileUser.id)
							: and(
									eq(activities.userId, profileUser.id),
									inArray(activities.repoId, publicRepoIds),
								),
						with: {
							user: true,
							repository: { with: { owner: true } },
						},
						orderBy: [desc(activities.createdAt)],
						limit: 30,
					}),
				),
			]);

			return {
				user: {
					id: profileUser.id,
					username: profileUser.username,
					displayUsername: profileUser.displayUsername,
					name: profileUser.name,
					image: profileUser.image,
					createdAt: profileUser.createdAt,
				},
				isSelf,
				repositories: repos,
				activities: activityList.map((activity) => ({
					...activity,
					metadata: activity.metadata ?? {},
				})),
			};
		}),
	);
