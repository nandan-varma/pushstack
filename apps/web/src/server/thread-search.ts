/**
 * GitHub's issue/pull-request query syntax as a thread-store filter.
 *
 * The parsing lives in `#/lib/search-query` (pure, database-independent);
 * this module maps its typed result onto `listThreads`'s filter and sort,
 * shared by the `getIssues` and `getPullRequests` lists. Plain server-only
 * helpers, not server functions.
 */
import type { SearchQuery, SearchSort } from "#/lib/search-query";
import type { ThreadFilter, ThreadSort } from "./thread-store";

/** The filter fields a parsed query sets (kind and state are the caller's). */
export function searchFilter(
	search: SearchQuery,
): Omit<ThreadFilter, "repoId" | "kind" | "state"> {
	return {
		terms: search.terms,
		authors: search.authors,
		mentions: search.mentions,
		labels: search.labels,
		noLabel: search.noLabel,
		assignees: [...(search.noAssignee ? ["none"] : []), ...search.assignees],
	};
}

/**
 * The list order for a `sort:` value. Comment-count sorts break ties newest
 * first either way, so a page is deterministic even when counts coincide.
 */
export function searchSort(sort: SearchSort): ThreadSort {
	switch (sort) {
		case "created-asc":
			return { by: "created", direction: "asc" };
		case "updated-desc":
			return { by: "updated", direction: "desc" };
		case "updated-asc":
			return { by: "updated", direction: "asc" };
		case "comments-desc":
			return { by: "comments", direction: "desc" };
		case "comments-asc":
			return { by: "comments", direction: "asc", tiebreak: "desc" };
		default:
			return { by: "created", direction: "desc" };
	}
}
