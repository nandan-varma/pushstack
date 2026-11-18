/**
 * Gist rows: lookup, pages and mutations shared by the REST handlers and later
 * the web pages and GraphQL. Permission checks live in `gist-access.ts`.
 */
import { and, count, desc, eq, gte, type SQL } from "drizzle-orm";
import { db } from "#/db";
import { gistStars, gists } from "#/db/app-schema";
import { user } from "#/db/schema";
import { randomBytes } from "#/lib/bytes";
import { type PublicUser, publicUserColumns } from "./repository-lookup";

export type GistRow = typeof gists.$inferSelect;
export type GistRowWithOwner = GistRow & { owner: PublicUser };

export interface GistPageOptions {
	since?: Date;
	limit: number;
	offset: number;
}

export interface GistPage {
	gists: GistRowWithOwner[];
	total: number;
}

/** A new gist's id: 32 lowercase hex, GitHub's shape and the storage segment. */
export function generateGistId(): string {
	return Array.from(randomBytes(16), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

const gistWithOwner = () =>
	db
		.select({ gist: gists, owner: publicUserColumns })
		.from(gists)
		.innerJoin(user, eq(gists.ownerId, user.id));

const rowOf = (row: {
	gist: GistRow;
	owner: PublicUser;
}): GistRowWithOwner => ({ ...row.gist, owner: row.owner });

const pageConditions = (conditions: SQL[], since?: Date) => [
	...conditions,
	...(since ? [gte(gists.updatedAt, since)] : []),
];

async function page(
	conditions: SQL[],
	options: GistPageOptions,
): Promise<GistPage> {
	const where = and(...pageConditions(conditions, options.since));
	const [rows, [total]] = await Promise.all([
		gistWithOwner()
			.where(where)
			.orderBy(desc(gists.updatedAt))
			.limit(options.limit)
			.offset(options.offset),
		db.select({ total: count() }).from(gists).where(where),
	]);
	return { gists: rows.map(rowOf), total: total?.total ?? 0 };
}

export async function findGistById(
	id: string,
): Promise<GistRowWithOwner | null> {
	const [row] = await gistWithOwner().where(eq(gists.id, id)).limit(1);
	return row ? rowOf(row) : null;
}

export async function findGistOwnerByUsername(
	username: string,
): Promise<PublicUser | null> {
	const [owner] = await db
		.select(publicUserColumns)
		.from(user)
		.where(eq(user.username, username))
		.limit(1);
	return owner ?? null;
}

export function listGistsForOwner(
	ownerId: string,
	options: GistPageOptions,
): Promise<GistPage> {
	return page([eq(gists.ownerId, ownerId)], options);
}

export function listPublicGists(options: GistPageOptions): Promise<GistPage> {
	return page([eq(gists.visibility, "public")], options);
}

export async function listPublicGistsForUser(
	username: string,
	options: GistPageOptions,
): Promise<GistPage | null> {
	const owner = await findGistOwnerByUsername(username);
	if (!owner) return null;
	return page(
		[eq(gists.ownerId, owner.id), eq(gists.visibility, "public")],
		options,
	);
}

export async function listStarredGists(
	userId: string,
	options: GistPageOptions,
): Promise<GistPage> {
	const where = and(
		eq(gistStars.userId, userId),
		...pageConditions([], options.since),
	);
	const [rows, [total]] = await Promise.all([
		gistWithOwner()
			.innerJoin(gistStars, eq(gistStars.gistId, gists.id))
			.where(where)
			.orderBy(desc(gists.updatedAt))
			.limit(options.limit)
			.offset(options.offset),
		db
			.select({ total: count() })
			.from(gistStars)
			.innerJoin(gists, eq(gistStars.gistId, gists.id))
			.where(where),
	]);
	return { gists: rows.map(rowOf), total: total?.total ?? 0 };
}

export async function countGistsForOwner(ownerId: string): Promise<number> {
	const [row] = await db
		.select({ total: count() })
		.from(gists)
		.where(eq(gists.ownerId, ownerId));
	return row?.total ?? 0;
}

export async function insertGist(input: {
	id: string;
	ownerId: string;
	description: string | null;
	visibility: "public" | "secret";
}): Promise<GistRow> {
	const [row] = await db.insert(gists).values(input).returning();
	if (!row) throw new Error("Gist insert returned no row");
	return row;
}

export async function updateGistRow(
	id: string,
	fields: {
		description?: string | null;
		visibility?: "public" | "secret";
		updatedAt?: Date;
		pushedAt?: Date;
	},
): Promise<void> {
	await db.update(gists).set(fields).where(eq(gists.id, id));
}

export async function deleteGistRow(id: string): Promise<void> {
	await db.delete(gists).where(eq(gists.id, id));
}
