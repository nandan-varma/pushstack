/**
 * GitHub's issue/pull-request query syntax: `is:` (or its alias `state:`),
 * `label:`, `author:`, `assignee:`, `mentions:`, `milestone:`, `no:`,
 * `sort:` and free text.
 *
 * Pure and database-independent. The list routes parse a `?q=` string with
 * `parseSearchQuery` and hand the typed result to the server functions; the
 * REST API's eventual `/search/issues` will share the same parser.
 *
 * GitHub's rules are followed where they are observable: qualifiers are ANDed,
 * `label:` repeats AND, values may be quoted (`label:"help wanted"`), the
 * default sort is `created-desc`, and only the known qualifier names below are
 * qualifiers — anything else (a URL, `a:b`) is searched as free text.
 * Negation (`-label:x`) is not supported yet, so it is searched as text too.
 */

const SEARCH_SORTS = [
	"created-desc",
	"created-asc",
	"updated-desc",
	"updated-asc",
	"comments-desc",
	"comments-asc",
] as const;

export type SearchSort = (typeof SEARCH_SORTS)[number];

const DEFAULT_SEARCH_SORT: SearchSort = "created-desc";

export type SearchStatus = "open" | "closed" | "merged" | "all";
export type SearchType = "issue" | "pr";

export interface SearchQuery {
	terms: string[];
	status?: SearchStatus;
	type?: SearchType;
	/**
	 * The `is:` filters contradict each other (`is:open is:closed`,
	 * `is:issue is:pr`): the query can match nothing, as on GitHub.
	 */
	matchesNothing: boolean;
	/** `label:` names; every one must be present (GitHub's AND). */
	labels: string[];
	noLabel: boolean;
	/**
	 * `author:` usernames. GitHub ANDs repeated qualifiers, so repeating a
	 * different `author:` matches nothing (one author can't be two people);
	 * that is by design.
	 */
	authors: string[];
	/** `assignee:` values: a username, `none` or `*`. */
	assignees: string[];
	/** `review-requested:` values: a username or `@me`. */
	reviewRequested: string[];
	/** `reviewed-by:` values: a username or `@me`. */
	reviewedBy: string[];
	noAssignee: boolean;
	/** `mentions:` usernames; every one must be mentioned. */
	mentions: string[];
	/** `milestone:` titles (ignoring case); an issue has one, so two differing match nothing. */
	milestones: string[];
	noMilestone: boolean;
	/** `draft:true` / `draft:false`: pull requests only; absent when unfiltered. */
	draft?: boolean;
	sort: SearchSort;
}

interface Token {
	raw: string;
	name?: string;
	value: string;
}

const QUOTE = /["']/;

/**
 * The qualifier names GitHub's issue/PR search understands. A token whose name
 * is not one of these is free text, not a dropped unknown qualifier — so a URL
 * or `a:b` in the box is searched for rather than silently matching everything.
 */
const KNOWN_QUALIFIERS = new Set([
	"is",
	"state",
	"type",
	"label",
	"no",
	"author",
	"assignee",
	"mentions",
	"review-requested",
	"reviewed-by",
	"milestone",
	"draft",
	"sort",
]);

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
	// Only a known qualifier name before the first quote makes this a qualifier;
	// anything else (`http://x`, `a:b`, `"a:b"`) is free text.
	if (colon > 0 && (quote === -1 || colon < quote)) {
		const name = raw.slice(0, colon).toLowerCase();
		if (KNOWN_QUALIFIERS.has(name)) {
			return { raw, name, value: unquote(raw.slice(colon + 1)) };
		}
	}
	return { raw, value: unquote(raw) };
}

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

