/**
 * Watching repositories and following users, with GitHub's semantics. Plain
 * server-only module shared by the REST API and the web server functions.
 *
 * A repository subscription is one row per (repository, user): `ignored =
 * false` is "all activity", `ignored = true` is "ignore", and no row is
 * "participating and @mentions". Whoever lists or counts watchers sees only
 * those who can still read the repository (repo-access.ts's rule), so a
 * private repository never reveals or counts someone whose access was removed
 * and subscriptions need no cleanup when visibility or collaborators change.
 */
import { and, asc, count, desc, eq, inArray, type SQL } from "drizzle-orm";
import { db } from "#/db";
import {
	follows,
	type Repository,
	repositories,
	repositorySubscriptions,
} from "#/db/app-schema";
import { user } from "#/db/schema";
import {
	canReadRepositoryCondition,
	readableRepositoriesCondition,
} from "./repo-access";
import { type PublicUser, publicUserColumns } from "./repository-lookup";

export interface RepoSubscription {
	ignored: boolean;
	createdAt: Date;
}

export async function getRepoSubscription(
	repoId: number,
	userId: string,
): Promise<RepoSubscription | null> {
	const [row] = await db
		.select({
			ignored: repositorySubscriptions.ignored,
			createdAt: repositorySubscriptions.createdAt,
		})
		.from(repositorySubscriptions)
		.where(
			and(
				eq(repositorySubscriptions.repoId, repoId),
				eq(repositorySubscriptions.userId, userId),
			),
		);
	return row ?? null;
}

/** Watch (`ignored: false`) or ignore a repository; keeps the first `createdAt`. */
export async function setRepoSubscription(
	repoId: number,
	userId: string,
	ignored: boolean,
): Promise<RepoSubscription> {
	const [row] = await db
		.insert(repositorySubscriptions)
		.values({ repoId, userId, ignored })
		.onConflictDoUpdate({
			target: [repositorySubscriptions.repoId, repositorySubscriptions.userId],
			set: { ignored },
		})
		.returning({
			ignored: repositorySubscriptions.ignored,
			createdAt: repositorySubscriptions.createdAt,
		});
	if (!row) throw new Error("Subscription upsert returned no row");
	return row;
}

export async function deleteRepoSubscription(
	repoId: number,
	userId: string,
): Promise<void> {
	await db
		.delete(repositorySubscriptions)
		.where(
			and(
				eq(repositorySubscriptions.repoId, repoId),
				eq(repositorySubscriptions.userId, userId),
			),
		);
}

/** The watchers (not the ignorers) who can still read each repository. */
const watchingReaders = (repoIds: number[]) =>
	and(
		inArray(repositorySubscriptions.repoId, repoIds),
		eq(repositorySubscriptions.ignored, false),
		canReadRepositoryCondition(
			repositorySubscriptions.userId,
			repositorySubscriptions.repoId,
		),
	);

/** `subscribers_count` for a page of repositories, in one query. */
export async function watcherCounts(
	repoIds: number[],
): Promise<Map<number, number>> {
	if (repoIds.length === 0) return new Map();
	const rows = await db
		.select({ repoId: repositorySubscriptions.repoId, total: count() })
		.from(repositorySubscriptions)
		.where(watchingReaders(repoIds))
		.groupBy(repositorySubscriptions.repoId);
	return new Map(rows.map((row) => [row.repoId, row.total]));
}

export interface Page {
	limit: number;
	offset: number;
}

/** People watching `repoId`, oldest subscription first. */
export async function listWatchers(
	repoId: number,
	page: Page,
): Promise<{ users: PublicUser[]; total: number }> {
	const where = watchingReaders([repoId]);
	const [rows, [totalRow]] = await Promise.all([
		db
			.select(publicUserColumns)
			.from(repositorySubscriptions)
			.innerJoin(user, eq(user.id, repositorySubscriptions.userId))
			.where(where)
			.orderBy(
				asc(repositorySubscriptions.createdAt),
				asc(repositorySubscriptions.userId),
			)
			.limit(page.limit)
			.offset(page.offset),
		db.select({ total: count() }).from(repositorySubscriptions).where(where),
	]);
	return { users: rows, total: totalRow?.total ?? 0 };
}

export interface WatchedRepository {
	repo: Repository;
	owner: PublicUser;
}

/**
 * Repositories `userId` watches that both they and `viewerId` (null:
 * anonymous) can read, so a private repository never leaks to someone who
 * can't see it. Newest subscription first.
 */
