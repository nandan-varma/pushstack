/**
 * GitHub's issue/pull-request query syntax: `is:`, `label:`, `author:`,
 * `assignee:`, `mentions:`, `no:`, `sort:` and free text.
 *
 * Pure and database-independent. The list routes parse a `?q=` string with
 * `parseSearchQuery` and hand the typed result to the server functions; the
 * REST API's eventual `/search/issues` will share the same parser.
 *
 * GitHub's rules are followed where they are observable: qualifiers are ANDed,
 * `label:` repeats AND, values may be quoted (`label:"help wanted"`), the
 * default sort is `created-desc`, and unknown qualifiers are ignored rather
 * than treated as text. Negation (`-label:x`) is not supported yet, so such a
 * token is ignored like any other unknown qualifier.
 */

/** The sorts GitHub's `sort:` accepts (and the default). */
export const SEARCH_SORTS = [
	"created-desc",
	"created-asc",
	"updated-desc",
	"updated-asc",
	"comments-desc",
	"comments-asc",
] as const;

export type SearchSort = (typeof SEARCH_SORTS)[number];

export const DEFAULT_SEARCH_SORT: SearchSort = "created-desc";

/** The `is:` state tokens. */
export type SearchStatus = "open" | "closed" | "merged" | "all";
/** The `is:` type tokens. */
export type SearchType = "issue" | "pr";

export interface SearchQuery {
	/** Free-text terms: each must appear in the thread's title or body. */
	terms: string[];
	/** `is:` state, resolved; undefined when unspecified. */
	status?: SearchStatus;
	/** `is:` type, resolved; undefined when unspecified or contradictory. */
	type?: SearchType;
	/**
	 * The `is:` filters contradict each other (`is:open is:closed`,
	 * `is:issue is:pr`): the query can match nothing, as on GitHub.
	 */
	matchesNothing: boolean;
	/** `label:` names; every one must be present (GitHub's AND). */
	labels: string[];
	/** `no:label` was given. */
	noLabel: boolean;
	/** `author:` usernames; every one must match (impossible unless repeated). */
	authors: string[];
	/** `assignee:` values: a username, `none` or `*`. */
	assignees: string[];
	/** `no:assignee` was given. */
	noAssignee: boolean;
	/** `mentions:` usernames; every one must be mentioned. */
	mentions: string[];
	sort: SearchSort;
}

interface Token {
	/** The token exactly as written, quotes included. */
	raw: string;
	/** A lowercased qualifier name (`label:bug` → `label`), or undefined. */
	name?: string;
	/** The unquoted value, or the unquoted free-text word. */
	value: string;
}