export function parseSearchQuery(input: string): SearchQuery {
	const terms: string[] = [];
	const statuses = new Set<SearchStatus>();
	const types = new Set<SearchType>();
	const labels: string[] = [];
	const authors: string[] = [];
	const assignees: string[] = [];
	const mentions: string[] = [];
	const reviewRequested: string[] = [];
	const reviewedBy: string[] = [];
	const milestones: string[] = [];
	let noMilestone = false;
	let noLabel = false;
	let noAssignee = false;
	const drafts = new Set<boolean>();
	let sort: SearchSort = DEFAULT_SEARCH_SORT;

	for (const token of tokenize(input)) {
		const value = token.value.trim();
		switch (token.name) {
			case undefined:
				if (value) terms.push(value);
				break;
			case "type": {
				// GitHub's `type:issue` / `type:pr`, the same as `is:issue` / `is:pr`.
				const normalized = value.toLowerCase();
				if (normalized === "issue" || normalized === "pr")
					types.add(normalized);
				break;
			}
			case "is":
			case "state": {
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
				else if (value.toLowerCase() === "milestone") noMilestone = true;
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
			case "review-requested":
				if (value) reviewRequested.push(value);
				break;
			case "reviewed-by":
				if (value) reviewedBy.push(value);
				break;
			case "milestone":
				if (value) milestones.push(value);
				break;
			case "draft":
				if (value.toLowerCase() === "true") drafts.add(true);
				else if (value.toLowerCase() === "false") drafts.add(false);
				break;
			case "sort":
				if ((SEARCH_SORTS as readonly string[]).includes(value.toLowerCase()))
					sort = value.toLowerCase() as SearchSort;
				break;
		}
	}

	// `all` wins; `closed`+`merged` is their intersection (merged ⊂ closed on
	// GitHub); any other pair is contradictory and matches nothing.
	let status: SearchStatus | undefined;
	// `draft:true draft:false` is contradictory; a draft filter is about pull
	// requests, so `is:issue` with one matches nothing.
	let matchesNothing =
		types.size > 1 ||
		drafts.size > 1 ||
		(drafts.size > 0 && types.has("issue"));
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
		reviewRequested: dedupe(reviewRequested),
		reviewedBy: dedupe(reviewedBy),
		milestones: dedupe(milestones),
		noMilestone,
		...(drafts.size === 1 && { draft: [...drafts][0] }),
		sort,
	};
}

/**
 * The first part of a query that a strict reader cannot serve, or null. The
 * GraphQL search refuses rather than reading these as the lenient list parser
 * does: an unquoted `name:` that is not a qualifier (`in:title`, which would
 * otherwise be literal text), a negated qualifier (`-label:x`), a qualifier
 * with no value, and a value the search does not serve (`is:locked`,
 * `no:project`, `draft:maybe`, an unknown `sort:`). Quoted text is text.
 */
export function unservedQualifier(input: string): string | null {
	const servedStates: readonly string[] = [
		"open",
		"closed",
		"merged",
		"all",
		"issue",
		"pr",
	];
	for (const token of tokenize(input)) {
		const named = /^(-?)([A-Za-z][\w-]*):/.exec(token.raw);
		if (!named) continue;
		if (named[1] === "-" || !token.name) return token.raw;
		const value = token.value.trim().toLowerCase();
		if (value === "") return token.raw;
		const served =
			token.name === "type"
				? value === "issue" || value === "pr"
				: token.name === "is" || token.name === "state"
					? servedStates.includes(value)
					: token.name === "no"
						? ["label", "assignee", "milestone"].includes(value)
						: token.name === "draft"
							? value === "true" || value === "false"
							: token.name === "sort"
								? (SEARCH_SORTS as readonly string[]).includes(value)
								: true;
		if (!served) return token.raw;
	}
	return null;
}

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
			!(
				(token.name === "is" || token.name === "state") &&
				isStateToken(token.value.toLowerCase())
			),
	);
	tokens.push({ raw: `is:${status}`, name: "is", value: status });
	return join(tokens);
}

/**
 * The scope qualifiers of a query and the query without them: `repo:owner/name`
 * (the repositories) and `user:login` (their owner). GitHub scopes a search this
 * way; a search without one spans every repository the caller can read.
 */
export function splitScopeQualifiers(input: string): {
	repos: string[];
	owners: string[];
	rest: string;
} {
	const repos: string[] = [];
	const owners: string[] = [];
	const rest: string[] = [];
	for (const token of tokenize(input)) {
		const repo = /^repo:(.+)$/i.exec(token.raw);
		const owner = /^user:(.+)$/i.exec(token.raw);
		if (repo?.[1] !== undefined) repos.push(unquote(repo[1]));
		else if (owner?.[1] !== undefined) owners.push(unquote(owner[1]));
		else rest.push(token.raw);
	}
	return { repos, owners, rest: rest.join(" ") };
}

export function withSearchLabel(query: string, label?: string): string {
	const tokens = tokenize(query).filter((token) => token.name !== "label");
	if (label) {
		const raw = `label:${formatValue(label)}`;
		tokens.push({ raw, name: "label", value: label });
	}
	return join(tokens);
}

export function withoutSearchAssignee(query: string): string {
	return join(
		tokenize(query).filter(
			(token) =>
				token.name !== "assignee" &&
				!(token.name === "no" && token.value.toLowerCase() === "assignee"),
		),
	);
}
