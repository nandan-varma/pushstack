import type {
	FetchQueryOptions,
	QueryClient,
	QueryKey,
} from "@tanstack/react-query";

/*
 * Loaders start some queries without waiting for them. On the server that is
 * a trap: the query settles after the HTML is written, its data streams into
 * the browser's cache, and the page hydrates against data the server never
 * rendered (a hydration error, then a client re-render). Each loader query is
 * therefore one of the two kinds below.
 */

/**
 * Content the page shows (a README, `#123` link targets): the server waits
 * so it is in the HTML; the browser starts it without holding up navigation.
 */
export function contentQuery<T, K extends QueryKey>(
	queryClient: QueryClient,
	options: FetchQueryOptions<T, Error, T, K>,
): Promise<unknown> {
	const pending = queryClient.prefetchQuery(options);
	return import.meta.env.SSR ? pending : Promise.resolve();
}

/**
 * Expensive or secondary data (a diff, branch lists for a picker): fetched in
 * the browser only, in the background; the server renders without it.
 */
export function backgroundQuery<T, K extends QueryKey>(
	queryClient: QueryClient,
	options: FetchQueryOptions<T, Error, T, K>,
): void {
	if (!import.meta.env.SSR) void queryClient.prefetchQuery(options);
}
