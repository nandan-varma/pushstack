/**
 * Merging a thread's comments and timeline events into one chronological
 * column when each is loaded a page at a time (both oldest first).
 */

export type ThreadItem<C, E> =
	| { kind: "comment"; comment: C }
	| { kind: "event"; event: E };

interface Source<T> {
	/** The pages loaded so far, flattened, oldest first. */
	loaded: T[];
	/** Whether more remain to load after `loaded`. */
	hasMore: boolean;
}

const timeOf = (item: { createdAt: Date | string }) =>
	new Date(item.createdAt).getTime();

/** How far a source is complete: everything up to this time is loaded. */
function horizonOf<T extends { createdAt: Date | string }>({
	loaded,
	hasMore,
}: Source<T>): number {
	const last = loaded.at(-1);
	return hasMore && last ? timeOf(last) : Number.POSITIVE_INFINITY;
}

/**
 * The items that can be shown without a later page inserting one before them.
 * While a source has more to load, anything of the other source newer than its
 * last loaded item may belong after items not yet fetched, so it waits.
 *
 * Equal timestamps sort comments before events. So at the comments' horizon an
 * unfetched comment would precede an event of that instant (the event waits),
 * while at the events' horizon an unfetched event would follow every comment
 * of that instant (the comments show).
 */
export function mergeThreadItems<
	C extends { createdAt: Date | string },
	E extends { createdAt: Date | string },
>(
	comments: Source<C>,
	events: Source<E>,
): { items: ThreadItem<C, E>[]; hasMore: boolean } {
	const commentHorizon = horizonOf(comments);
	const eventHorizon = horizonOf(events);
	const items = [
		...comments.loaded
			.filter((c) => timeOf(c) <= commentHorizon && timeOf(c) <= eventHorizon)
			.map((comment) => ({ kind: "comment" as const, comment })),
		...events.loaded
			.filter((e) => timeOf(e) < commentHorizon && timeOf(e) <= eventHorizon)
			.map((event) => ({ kind: "event" as const, event })),
	].sort(
		(a, b) =>
			timeOf(a.kind === "comment" ? a.comment : a.event) -
			timeOf(b.kind === "comment" ? b.comment : b.event),
	);
	return { items, hasMore: comments.hasMore || events.hasMore };
}
