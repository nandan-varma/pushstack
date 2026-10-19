type ReferenceKind = "issue" | "pull";

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

const OWNER = "[A-Za-z0-9][\\w.-]*";
const REPO = "[A-Za-z0-9][\\w.-]*";
/** Up to 30 chars (`MAX_USERNAME_LENGTH`), alphanumeric at both ends. */
const LOGIN = "[A-Za-z0-9](?:[A-Za-z0-9._-]{0,28}[A-Za-z0-9])?";
const SHA = "(?=[0-9a-f]*\\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}";

/**
 * Matches `#123` style references and 7-40 char commit SHAs. Requires at
 * least one digit in the hex run so plain lowercase words (which only use
 * a-f) never accidentally match.
 */
export function createReferencePattern(): RegExp {
	return new RegExp(
		`(?<![\\w/#&])#(\\d+)\\b|(?<![\\w/@#.-])${SHA}(?![\\w-])`,
		"gi",
	);
}

/**
 * Every GitHub-style reference in rendered Markdown, as one alternation so a
 * span of text is claimed by exactly one kind. Capture groups:
 * 1 `owner`, 2 `repo`, 3 `N` (`owner/repo#N`); 4 `owner`, 5 `repo`, 6 `sha`
 * (`owner/repo@sha`); 7 `N` (`#N`); 8 `login` (`@login`); 9 `sha`.
 *
 * `@login` is not glued to a word (`a@b.com` is an email) and is not a scoped
 * package (`@babel/core`).
 */
export function createMarkdownReferencePattern(): RegExp {
	const guard = "(?<![\\w/.@#&-])";
	return new RegExp(
		[
			`${guard}(${OWNER})/(${REPO})#(\\d+)\\b`,
			`${guard}(${OWNER})/(${REPO})@(${SHA})(?![\\w-])`,
			"(?<![\\w/#&])#(\\d+)\\b",
			`(?<![\\w@/.\`&-])@(${LOGIN})(?![\\w@/-])`,
			`(?<![\\w/@#.-])(${SHA})(?![\\w-])`,
		].join("|"),
		"gi",
	);
}
