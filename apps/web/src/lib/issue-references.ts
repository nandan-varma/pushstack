/**
 * Parsing `#N` references out of issue, pull request and comment text, the
 * way GitHub does: references inside code (fenced blocks or inline spans)
 * don't count, and only `#N` that isn't glued to a word or path (`a#1`,
 * `/#1`) is a reference.
 */

/**
 * Text with fenced code blocks and inline code spans blanked out.
 *
 * The fence pattern keeps CommonMark's rule that an unclosed fence runs to the
 * end of the text — including when the opening line is the last one and has no
 * trailing newline, which the previous `[^\n]*\n` form missed (the inline pass
 * then swallowed the backticks and happened to hide the body, which no longer
 * happens now that the inline pass is a linear scan).
 */
function withoutCode(text: string): string {
	return blankInlineCode(
		text.replace(
			/^(```|~~~)[^\n]*(?:\n[\s\S]*?(?:^\1[^\n]*$|(?![\s\S])))?/gm,
			" ",
		),
	);
}

/**
 * Blanks every inline code span, in one pass.
 *
 * This replaces `/(`+)[\s\S]*?\1/g`, which backtracks over every possible
 * opening run length: N backticks with no closing run of the same length costs
 * O(N²) CPU (measured: 4.5 s for the 64 KiB `MAX_BODY_CHARS` body limit, and a
 * pushed commit message is bounded only by the request cap). The scan below is
 * linear, and it runs while the caller holds the repository lock, so a slow
 * body also blocks every other write to that repository.
 *
 * A run of backticks opens the span and the next run at least as long closes
 * it, consuming exactly as many backticks as the opener had — the same pairing
 * the regex made, except that the regex could also split a longer opening run
 * (```` ```a`` ````) to find a shorter closer. No markdown renderer treats that
 * as code, so the difference only shows up in text that was never a span.
 */
function blankInlineCode(text: string): string {
	let blanked = "";
	let index = 0;
	while (index < text.length) {
		const open = text.indexOf("`", index);
		if (open === -1) return blanked + text.slice(index);
		let openEnd = open;
		while (text[openEnd] === "`") openEnd++;
		const runLength = openEnd - open;

		let cursor = openEnd;
		let close = -1;
		while (cursor < text.length) {
			const next = text.indexOf("`", cursor);
			if (next === -1) break;
			let nextEnd = next;
			while (text[nextEnd] === "`") nextEnd++;
			if (nextEnd - next >= runLength) {
				close = next;
				break;
			}
			cursor = nextEnd;
		}
		// An unclosed run is not a span: everything from here on stays as it is.
		if (close === -1) return blanked + text.slice(index);

		blanked += `${text.slice(index, open)} `;
		index = close + runLength;
	}
	return blanked;
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
