/**
 * The watching API over watch-store.ts: the caller's subscription to a
 * repository, a repository's watchers and the repositories a user watches.
 * Repositories the caller can't read are 404s (readable-only listings), and
 * watchers/subscriptions only ever include people who can still read them.
 */
import { eq } from "drizzle-orm";
import { db } from "#/db";
import { user } from "#/db/schema";
import { STORAGE_NAME_RE } from "#/lib/storage-name";
import {
	deleteRepoSubscription,
	getRepoSubscription,
	listWatchedRepositories,
	listWatchers,
	type RepoSubscription,
	setRepoSubscription,
} from "../watch-store";
import { type ApiContext, requireCaller, requireScope } from "./auth";
import {
	apiUrl,
	isoTimestamp,
	json,
	linkHeader,
	noContent,
	notFoundError,
	pageParams,
} from "./http";
import { pathParams, queryParams, requestBody } from "./input";
import { readableRepository } from "./repo-lookup";
import { openIssueCounts, starCounts } from "./repos";
import { repository, type Shape, simpleUser } from "./serializers";

function subscriptionShape(
	fullName: string,
	subscription: RepoSubscription,
	subscribed = !subscription.ignored,
): Shape<"repositorySubscription"> {
	return {
		subscribed,
		ignored: subscription.ignored,
		reason: null,
		created_at: isoTimestamp(subscription.createdAt),
		url: apiUrl(`/repos/${fullName}/subscription`),
		repository_url: apiUrl(`/repos/${fullName}`),
	};
}

const fullNameOf = (repo: { name: string; owner: { username: string } }) =>
	`${repo.owner.username}/${repo.name}`;

/** `GET /repos/{owner}/{repo}/subscription`: 404 unless the caller subscribed. */
export async function getRepoSubscriptionForCaller(ctx: ApiContext) {
	const caller = requireCaller(ctx);
	const { repo } = await readableRepository(ctx);
	const subscription = await getRepoSubscription(repo.id, caller.userId);
	if (!subscription) throw notFoundError();
	return json(subscriptionShape(fullNameOf(repo), subscription));
}

/**
 * `PUT /repos/{owner}/{repo}/subscription`: `ignored: true` ignores the
 * repository, otherwise the caller watches all activity; `subscribed: false`
 * (without `ignored`) removes the subscription.
 */
export async function putRepoSubscription(ctx: ApiContext) {
	const caller = requireScope(ctx, "repo:write");
	const { repo } = await readableRepository(ctx, { allowArchivedWrites: true });
	const body = await requestBody(
		ctx,
		"activity/set-repo-subscription",
		"Subscription",
		{ allowEmpty: true },
	);
	if (body.ignored !== true && body.subscribed === false) {
		await deleteRepoSubscription(repo.id, caller.userId);
		return json(
			subscriptionShape(
				fullNameOf(repo),
				{ ignored: false, createdAt: new Date() },
				false,
			),
		);
	}
	const subscription = await setRepoSubscription(
		repo.id,
		caller.userId,
		body.ignored === true,
	);
	return json(subscriptionShape(fullNameOf(repo), subscription));
}

/** `DELETE /repos/{owner}/{repo}/subscription`: back to participating only. */
export async function deleteRepoSubscriptionForCaller(ctx: ApiContext) {
	const caller = requireScope(ctx, "repo:write");
	const { repo } = await readableRepository(ctx, { allowArchivedWrites: true });
	await deleteRepoSubscription(repo.id, caller.userId);
	return noContent();
}

/** `GET /repos/{owner}/{repo}/subscribers`. */
export async function listRepoWatchers(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	queryParams(ctx, "activity/list-watchers-for-repo", "Subscription");
	const params = pageParams(ctx.url.searchParams);
	if (!params.reachable) return json([]);
	const { users, total } = await listWatchers(repo.id, {
		limit: params.perPage,
		offset: params.offset,
	});
	return json(users.map(simpleUser), 200, linkHeader(ctx.url, params, total));
}

async function respondWithWatched(
	ctx: ApiContext,
	userId: string,
	viewerId: string | null,
) {
	const params = pageParams(ctx.url.searchParams);
	if (!params.reachable) return json([]);
	const { rows, total } = await listWatchedRepositories(userId, viewerId, {
		limit: params.perPage,
		offset: params.offset,
	});
	const repoIds = rows.map((row) => row.repo.id);
	const [stars, openIssues] = await Promise.all([
		starCounts(repoIds),
		openIssueCounts(repoIds),
	]);
	return json(
		rows.map((row) =>
			repository(
				{ ...row.repo, owner: row.owner },
				{
					stars: stars.get(row.repo.id) ?? 0,
					openIssues: openIssues.get(row.repo.id) ?? 0,
				},
			),
		),
		200,
		linkHeader(ctx.url, params, total),
	);
}

/** `GET /user/subscriptions`: the repositories the caller watches. */
export async function listWatchedByCaller(ctx: ApiContext) {
	const caller = requireCaller(ctx);
	queryParams(
		ctx,
		"activity/list-watched-repos-for-authenticated-user",
		"Repository",
	);
	return respondWithWatched(ctx, caller.userId, caller.userId);
}

/** `GET /users/{username}/subscriptions`: what they watch that the caller may see. */
export async function listWatchedByUser(ctx: ApiContext) {
	const { username } = pathParams(ctx, "activity/list-repos-watched-by-user");
	if (!STORAGE_NAME_RE.test(username)) throw notFoundError();
	const [target] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.username, username));
	if (!target) throw notFoundError();
	queryParams(ctx, "activity/list-repos-watched-by-user", "Repository");
	return respondWithWatched(ctx, target.id, ctx.caller?.userId ?? null);
}
