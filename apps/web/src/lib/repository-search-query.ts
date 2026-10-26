/**
 * GitHub's repository search syntax, as far as PushStack serves it: free words
 * (matched against the name and description), `user:` (one owner),
 * `is:public` / `is:private`, and `topic:` (repeats, ANDed). Anything else is
 * refused with {@link UnservedQuery}, never read as text or dropped: a query
 * the search cannot answer must not look like an empty answer.
 *
 * Pure and database-independent; the REST search and any later GraphQL
 * repository search share it.
 */

/** A query or qualifier the search does not serve; the message names it. */
export class UnservedQuery extends Error {}

export interface RepositorySearchQuery {
	/** Words that must appear in the name or description (ANDed). */
	terms: string[];
	owner?: string;
	visibility?: "public" | "private";
	topics: string[];
	/** Contradictory qualifiers (two owners, public and private): nothing matches. */
	matchesNothing: boolean;
}

/** Whitespace-separated tokens; a double-quoted phrase is one token. */
function tokens(input: string): string[] {
	return input.match(/"[^"]*"|\S+/g) ?? [];
}

export function parseRepositorySearchQuery(
	input: string,
): RepositorySearchQuery {
	const query: RepositorySearchQuery = {
		terms: [],
		topics: [],
		matchesNothing: false,
	};
	const owners = new Set<string>();
	const visibilities = new Set<"public" | "private">();
	for (const raw of tokens(input)) {
		if (raw.startsWith('"')) {
			const phrase = raw.slice(1, -1).trim();
			if (phrase) query.terms.push(phrase);
			continue;
		}
		if (raw.startsWith("-")) {
			throw new UnservedQuery(`The search qualifier ${raw} is not served`);
		}
		const named = /^([A-Za-z][\w-]*):(.*)$/.exec(raw);
		if (!named) {
			query.terms.push(raw);
			continue;
		}
		const [, name = "", value = ""] = named;
		const lower = name.toLowerCase();
		if (value === "") {
			throw new UnservedQuery(`The search qualifier ${raw} has no value`);
		}
		if (lower === "user") {
			owners.add(value.toLowerCase());
		} else if (lower === "topic") {
			query.topics.push(value.toLowerCase());
		} else if (lower === "is" && (value === "public" || value === "private")) {
			visibilities.add(value);
		} else {
			throw new UnservedQuery(`The search qualifier ${raw} is not served`);
		}
	}
	if (owners.size > 1 || visibilities.size > 1) query.matchesNothing = true;
	if (owners.size === 1) query.owner = [...owners][0];
	if (visibilities.size === 1) query.visibility = [...visibilities][0];
	return query;
}
