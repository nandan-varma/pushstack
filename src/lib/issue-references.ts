/**
 * Parsing `#N` references out of issue, pull request and comment text, the
 * way GitHub does: references inside code (fenced blocks or inline spans)
 * don't count, and only `#N` that isn't glued to a word or path (`a#1`,
 * `/#1`) is a reference.
 */

/** Text with fenced code blocks and inline code spans blanked out. */
function withoutCode(text: string): string {
	return text
		.replace(/^(```|~~~)[^\n]*\n[\s\S]*?(?:^\1[^\n]*$|(?![\s\S]))/gm, " ")
		.replace(/(`+)[\s\S]*?\1/g, " ");
}

function collectNumbers(text: string | null, pattern: RegExp): number[] {
	const numbers = new Set<number>();
	for (const match of withoutCode(text ?? "").matchAll(pattern)) {
		const number = Number(match[1]);
		if (Number.isSafeInteger(number) && number > 0) numbers.add(number);
	}
	return [...numbers];
}

/**
 * Issue numbers a PR body closes on merge ("Closes #4", "fixes #12", …).
 * Only these explicit verbs: a bare `#N` reference never closes anything.
 */
const CLOSING_ISSUE_REFERENCE =
	/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+(?:issue\s+)?#(\d+)\b/gi;

export function getClosingIssueNumbers(body: string | null): number[] {
	return collectNumbers(body, CLOSING_ISSUE_REFERENCE);
}

/** Every `#N` mentioned (closing or not), each once, in order of appearance. */
const ISSUE_REFERENCE = /(?<![\w/#&])#(\d+)\b/g;

export function getReferencedIssueNumbers(text: string | null): number[] {
	return collectNumbers(text, ISSUE_REFERENCE);
}
