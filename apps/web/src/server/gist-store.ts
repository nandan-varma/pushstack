/**
 * Gist rows: lookup, pages and mutations shared by the REST handlers and later
 * the web pages and GraphQL. Permission checks live in `gist-access.ts`.
 */
import { and, asc, count, desc, eq, gte, inArray, type SQL } from "drizzle-orm";
import { db } from "#/db";
import { gistComments, gistStars, gists } from "#/db/app-schema";
import { user } from "#/db/schema";
import { randomBytes } from "#/lib/bytes";
import { GIST_ID_RE } from "./git-storage-naming";
import { type PublicUser, publicUserColumns } from "./repository-lookup";

export type GistRow = typeof gists.$inferSelect;
export type GistRowWithOwner = GistRow & { owner: PublicUser };
export type GistCommentRow = typeof gistComments.$inferSelect;
export type GistCommentWithAuthor = GistCommentRow & {
	author: PublicUser;
};

export interface GistPageOptions {
	since?: Date;
	limit: number;
	offset: number;
	/** A listing's privacy filter; omitted lists both public and secret gists. */
	visibility?: "public" | "secret";
	order?: {
		field: "createdAt" | "updatedAt" | "pushedAt";
		direction: "asc" | "desc";
	};
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

const commentWithAuthor = () =>
	db
		.select({ comment: gistComments, author: publicUserColumns })
		.from(gistComments)
		.innerJoin(user, eq(gistComments.userId, user.id));

const commentOf = (row: {
	comment: GistCommentRow;
	author: PublicUser;
}): GistCommentWithAuthor => ({ ...row.comment, author: row.author });

const pageConditions = (conditions: SQL[], since?: Date) => [
	...conditions,
	...(since ? [gte(gists.updatedAt, since)] : []),
];

function pageWhere(conditions: SQL[], options: GistPageOptions) {
	return and(
		...pageConditions(conditions, options.since),
		...(options.visibility ? [eq(gists.visibility, options.visibility)] : []),
	);
}

function pageOrder(options: GistPageOptions) {
	const field = options.order?.field ?? "updatedAt";
	return options.order?.direction === "asc"
		? asc(gists[field])
		: desc(gists[field]);
}

async function page(
	conditions: SQL[],
	options: GistPageOptions,
): Promise<GistPage> {
	const where = pageWhere(conditions, options);
	const [rows, [total]] = await Promise.all([
		gistWithOwner()
			.where(where)
			.orderBy(pageOrder(options))
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

/**
 * The gist `/{owner}/{id}` names, or null. GitHub serves a gist at that path
 * too, so a repository lookup that misses falls back to this before 404ing.
 */
export async function findGistAtOwnerPath(
	owner: string,
	id: string,
): Promise<GistRowWithOwner | null> {
	if (!GIST_ID_RE.test(id)) return null;
	const row = await findGistById(id);
	return row?.owner.username === owner ? row : null;
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
	forkOfId?: string;
}): Promise<GistRow> {
	const [row] = await db
		.insert(gists)
		.values({ ...input, isFork: input.forkOfId !== undefined })
		.returning();
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

/** Forks of one gist, newest update first. */
export function listGistForks(
	parentId: string,
	options: GistPageOptions,
): Promise<GistPage> {
	return page([eq(gists.forkOfId, parentId)], options);
}

export async function isGistStarred(
	gistId: string,
	userId: string,
): Promise<boolean> {
	const [row] = await db
		.select({ userId: gistStars.userId })
		.from(gistStars)
		.where(and(eq(gistStars.gistId, gistId), eq(gistStars.userId, userId)))
		.limit(1);
	return row !== undefined;
}

/** Idempotent: starring an already-starred gist changes nothing. */
export async function addGistStar(
	gistId: string,
	userId: string,
): Promise<void> {
	await db.insert(gistStars).values({ gistId, userId }).onConflictDoNothing();
}

export async function countGistStars(gistId: string): Promise<number> {
	const [row] = await db
		.select({ total: count() })
		.from(gistStars)
		.where(eq(gistStars.gistId, gistId));
	return row?.total ?? 0;
}

/** A gist's stargazers, most recent star first, with the time it was given. */
export function listGistStargazers(
	gistId: string,
	options: { limit: number; offset: number },
): Promise<{ user: PublicUser; starredAt: Date }[]> {
	return db
		.select({ user: publicUserColumns, starredAt: gistStars.createdAt })
		.from(gistStars)
		.innerJoin(user, eq(gistStars.userId, user.id))
		.where(eq(gistStars.gistId, gistId))
		.orderBy(desc(gistStars.createdAt))
		.limit(options.limit)
		.offset(options.offset);
}

/** Idempotent: unstarring a gist that is not starred changes nothing. */
export async function removeGistStar(
	gistId: string,
	userId: string,
): Promise<void> {
	await db
		.delete(gistStars)
		.where(and(eq(gistStars.gistId, gistId), eq(gistStars.userId, userId)));
}

/** A gist's commits' users, by the email the commit carries. */
export async function findUsersByEmail(
	emails: string[],
): Promise<Map<string, PublicUser>> {
	if (emails.length === 0) return new Map();
	const rows = await db
		.select({ ...publicUserColumns, email: user.email })
		.from(user)
		.where(inArray(user.email, emails));
	return new Map(rows.map(({ email, ...author }) => [email, author]));
}

export async function listGistComments(
	gistId: string,
	options: { limit: number; offset: number },
): Promise<GistCommentWithAuthor[]> {
	const rows = await commentWithAuthor()
		.where(eq(gistComments.gistId, gistId))
		.orderBy(gistComments.createdAt, gistComments.id)
		.limit(options.limit)
		.offset(options.offset);
	return rows.map(commentOf);
}

export async function countGistComments(gistId: string): Promise<number> {
	const [row] = await db
		.select({ total: count() })
		.from(gistComments)
		.where(eq(gistComments.gistId, gistId));
	return row?.total ?? 0;
}

/** Comment counts for several gists at once, for a list's `comments` field. */
export async function gistCommentCounts(
	gistIds: string[],
): Promise<Map<string, number>> {
	if (gistIds.length === 0) return new Map();
	const rows = await db
		.select({ gistId: gistComments.gistId, total: count() })
		.from(gistComments)
		.where(inArray(gistComments.gistId, gistIds))
		.groupBy(gistComments.gistId);
	return new Map(rows.map((row) => [row.gistId, row.total]));
}

export async function findGistComment(
	gistId: string,
	commentId: number,
): Promise<GistCommentWithAuthor | null> {
	const [row] = await commentWithAuthor()
		.where(and(eq(gistComments.gistId, gistId), eq(gistComments.id, commentId)))
		.limit(1);
	return row ? commentOf(row) : null;
}

export async function insertGistComment(input: {
	gistId: string;
	userId: string;
	body: string;
}): Promise<GistCommentRow> {
	const [row] = await db.insert(gistComments).values(input).returning();
	if (!row) throw new Error("Gist comment insert returned no row");
	return row;
}

export async function updateGistCommentRow(
	id: number,
	body: string,
): Promise<void> {
	await db
		.update(gistComments)
		.set({ body, updatedAt: new Date() })
		.where(eq(gistComments.id, id));
}

export async function deleteGistCommentRow(id: number): Promise<void> {
	await db.delete(gistComments).where(eq(gistComments.id, id));
}
