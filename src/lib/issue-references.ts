/** Parsing `#N` references out of issue and pull request text. */

/**
 * Issue numbers a PR body closes on merge ("Closes #4", "fixes #12", …).
 * Only these explicit verbs: a bare `#N` reference never closes anything.
 */
const CLOSING_ISSUE_REFERENCE =
	/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+(?:issue\s+)?#(\d+)\b/gi;

export function getClosingIssueNumbers(body: string | null): number[] {
	const numbers = new Set<number>();
	for (const match of body?.matchAll(CLOSING_ISSUE_REFERENCE) ?? []) {
		const number = Number(match[1]);
		if (Number.isSafeInteger(number) && number > 0) numbers.add(number);
	}
	return [...numbers];
}
