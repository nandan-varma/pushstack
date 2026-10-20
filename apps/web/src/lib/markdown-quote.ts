export function quoteForReply(body: string): string {
	const quoted = body
		.trim()
		.split("\n")
		.map((line) => (line ? `> ${line}` : ">"))
		.join("\n");
	return `${quoted}\n\n`;
}
