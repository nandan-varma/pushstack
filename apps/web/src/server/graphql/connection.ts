/**
 * GitHub's Connection shape (`nodes`, `edges { cursor node }`, `pageInfo`,
 * `totalCount`) over an offset window. Cursors are opaque: base64 of
 * `cursor:v2:<offset>`, the position of the item in the connection's order.
 * `first`/`last` bounds (1–100, one of them required) are enforced before
 * execution by limits.ts, so resolvers can trust them here.
 */
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

export function decodeCursor(cursor: string): number {
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
	let end = args.before != null ? decodeCursor(args.before) : total;
	start = Math.min(start, total);
	end = Math.max(start, Math.min(end, total));
	if (args.first != null) end = Math.min(end, start + args.first);
	if (args.last != null) start = Math.max(start, end - args.last);
	const nodes = end > start ? await fetch(start, end - start) : [];
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
			hasNextPage: start + nodes.length < total,
			hasPreviousPage: start > 0,
		},
	};
}
