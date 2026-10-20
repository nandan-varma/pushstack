import { MAX_SEARCH_QUERY_CHARS } from "@/lib/limits";

/** The issue and PR list routes keep their whole filter in `?q=` (GitHub's). */
export function validateThreadSearch(search: Record<string, unknown>): {
	q?: string;
} {
	return {
		q:
			typeof search.q === "string" && search.q
				? search.q.slice(0, MAX_SEARCH_QUERY_CHARS)
				: undefined,
	};
}

export function threadSearchDeps({ search }: { search: { q?: string } }) {
	return { q: search.q ?? "" };
}
