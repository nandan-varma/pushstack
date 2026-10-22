/**
 * GitHub's compare spec: `base...head` (three-dot, against the merge base),
 * `base..head` (two-dot), or a lone `head` compared with the default branch.
 * Either side may be `owner:ref`; with no forks, only the repository's own
 * owner names anything. Returns null for a malformed spec. Refs are not
 * validated here: callers validate them with `safeCommitRevSchema`.
 */
export interface CompareSpec {
	base: string | null;
	head: string;
	separator: "..." | "..";
}

function side(raw: string, owner: string): string | null {
	const colon = raw.indexOf(":");
	if (colon === -1) return raw || null;
	if (raw.slice(0, colon).toLowerCase() !== owner.toLowerCase()) return null;
	return raw.slice(colon + 1) || null;
}

export function parseCompareSpec(
	spec: string,
	owner: string,
): CompareSpec | null {
	const separator = spec.includes("...") ? "..." : "..";
	const at = spec.indexOf(separator);
	if (at === -1) {
		const head = side(spec, owner);
		return head ? { base: null, head, separator: "..." } : null;
	}
	const base = side(spec.slice(0, at), owner);
	const head = side(spec.slice(at + separator.length), owner);
	if (!base || !head) return null;
	return { base, head, separator };
}

/** `name.diff` / `name.patch` → the name and its format; otherwise null. */
export function splitPatchSuffix(
	value: string,
): { name: string; format: "diff" | "patch" } | null {
	const match = /^(.+)\.(diff|patch)$/.exec(value);
	if (!match) return null;
	return { name: match[1] as string, format: match[2] as "diff" | "patch" };
}
