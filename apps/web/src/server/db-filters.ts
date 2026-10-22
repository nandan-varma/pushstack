/** An ILIKE pattern matching `text` literally anywhere (`%`, `_`, `\` escaped). */
export const containing = (text: string) =>
	`%${text.replace(/[\\%_]/g, "\\$&")}%`;
