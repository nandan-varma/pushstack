/**
 * The followers API over watch-store.ts: who follows whom, the authenticated
 * user's follow list, and the follow/unfollow writes.
 */
import { eq } from "drizzle-orm";
import { db } from "#/db";
import { user } from "#/db/schema";
import { STORAGE_NAME_RE } from "#/lib/storage-name";
import {
	followUser,
	isFollowing,
	listFollowers,
	listFollowing,
	type Page,
	unfollowUser,
} from "../watch-store";
import { type ApiContext, requireCaller, requireScope } from "./auth";
import {
	json,
	linkHeader,
	noContent,
	notFoundError,
	pageParams,
	validationFailedError,
} from "./http";
import { pathParams, queryParams } from "./input";
import { simpleUser } from "./serializers";

/** The user with this login, or the 404 GitHub answers. */
async function userByLogin(login: string): Promise<{ id: string }> {
	if (!STORAGE_NAME_RE.test(login)) throw notFoundError();
	const [row] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.username, login));
	if (!row) throw notFoundError();
	return row;
}

async function respondWithUsers(
	ctx: ApiContext,
	list: (page: Page) => ReturnType<typeof listFollowers>,
) {
	const params = pageParams(ctx.url.searchParams);
	if (!params.reachable) return json([]);
	const { users, total } = await list({
		limit: params.perPage,
		offset: params.offset,
	});
	return json(users.map(simpleUser), 200, linkHeader(ctx.url, params, total));
}

/** `GET /user/followers`. */
export async function listFollowersOfCaller(ctx: ApiContext) {
	const caller = requireCaller(ctx);
	queryParams(ctx, "users/list-followers-for-authenticated-user", "User");
	return respondWithUsers(ctx, (page) => listFollowers(caller.userId, page));
}

/** `GET /user/following`. */
export async function listFollowedByCaller(ctx: ApiContext) {
	const caller = requireCaller(ctx);
	queryParams(ctx, "users/list-followed-by-authenticated-user", "User");
	return respondWithUsers(ctx, (page) => listFollowing(caller.userId, page));
}

/** `GET /users/{username}/followers`. */
export async function listFollowersOfUser(ctx: ApiContext) {
	const { username } = pathParams(ctx, "users/list-followers-for-user");
	const target = await userByLogin(username);
	queryParams(ctx, "users/list-followers-for-user", "User");
	return respondWithUsers(ctx, (page) => listFollowers(target.id, page));
}

/** `GET /users/{username}/following`. */
export async function listFollowingOfUser(ctx: ApiContext) {
	const { username } = pathParams(ctx, "users/list-following-for-user");
	const target = await userByLogin(username);
	queryParams(ctx, "users/list-following-for-user", "User");
	return respondWithUsers(ctx, (page) => listFollowing(target.id, page));
}

/** `GET /user/following/{username}`: 204 when the caller follows them, else 404. */
export async function checkCallerFollows(ctx: ApiContext) {
	const caller = requireCaller(ctx);
	const { username } = pathParams(
		ctx,
		"users/check-person-is-followed-by-authenticated",
	);
	const target = await userByLogin(username);
	if (!(await isFollowing(caller.userId, target.id))) throw notFoundError();
	return noContent();
}

/** `GET /users/{username}/following/{target_user}`. */
export async function checkUserFollows(ctx: ApiContext) {
	const { username, target_user: targetLogin } = pathParams(
		ctx,
		"users/check-following-for-user",
	);
	const [follower, target] = await Promise.all([
		userByLogin(username),
		userByLogin(targetLogin),
	]);
	if (!(await isFollowing(follower.id, target.id))) throw notFoundError();
	return noContent();
}

/** `PUT /user/following/{username}`: idempotent; yourself is a 422. */
export async function followAsCaller(ctx: ApiContext) {
	const caller = requireScope(ctx, "repo:write");
	const { username } = pathParams(ctx, "users/follow");
	const target = await userByLogin(username);
	if (target.id === caller.userId) {
		throw validationFailedError("You cannot follow yourself.", []);
	}
	await followUser(caller.userId, target.id);
	return noContent();
}

/** `DELETE /user/following/{username}`: idempotent. */
export async function unfollowAsCaller(ctx: ApiContext) {
	const caller = requireScope(ctx, "repo:write");
	const { username } = pathParams(ctx, "users/unfollow");
	const target = await userByLogin(username);
	await unfollowUser(caller.userId, target.id);
	return noContent();
}
