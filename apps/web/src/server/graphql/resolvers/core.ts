/**
 * Core domain: `viewer`, `node(s)`, `rateLimit` and the `User` type's own
 * fields. Other domains extend `User` (repository adds `repositories`).
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "#/db";
import { user } from "#/db/schema";
import { STORAGE_NAME_RE } from "#/lib/storage-name";
import { htmlUrl, isoTimestamp } from "../../api/http";
import type { GraphQLContext } from "../context";
import { notFound } from "../errors";
import { decodeNodeId, encodeNodeId } from "../node-id";
import type { DomainResolvers, NodeLoader } from "./types";

const userColumns = {
	id: user.id,
	apiId: user.apiId,
	username: user.username,
	name: user.name,
	createdAt: user.createdAt,
	updatedAt: user.updatedAt,
};
export type UserRow = {
	id: string;
	apiId: number;
	username: string;
	name: string;
	createdAt: Date;
	updatedAt: Date;
};

export interface UserNode {
	__typename: "User";
	id: string;
	databaseId: number;
	login: string;
	name: string | null;
	resourcePath: string;
	url: string;
	createdAt: string;
	updatedAt: string;
	/** The user's internal id, for the fields other domains add. */
	userId: string;
}

export function userNode(row: UserRow): UserNode {
	return {
		__typename: "User",
		id: encodeNodeId("User", row.apiId),
		databaseId: row.apiId,
		login: row.username,
		name: row.name || null,
		resourcePath: `/${row.username}`,
		url: htmlUrl(`/${row.username}`),
		createdAt: isoTimestamp(row.createdAt),
		updatedAt: isoTimestamp(row.updatedAt),
		userId: row.id,
	};
}

/** Users by internal id, batched per request. */
export function loadUser(
	ctx: GraphQLContext,
	userId: string,
): Promise<UserRow | undefined> {
	return ctx
		.loader<string, UserRow>("user-by-id", async (ids) => {
			const rows = await db
				.select(userColumns)
				.from(user)
				.where(inArray(user.id, ids));
			return new Map(rows.map((row) => [row.id, row]));
		})
		.load(userId);
}

/** A user by login, or undefined (logins outside STORAGE_NAME_RE never exist). */
export async function loadUserByLogin(
	ctx: GraphQLContext,
	login: string,
): Promise<UserRow | undefined> {
	if (!STORAGE_NAME_RE.test(login)) return undefined;
	return ctx
		.loader<string, UserRow>("user-by-login", async (logins) => {
			const rows = await db
				.select(userColumns)
				.from(user)
				.where(inArray(user.username, logins));
			return new Map(rows.map((row) => [row.username, row]));
		})
		.load(login);
}

const loadUserNode: NodeLoader = async (key) => {
	if (!/^\d{1,10}$/.test(key)) return null;
	const [row] = await db
		.select(userColumns)
		.from(user)
		.where(eq(user.apiId, Number(key)));
	return row ? userNode(row) : null;
};

/**
 * Every domain's `node(id:)` loaders, filled in by schema.ts once all the
 * domain modules are loaded (core cannot import them: they import core).
 */
export const nodeLoaders = new Map<string, NodeLoader>();

async function resolveNode(id: string, ctx: GraphQLContext) {
	const decoded = decodeNodeId(id);
	const load = decoded && nodeLoaders.get(decoded.type);
	const node = decoded && load ? await load(decoded.key, ctx) : null;
	if (!node) {
		throw notFound(`Could not resolve to a node with the global id of '${id}'`);
	}
	return node;
}

export const coreResolvers: DomainResolvers = {
	types: {
		Query: {
			viewer: async (_source, _args, ctx) => {
				const row = await loadUser(ctx, ctx.caller.userId);
				if (!row) throw new Error("Authenticated user missing");
				return userNode(row);
			},
			node: (_source, args: { id: string }, ctx) => resolveNode(args.id, ctx),
			nodes: (_source, args: { ids: string[] }, ctx) =>
				// Each id resolves (or errors at its own path) independently.
				args.ids.map((id) => resolveNode(id, ctx)),
			rateLimit: (_source, _args, ctx) => ctx.rateLimit,
		},
	},
	nodes: { User: loadUserNode },
};
