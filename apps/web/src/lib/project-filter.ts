/**
 * The filter string a project's items share with `items(query:)`: bare words
 * match an item's title, `is:issue`, `is:pr` and `is:draft` its kind,
 * `field:value` a field value and `no:field` an empty one, all case-insensitive
 * and quote-able (`status:"In Progress"`). Parsed once, then applied to rows in
 * memory; nothing here reaches SQL.
 */
import { MAX_PROJECT_FILTER_CHARS } from "#/lib/limits";

/** Cap on tokens: a filter is a handful of words, not a script. */
const MAX_TERMS = 20;

export type ProjectItemKind = "issue" | "pull_request" | "draft";

const KINDS: Record<string, ProjectItemKind> = {
	issue: "issue",
	issues: "issue",
	pr: "pull_request",
	pull: "pull_request",
	pullrequest: "pull_request",
	draft: "draft",
};

export interface ProjectFilter {
	/** Words every matching title contains. */
	terms: string[];
	/** Kinds to keep; empty keeps every kind. */
	kinds: ProjectItemKind[];
	/** Field name (lowercase) and the value it must display. */
	values: { field: string; value: string }[];
	/** Field names (lowercase) that must have no value. */
	empty: string[];
}

export interface ProjectFilterItem {
	title: string;
	kind: ProjectItemKind;
	/** Display value by lowercase field name; null when unset. */
	values: Record<string, string | null>;
}

function tokenize(input: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quoted = false;
	for (const char of input.slice(0, MAX_PROJECT_FILTER_CHARS)) {
		if (char === '"') {
			quoted = !quoted;
			continue;
		}
		if (!quoted && /\s/.test(char)) {
			if (current) tokens.push(current);
			if (tokens.length >= MAX_TERMS) return tokens;
			current = "";
			continue;
		}
		current += char;
	}
	if (current) tokens.push(current);
	return tokens.slice(0, MAX_TERMS);
}

export function parseProjectFilter(input: string): ProjectFilter {
	const filter: ProjectFilter = {
		terms: [],
		kinds: [],
		values: [],
		empty: [],
	};
	for (const token of tokenize(input)) {
		const separator = token.indexOf(":");
		if (separator <= 0) {
			filter.terms.push(token.toLowerCase());
			continue;
		}
		const qualifier = token.slice(0, separator).toLowerCase();
		const value = token.slice(separator + 1);
		if (qualifier === "is") {
			const kind = KINDS[value.toLowerCase()];
			if (kind) filter.kinds.push(kind);
			else filter.terms.push(token.toLowerCase());
			continue;
		}
		if (qualifier === "no") {
			if (value) filter.empty.push(value.toLowerCase());
			continue;
		}
		filter.values.push({ field: qualifier, value: value.toLowerCase() });
	}
	return filter;
}

export type ProjectSortField = "title" | "updated" | (string & {});

export interface ProjectSort {
	/** "title", "updated", or a lowercase field name. */
	field: ProjectSortField;
	direction: "asc" | "desc";
}

/**
 * Sort rows by title, update time or a field's value (a number or date field
 * compares its own type). In place, like the filter: nothing here reaches SQL.
 */
export function sortProjectItems<T extends ProjectFilterItem>(
	items: (T & { updatedAt?: string })[],
	sort: ProjectSort,
): T[] {
	const factor = sort.direction === "desc" ? -1 : 1;
	return items.sort((a, b) => {
		if (sort.field === "title") {
			return factor * a.title.localeCompare(b.title);
		}
		if (sort.field === "updated") {
			return factor * (a.updatedAt ?? "").localeCompare(b.updatedAt ?? "");
		}
		const left = a.values[sort.field] ?? "";
		const right = b.values[sort.field] ?? "";
		const numeric = Number(left);
		if (left !== "" && right !== "" && !Number.isNaN(numeric)) {
			return factor * (numeric - Number(right));
		}
		return factor * left.localeCompare(right);
	});
}

export function matchesProjectFilter(
	item: ProjectFilterItem,
	filter: ProjectFilter,
): boolean {
	const title = item.title.toLowerCase();
	if (!filter.terms.every((term) => title.includes(term))) return false;
	if (filter.kinds.length > 0 && !filter.kinds.includes(item.kind))
		return false;
	for (const { field, value } of filter.values) {
		if ((item.values[field] ?? "").toLowerCase() !== value) return false;
	}
	for (const field of filter.empty) {
		if (item.values[field]) return false;
	}
	return true;
}