export async function listWatchedRepositories(
	userId: string,
	viewerId: string | null,
	page: Page,
): Promise<{ rows: WatchedRepository[]; total: number }> {
	const where = and(
		eq(repositorySubscriptions.userId, userId),
		eq(repositorySubscriptions.ignored, false),
		viewerId === null
			? eq(repositories.visibility, "public")
			: readableRepositoriesCondition(viewerId),
		canReadRepositoryCondition(
			repositorySubscriptions.userId,
			repositorySubscriptions.repoId,
		),
	);
	const [rows, [totalRow]] = await Promise.all([
		db
			.select({ repo: repositories, owner: publicUserColumns })
			.from(repositorySubscriptions)
			.innerJoin(
				repositories,
				eq(repositories.id, repositorySubscriptions.repoId),
			)
			.innerJoin(user, eq(user.id, repositories.ownerId))
			.where(where)
			.orderBy(
				desc(repositorySubscriptions.createdAt),
				desc(repositorySubscriptions.repoId),
			)
			.limit(page.limit)
			.offset(page.offset),
		db
			.select({ total: count() })
			.from(repositorySubscriptions)
			.innerJoin(
				repositories,
				eq(repositories.id, repositorySubscriptions.repoId),
			)
			.where(where),
	]);
	return { rows, total: totalRow?.total ?? 0 };
}

/** Which of `candidates` ignore `repoId` (notification fan-out). */
export async function ignoringUsers(
	repoId: number,
	candidates: string[],
): Promise<Set<string>> {
	if (candidates.length === 0) return new Set();
	const rows = await db
		.select({ userId: repositorySubscriptions.userId })
		.from(repositorySubscriptions)
		.where(
			and(
				eq(repositorySubscriptions.repoId, repoId),
				eq(repositorySubscriptions.ignored, true),
				inArray(repositorySubscriptions.userId, candidates),
			),
		);
	return new Set(rows.map((row) => row.userId));
}

/** Users watching `repoId` for all activity, who can still read it. */
export async function watcherIds(repoId: number): Promise<string[]> {
	const rows = await db
		.select({ userId: repositorySubscriptions.userId })
		.from(repositorySubscriptions)
		.where(watchingReaders([repoId]));
	return rows.map((row) => row.userId);
}

/* ------------------------------ following ------------------------------ */

export async function followUser(
	followerId: string,
	followeeId: string,
): Promise<void> {
	await db
		.insert(follows)
		.values({ followerId, followeeId })
		.onConflictDoNothing();
}

export async function unfollowUser(
	followerId: string,
	followeeId: string,
): Promise<void> {
	await db
		.delete(follows)
		.where(
			and(
				eq(follows.followerId, followerId),
				eq(follows.followeeId, followeeId),
			),
		);
}

export async function isFollowing(
	followerId: string,
	followeeId: string,
): Promise<boolean> {
	const [row] = await db
		.select({ one: follows.followerId })
		.from(follows)
		.where(
			and(
				eq(follows.followerId, followerId),
				eq(follows.followeeId, followeeId),
			),
		);
	return row !== undefined;
}

export interface FollowCounts {
	followers: number;
	following: number;
}

/** `followers` and `following` for a page of users, in two queries. */
export async function followCounts(
	userIds: string[],
): Promise<Map<string, FollowCounts>> {
	const counts = new Map<string, FollowCounts>(
		userIds.map((id) => [id, { followers: 0, following: 0 }]),
	);
	if (userIds.length === 0) return counts;
	const [followers, following] = await Promise.all([
		db
			.select({ id: follows.followeeId, total: count() })
			.from(follows)
			.where(inArray(follows.followeeId, userIds))
			.groupBy(follows.followeeId),
		db
			.select({ id: follows.followerId, total: count() })
			.from(follows)
			.where(inArray(follows.followerId, userIds))
			.groupBy(follows.followerId),
	]);
	for (const row of followers) {
		const entry = counts.get(row.id);
		if (entry) entry.followers = row.total;
	}
	for (const row of following) {
		const entry = counts.get(row.id);
		if (entry) entry.following = row.total;
	}
	return counts;
}

async function listFollowEdge(
	side: "followers" | "following",
	userId: string,
	page: Page,
): Promise<{ users: PublicUser[]; total: number }> {
	const [near, far] =
		side === "followers"
			? [follows.followeeId, follows.followerId]
			: [follows.followerId, follows.followeeId];
	const where: SQL | undefined = eq(near, userId);
	const [rows, [totalRow]] = await Promise.all([
		db
			.select(publicUserColumns)
			.from(follows)
			.innerJoin(user, eq(user.id, far))
			.where(where)
			.orderBy(desc(follows.createdAt), desc(far))
			.limit(page.limit)
			.offset(page.offset),
		db.select({ total: count() }).from(follows).where(where),
	]);
	return { users: rows, total: totalRow?.total ?? 0 };
}

/** People who follow `userId`, newest first. */
export const listFollowers = (userId: string, page: Page) =>
	listFollowEdge("followers", userId, page);

/** People `userId` follows, newest first. */
export const listFollowing = (userId: string, page: Page) =>
	listFollowEdge("following", userId, page);
