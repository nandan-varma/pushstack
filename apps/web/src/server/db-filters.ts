/**
 * Drizzle 1.0 rejects an empty `AND` array — "Unexpected empty array in
 * filters' 'AND' section. Omit field or use 'EmptyFilter' if you want filter to
 * be skipped" — where earlier versions ignored it. A list query whose filters
 * are all optional (an assignee filter, a label filter, a search term) must
 * therefore omit the key entirely when nothing applies, which is what
 * `andFilter` does.
 */
export const andFilter = <T extends object>(conditions: T[]) =>
	conditions.length > 0 ? { AND: conditions } : {};

/** An ILIKE pattern matching `text` literally anywhere (`%`, `_`, `\` escaped). */
export const containing = (text: string) =>
	`%${text.replace(/[\\%_]/g, "\\$&")}%`;
