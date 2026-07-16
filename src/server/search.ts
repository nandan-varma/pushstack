import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { activities, issues, repositories, user } from "../db/schema";
import { perfContext, perfStep } from "./perf-log";
import { canReadRepo } from "./repo-access";
import { getCurrentUser, getCurrentUserOptional } from "./session";

type UserSearchResult = {
	id: string;
	username: string | null;
	displayUsername: string | null;
	name: string;
	image: string | null;
};

// Search repositories
export const searchRepositories = createServerFn({ method: "GET" })
	.validator((data: unknown) =>
		z
			.object({
				query: z.string().min(1),
				limit: z.number().max(100).optional().default(20),
			})
			.parse(data),
	)
	.handler(async ({ data }) => {
		// Public repos are readable anonymously everywhere else in the app (see
		// repo-access.ts's "public + anonymous = read-only" model) — search
		// shouldn't require login to find the same repos a direct URL visit
		// wouldn't. Only the "also match my own private repos" clause needs a
		// signed-in user.
		const currentUser = await getCurrentUserOptional();

		const repos = await db.query.repositories.findMany({
			where: currentUser
				? or(
						and(
							ilike(repositories.name, `%${data.query}%`),
							eq(repositories.visibility, "public"),
						),
						and(
							ilike(repositories.name, `%${data.query}%`),
							eq(repositories.ownerId, currentUser.id),
						),
					)
				: and(
						ilike(repositories.name, `%${data.query}%`),
						eq(repositories.visibility, "public"),
					),
			with: {
				owner: true,
			},
			orderBy: [desc(repositories.updatedAt)],
			limit: data.limit,
		});

		return repos;
	});

// Search issues
export const searchIssues = createServerFn({ method: "GET" })
	.validator((data: unknown) =>
		z
			.object({
				repoId: z.number(),
				query: z.string().min(1),
				limit: z.number().max(100).optional().default(20),
			})
			.parse(data),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUserOptional();

		if (!(await canReadRepo(data.repoId, currentUser?.id))) {
			throw new Error("Access denied");
		}

		const issueList = await db.query.issues.findMany({
			where: and(
				eq(issues.repoId, data.repoId),
				or(
					ilike(issues.title, `%${data.query}%`),
					ilike(issues.body, `%${data.query}%`),
				),
			),
			with: {
				author: true,
			},
			orderBy: [desc(issues.createdAt)],
			limit: data.limit,
		});

		return issueList.map((issue) => ({
			...issue,
			labels: issue.labels ?? {},
		}));
	});

// Search users
export const searchUsers = createServerFn({ method: "GET" })
	.validator((data: unknown) =>
		z
			.object({
				query: z.string().min(1),
				limit: z.number().max(100).optional().default(20),
			})
			.parse(data),
	)
	.handler(async ({ data }): Promise<UserSearchResult[]> => {
		// Public profile lookup (username/name/avatar only) — no reason to
		// require login for something a direct profile-URL visit wouldn't.
		const users = await db.query.user.findMany({
			where: or(
				ilike(user.name, `%${data.query}%`),
				ilike(user.username, `%${data.query}%`),
			),
			limit: data.limit,
		});

		return users.map(({ id, username, displayUsername, name, image }) => ({
			id,
			username,
			displayUsername,
			name,
			image,
		}));
	});

// Get user activity feed
export const getUserActivity = createServerFn({ method: "GET" })
	.validator((data: unknown) =>
		z
			.object({
				userId: z.string().optional(),
				limit: z.number().max(100).optional().default(50),
			})
			.parse(data),
	)
	.handler(async ({ data }) =>
		perfContext(`getUserActivity user=${data.userId ?? "self"}`, async () => {
			const currentUser = await perfStep("getCurrentUser", () =>
				getCurrentUser(),
			);
			const targetUserId = data.userId || currentUser.id;
			const isOwnActivity = targetUserId === currentUser.id;

			// ponytail: filtering to public repos in JS *after* the DB applied `limit`
			// meant a page of recent-but-private activity could return far fewer rows
			// than requested (or none) even when plenty of public activity existed
			// further back — push the visibility filter into the query instead.
			const activityList = await perfStep("db: activities.findMany", () =>
				db.query.activities.findMany({
					where: isOwnActivity
						? eq(activities.userId, targetUserId)
						: and(
								eq(activities.userId, targetUserId),
								inArray(
									activities.repoId,
									db
										.select({ id: repositories.id })
										.from(repositories)
										.where(eq(repositories.visibility, "public")),
								),
							),
					with: {
						user: true,
						repository: true,
					},
					orderBy: [desc(activities.createdAt)],
					limit: data.limit,
				}),
			);

			return activityList.map((activity) => ({
				...activity,
				metadata: activity.metadata ?? {},
			}));
		}),
	);

// Get repository activity feed
export const getRepositoryActivity = createServerFn({ method: "GET" })
	.validator((data: unknown) =>
		z
			.object({
				repoId: z.number(),
				limit: z.number().max(100).optional().default(50),
			})
			.parse(data),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUserOptional();

		if (!(await canReadRepo(data.repoId, currentUser?.id))) {
			throw new Error("Access denied");
		}

		const activityList = await db.query.activities.findMany({
			where: eq(activities.repoId, data.repoId),
			with: {
				user: true,
			},
			orderBy: [desc(activities.createdAt)],
			limit: data.limit,
		});

		return activityList.map((activity) => ({
			...activity,
			metadata: activity.metadata ?? {},
		}));
	});

// Get global activity feed (public repositories)
export const getGlobalActivity = createServerFn({ method: "GET" })
	.validator((data: unknown) =>
		z
			.object({
				limit: z.number().max(100).optional().default(50),
			})
			.parse(data),
	)
	.handler(async ({ data }) => {
		// ponytail: same limit-then-filter issue as getUserActivity — filter to
		// public repos in the query so `limit` rows are actually returned.
		const activityList = await db.query.activities.findMany({
			where: inArray(
				activities.repoId,
				db
					.select({ id: repositories.id })
					.from(repositories)
					.where(eq(repositories.visibility, "public")),
			),
			with: {
				user: true,
				repository: true,
			},
			orderBy: [desc(activities.createdAt)],
			limit: data.limit,
		});

		return activityList.map((activity) => ({
			...activity,
			metadata: activity.metadata ?? {},
		}));
	});
