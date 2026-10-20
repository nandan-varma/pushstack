import { count, eq } from "drizzle-orm";
import { db } from "#/db";
import { repositories } from "#/db/app-schema";
import { user } from "#/db/schema";
import { STORAGE_NAME_RE } from "#/lib/storage-name";
import { type ApiContext, requireCaller } from "./auth";
import { json, notFoundError } from "./http";
import { publicUser } from "./serializers";

type UserRow = typeof user.$inferSelect;

async function repositoryCounts(ownerId: string) {
	const rows = await db
		.select({ visibility: repositories.visibility, total: count() })
		.from(repositories)
		.where(eq(repositories.ownerId, ownerId))
		.groupBy(repositories.visibility);
	const of = (visibility: string) =>
		rows.find((row) => row.visibility === visibility)?.total ?? 0;
	return { publicRepos: of("public"), privateRepos: of("private") };
}

const serialize = (row: UserRow, publicRepos: number) =>
	publicUser(
		{
			id: row.id,
			apiId: row.apiId,
			username: row.username,
			name: row.name,
			image: row.image,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		},
		{ publicRepos },
	);

/** `GET /user`: the token's owner, with their private repository counts. */
export async function getAuthenticatedUser(ctx: ApiContext) {
	const { userId } = requireCaller(ctx);
	const [row] = await db.select().from(user).where(eq(user.id, userId));
	if (!row) throw notFoundError();
	const counts = await repositoryCounts(row.id);
	return json({
		...serialize(row, counts.publicRepos),
		total_private_repos: counts.privateRepos,
		owned_private_repos: counts.privateRepos,
	});
}

/** `GET /user/{account_id}`: a public profile by the integer `id`. */
export async function getUserById(ctx: ApiContext) {
	const raw = ctx.params.account_id ?? "";
	const apiId = /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : 0;
	if (apiId === 0 || apiId > 2_147_483_647) throw notFoundError();
	const [row] = await db.select().from(user).where(eq(user.apiId, apiId));
	if (!row) throw notFoundError();
	const counts = await repositoryCounts(row.id);
	return json(serialize(row, counts.publicRepos));
}

export async function getUser(ctx: ApiContext) {
	const username = ctx.params.username ?? "";
	if (!STORAGE_NAME_RE.test(username)) throw notFoundError();
	const [row] = await db.select().from(user).where(eq(user.username, username));
	if (!row) throw notFoundError();
	const counts = await repositoryCounts(row.id);
	return json(serialize(row, counts.publicRepos));
}
