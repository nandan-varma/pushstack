/**
 * GitHub's Connection shape (`nodes`, `edges { cursor node }`, `pageInfo`,
 * `totalCount`) over an offset window. Cursors are opaque: base64 of
 * `cursor:v2:<offset>`, the position of the item in the connection's order.
 * `first`/`last` bounds (1–100, one of them required) are enforced before
 * execution by limits.ts, so resolvers can trust them here.
 */
import { MAX_LIST_SKIP } from "#/lib/limits";
import { unprocessable } from "./errors";

export const MAX_PAGE_SIZE = 100;

export interface ConnectionArgs {
	first?: number | null;
	last?: number | null;
	after?: string | null;
	before?: string | null;
}

export interface PageInfo {
	startCursor: string | null;
	endCursor: string | null;
	hasNextPage: boolean;
	hasPreviousPage: boolean;
}

export interface Connection<T> {
	nodes: T[];
	edges: { cursor: string; node: T }[];
	pageInfo: PageInfo;
	totalCount: number;
}

export const encodeCursor = (offset: number) =>
	Buffer.from(`cursor:v2:${offset}`).toString("base64");

function decodeCursor(cursor: string): number {
	const match = /^cursor:v2:(\d{1,9})$/.exec(
		Buffer.from(cursor, "base64").toString("utf8"),
	);
	if (!match) {
		throw unprocessable(`\`${cursor}\` does not appear to be a valid cursor.`);
	}
	return Number(match[1]);
}

/**
 * The `[start, end)` window `args` select among `total` items, then the page:
 * `fetch(offset, limit)` returns the items at those positions.
 */
export async function offsetConnection<T>(
	args: ConnectionArgs,
	total: number,
	fetch: (offset: number, limit: number) => Promise<T[]>,
): Promise<Connection<T>> {
	let start = args.after != null ? decodeCursor(args.after) + 1 : 0;
	// Refused whatever the total, so a skip past the bound never reads as an empty page.
	if (start > MAX_LIST_SKIP)
		throw unprocessable("Pagination offset exceeds the maximum");
	let end = args.before != null ? decodeCursor(args.before) : total;
	// Count-only selections need no pagination boundary and fetch no rows.
	if (args.first == null && args.last == null) end = start;
	start = Math.min(start, total);
	end = Math.max(start, Math.min(end, total));
	if (args.first != null) end = Math.min(end, start + args.first);
	if (args.last != null) start = Math.max(start, end - args.last);
	const nodes = end > start ? await fetch(start, end - start) : [];
	return connectionOf(
		nodes,
		start,
		total,
		args.before == null && start + nodes.length < total,
	);
}

/**
 * Like {@link offsetConnection}, for a store whose page query also returns the
 * total (a window count): the page and its count are one query. The windows
 * that count back from the end (`last` without `before`) or fetch no rows do
 * one count-only query first.
 */
export async function countedConnection<T>(
	args: ConnectionArgs,
	fetch: (
		offset: number,
		limit: number,
	) => Promise<{ items: T[]; total: number }>,
): Promise<Connection<T>> {
	const after = args.after != null ? decodeCursor(args.after) + 1 : 0;
	// Refused whatever the total, so a skip past the bound never reads as an empty page.
	if (after > MAX_LIST_SKIP)
		throw unprocessable("Pagination offset exceeds the maximum");
	let start = after;
	// Count-only selections fetch no page: one row's count is the whole answer.
	if (args.first == null && args.last == null) {
		const { total } = await fetch(0, 1);
		start = Math.min(start, total);
		return connectionOf([], start, total, args.before == null && start < total);
	}
	let end = args.before != null ? decodeCursor(args.before) : undefined;
	if (args.last != null && end === undefined) {
		end = (await fetch(0, 1)).total;
	}
	// `first` bounds the window from the start, `last` (with a `before` cursor or
	// the total above) from the end.
	let limit: number;
	if (args.first != null) {
		limit = end === undefined ? args.first : Math.min(args.first, end - start);
	} else {
		start = Math.max(start, (end as number) - (args.last as number));
		limit = (end as number) - start;
	}
	const page = limit > 0 ? await fetch(start, limit) : await fetch(0, 1);
	const nodes = limit > 0 ? page.items : [];
	const total = page.total;
	start = Math.min(start, total);
	return connectionOf(
		nodes,
		start,
		total,
		args.before == null && start + nodes.length < total,
	);
}

function connectionOf<T>(
	nodes: T[],
	start: number,
	total: number,
	hasNextPage: boolean,
): Connection<T> {
	const edges = nodes.map((node, index) => ({
		cursor: encodeCursor(start + index),
		node,
	}));
	return {
		nodes,
		edges,
		totalCount: total,
		pageInfo: {
			startCursor: edges[0]?.cursor ?? null,
			endCursor: edges.at(-1)?.cursor ?? null,
			// GitHub: paging backward with `before` reports no next page.
			hasNextPage,
			hasPreviousPage: start > 0,
		},
	};
}
