export type ReferenceKind = "issue" | "pull";

export type ResolveReference = (num: number) => ReferenceKind | null;

/**
 * Matches `#123` style references and 7-40 char commit SHAs. Requires at
 * least one digit in the hex run so plain lowercase words (which only use
 * a-f) never accidentally match.
 */
export function createReferencePattern(): RegExp {
	return /#(\d+)\b|\b(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b/gi;
}
