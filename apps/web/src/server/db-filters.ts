/**
 * Helpers for building Drizzle relational `where` objects.
 *
 * Drizzle 1.0 rejects an empty `AND` array — "Unexpected empty array in
 * filters' 'AND' section. Omit field or use 'EmptyFilter' if you want filter to
 * be skipped" — where earlier versions ignored it. A list query whose filters
 * are all optional (an assignee filter, a label filter) must therefore omit the
 * key entirely when nothing applies, which is what `andFilter` does.
 */
export const andFilter = <T extends object>(conditions: T[]) =>
	conditions.length > 0 ? { AND: conditions } : {};
