/** Quoting Markdown for replies. */
/** `body` as a Markdown quote for a reply, GitHub-style, ready to type under. */
export function quoteForReply(body: string): string {
	const quoted = body
		.trim()
		.split("\n")
		.map((line) => (line ? `> ${line}` : ">"))
		.join("\n");
	return `${quoted}\n\n`;
}
