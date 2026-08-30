export type ReferenceKind = "issue" | "pull";

export type ResolveReference = (num: number) => ReferenceKind | null;

/**
 * Issues and pull requests currently have separate database sequences. A
 * shorthand such as `#2` is therefore ambiguous when both resources exist.
 * Do not guess: a wrong link is worse than leaving the shorthand as text.
 */
export function createReferenceResolver(
	issueNumbers: Iterable<number>,
	pullRequestNumbers: Iterable<number>,
): ResolveReference {
	const issueSet = new Set(issueNumbers);
	const pullRequestSet = new Set(pullRequestNumbers);

	return (num: number): ReferenceKind | null => {
		const isIssue = issueSet.has(num);
		const isPullRequest = pullRequestSet.has(num);
		if (isIssue === isPullRequest) return null;
		return isIssue ? "issue" : "pull";
	};
}

/**
 * Matches `#123` style references and 7-40 char commit SHAs. Requires at
 * least one digit in the hex run so plain lowercase words (which only use
 * a-f) never accidentally match.
 */
export function createReferencePattern(): RegExp {
	return /#(\d+)\b|\b(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b/gi;
}