const QUOTE = /["']/;

/** Remove the surrounding quotes from a qualifier value, if any. */
function unquote(value: string): string {
	if (value.length >= 2) {
		const quote = value[0];
		if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
			return value.slice(1, -1).replace(/\\(["'\\])/g, "$1");
		}
	}
	return value;
}

/** Wrap a value so it survives tokenizing: quote when it contains a space. */
function formatValue(value: string): string {
	return /[\s"'\\]/.test(value)
		? `"${value.replace(/([\\"])/g, "\\$1")}"`
		: value;
}

/** Split a query into words, keeping quoted runs (and their spaces) intact. */
function tokenize(input: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;
	while (i < input.length) {
		while (i < input.length && /\s/.test(input[i] ?? "")) i++;
		if (i >= input.length) break;
		let raw = "";
		while (i < input.length && !/\s/.test(input[i] ?? "")) {
			const char = input[i] ?? "";
			if (char === '"' || char === "'") {
				raw += char;
				i++;
				while (i < input.length && input[i] !== char) {
					if (input[i] === "\\" && i + 1 < input.length) {
						raw += input[i] ?? "";
						i++;
					}
					raw += input[i] ?? "";
					i++;
				}
				if (i < input.length) {
					raw += input[i] ?? "";
					i++;
				}
			} else {
				raw += char;
				i++;
			}
		}
		tokens.push(parseToken(raw));
	}
	return tokens;
}

function parseToken(raw: string): Token {
	const colon = raw.indexOf(":");
	const quote = raw.search(QUOTE);
	// A colon before any quote and after an identifier is a qualifier; a free
	// word that merely contains `:` (`"a:b"`, `http://x`) stays text. A leading
	// `-` (GitHub negation) is accepted as a name so the token is ignored as an
	// unknown qualifier rather than searched as text.
	if (colon > 0 && (quote === -1 || colon < quote)) {
		const name = raw.slice(0, colon);
		if (/^-?[A-Za-z][A-Za-z0-9_-]*$/.test(name)) {
			return {
				raw,
				name: name.toLowerCase(),
				value: unquote(raw.slice(colon + 1)),
			};
		}
	}
	return { raw, value: unquote(raw) };
}

/** The `is:` state tokens a query carries, for editing a URL query string. */
function isStateToken(value: string): value is SearchStatus {
	return (
		value === "open" ||
		value === "closed" ||
		value === "merged" ||
		value === "all"
	);
}

function dedupe(values: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const value of values) {
		const key = value.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(value);
	}
	return out;
}

/**
 * Parse a GitHub query string into a typed, database-independent result.
 * Unknown qualifiers are dropped, as GitHub drops them.
 */
export function parseSearchQuery(input: string): SearchQuery {
	const terms: string[] = [];
	const statuses = new Set<SearchStatus>();
	const types = new Set<SearchType>();
	const labels: string[] = [];
	const authors: string[] = [];
	const assignees: string[] = [];
	const mentions: string[] = [];
	let noLabel = false;
	let noAssignee = false;
	let sort: SearchSort = DEFAULT_SEARCH_SORT;

	for (const token of tokenize(input)) {
		const value = token.value.trim();
		switch (token.name) {
			case undefined:
				if (value) terms.push(value);
				break;
			case "is": {
				const normalized = value.toLowerCase();
				if (isStateToken(normalized)) statuses.add(normalized);
				else if (normalized === "issue" || normalized === "pr")
					types.add(normalized);
				break;
			}
			case "label":
				if (value) labels.push(value);
				break;
			case "no":
				if (value.toLowerCase() === "label") noLabel = true;
				else if (value.toLowerCase() === "assignee") noAssignee = true;
				break;
			case "author":
				if (value) authors.push(value);
				break;
			case "assignee":
				if (value) assignees.push(value);
				break;
			case "mentions":
				if (value) mentions.push(value);
				break;
			case "sort":
				if ((SEARCH_SORTS as readonly string[]).includes(value.toLowerCase()))
					sort = value.toLowerCase() as SearchSort;
				break;
			default:
				// Unknown qualifier: ignored, as GitHub does.
				break;
		}
	}

	// `all` wins; `closed`+`merged` is their intersection (merged ⊂ closed on
	// GitHub); any other pair is contradictory and matches nothing.
	let status: SearchStatus | undefined;
	let matchesNothing = types.size > 1;
	if (statuses.has("all")) status = "all";
	else if (statuses.size === 1) status = [...statuses][0];
	else if (
		statuses.size === 2 &&
		statuses.has("closed") &&
		statuses.has("merged")
	)
		status = "merged";
	else if (statuses.size > 0) matchesNothing = true;

	return {
		terms,
		status,
		type: types.size === 1 ? [...types][0] : undefined,
		matchesNothing,
		labels: dedupe(labels),
		noLabel,
		authors: dedupe(authors),
		assignees: dedupe(assignees),
		noAssignee,
		mentions: dedupe(mentions),
		sort,
	};
}

/** Rebuild a token list into a query string, preserving unknown qualifiers. */
function join(tokens: Token[]): string {
	return tokens.map((token) => token.raw).join(" ");
}

/**
 * Set the `is:` state in a query, leaving any `is:issue`/`is:pr` (and every
 * other qualifier) in place — what clicking a list tab does to the URL.
 */
export function withSearchStatus(query: string, status: SearchStatus): string {
	const tokens = tokenize(query).filter(
		(token) =>
			!(token.name === "is" && isStateToken(token.value.toLowerCase())),
	);
	tokens.push({ raw: `is:${status}`, name: "is", value: status });
	return join(tokens);
}

/** Replace the `label:` qualifiers (all of them) with `label`, or remove them. */
export function withSearchLabel(query: string, label?: string): string {
	const tokens = tokenize(query).filter((token) => token.name !== "label");
	if (label) {
		const raw = `label:${formatValue(label)}`;
		tokens.push({ raw, name: "label", value: label });
	}
	return join(tokens);
}

/** Drop the assignee filters (`assignee:` and `no:assignee`) from a query. */
export function withoutSearchAssignee(query: string): string {
	return join(
		tokenize(query).filter(
			(token) =>
				token.name !== "assignee" &&
				!(token.name === "no" && token.value.toLowerCase() === "assignee"),
		),
	);
}
