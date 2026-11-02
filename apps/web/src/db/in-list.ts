import { type Column, type SQL, sql } from "drizzle-orm";

/**
 * `column IN (values)` as one bound parameter however long the list is.
 *
 * D1 allows 100 bound parameters per query, which `inArray` spends one per
 * value, so a long list (or a short one beside many other filters) fails at
 * runtime. This binds the list once, as JSON, and lets SQLite expand it.
 * An empty list matches nothing.
 *
 * `column` may be any column or SQL expression such as `lower(users.name)`;
 * `values` must be of the type it yields.
 */
export function inList<T extends string | number>(
	column: Column | SQL,
	values: readonly T[],
): SQL {
	return sql`${column} in (select value from json_each(${JSON.stringify(values)}))`;
}

/** The negation of {@link inList}; an empty list matches every row. */
export function notInList<T extends string | number>(
	column: Column | SQL,
	values: readonly T[],
): SQL {
	return sql`${column} not in (select value from json_each(${JSON.stringify(values)}))`;
}
