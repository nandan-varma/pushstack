import { type AnyColumn, type SQL, sql } from "drizzle-orm";

/** A LIKE pattern matching `text` literally anywhere (`%`, `_`, `\` escaped). */
export const containing = (text: string) =>
	`%${text.replace(/[\\%_]/g, "\\$&")}%`;

/** `column` contains `text`, ignoring ASCII case. */
export const containsText = (column: AnyColumn | SQL, text: string): SQL =>
	sql`${column} like ${containing(text)} escape '\\'`;

/**
 * A `@username` mention in `column`, ignoring ASCII case and not followed by a
 * username character (`[A-Za-z0-9._-]`). SQLite has no regular expressions,
 * and LIKE cannot say "not followed by", so this is a GLOB over the lowercased
 * text; `*`, `?` and `[` in the name are escaped as GLOB literals.
 */
export function mentions(column: AnyColumn | SQL, username: string): SQL {
	const name = username.toLowerCase().replace(/[*?[]/g, (c) => `[${c}]`);
	const endsWithMention = `*@${name}`;
	const followedByMention = `*@${name}[^a-z0-9._-]*`;
	return sql`(lower(${column}) glob ${endsWithMention} or lower(${column}) glob ${followedByMention})`;
}
