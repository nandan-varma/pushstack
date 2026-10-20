/**
 * Database conditions for GitHub's issue/pull-request query syntax.
 *
 * The parsing lives in `#/lib/search-query` (pure, database-independent);
 * this module turns its typed result into Drizzle conditions shared by the
 * `getIssues` and `getPullRequests` lists. Plain server-only helpers, not
 * server functions.
 */
import {
	and,
	asc,
	type Column,
	desc,
	eq,
	exists,
	ilike,
	inArray,
	notExists,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { db } from "#/db";
import { comments, issueAssignees, threadLabels } from "#/db/app-schema";
import { user } from "#/db/schema";
import type { SearchSort } from "#/lib/search-query";
import { threadsWithLabels } from "./label-store";

/** The columns a thread (issue or pull request) list can filter and order on. */
export interface SearchableThread {
	id: Column;
	number: Column;
	title: Column;
	body: Column;
	authorId: Column;
	createdAt: Column;
	updatedAt: Column;
}

/** A condition builder, as Drizzle's relational `where` `RAW` expects. */
export type ThreadCondition = (table: SearchableThread) => SQL;

/** An ILIKE pattern matching `text` literally anywhere (`%`, `_`, `\` escaped). */
const containing = (text: string) => `%${text.replace(/[\\%_]/g, "\\$&")}%`;

/** A Postgres regex matching `@username` as a whole mention. */
const mentionPattern = (username: string) =>
	`@${username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9._-])`;

/** Title or body contains every term (GitHub ANDs free-text words). */
export function textCondition(terms: string[]): ThreadCondition | undefined {
	if (terms.length === 0) return undefined;
	return (table) =>
		and(
			...terms.map((term) =>
				or(
					ilike(table.title, containing(term)),
					ilike(table.body, containing(term)),
				),
			),
		) as SQL;
}

/** The author matches every given username (a single author: AND is a no-op). */
export function authorCondition(
	authors: string[],
): ThreadCondition | undefined {
	if (authors.length === 0) return undefined;
	return (table) =>
		and(
			...authors.map((username) =>
				inArray(
					table.authorId,
					db
						.select({ id: user.id })
						.from(user)
						.where(eq(user.username, username)),
				),
			),
		) as SQL;
}

/**
 * The thread mentions every given username: in its title, its body, or any of
 * its comments (`@username`, matched as a whole mention).
 */
export function mentionsCondition(
	mentions: string[],
	commentRef: Column,
): ThreadCondition | undefined {
	if (mentions.length === 0) return undefined;
	return (table) =>
		and(
			...mentions.map((username) => {
				const pattern = mentionPattern(username);
				return or(
					sql`${table.title} ~* ${pattern}`,
					sql`${table.body} ~* ${pattern}`,
					exists(
						db
							.select({ one: sql`1` })
							.from(comments)
							.where(
								sql`${commentRef} = ${table.id} and ${comments.body} ~* ${pattern}`,
							),
					),
				);
			}),
		) as SQL;
}

/** `label:a label:b` (AND, names matched ignoring case) or `no:label`. */
export function labelCondition(
	repoId: number,
	labels: string[],
	noLabel: boolean,
): ThreadCondition | undefined {
	if (noLabel) {
		return (table) =>
			notExists(
				db
					.select({ one: sql`1` })
					.from(threadLabels)
					.where(
						and(
							eq(threadLabels.repoId, repoId),
							eq(threadLabels.number, table.number),
						),
					),
			);
	}
	if (labels.length === 0) return undefined;
	return (table) =>
		inArray(table.number, threadsWithLabels(repoId, labels)) as SQL;
}

/**
 * GitHub's `assignee:` filter, ANDed over every value: a username, `none`
 * (unassigned) or `*` (assigned to anyone).
 */
export function assigneesCondition(
	assignees: string[],
): ThreadCondition | undefined {
	if (assignees.length === 0) return undefined;
	return (table) =>
		and(
			...assignees.map((assignee) => {
				const rows = db
					.select({ one: sql`1` })
					.from(issueAssignees)
					.where(eq(issueAssignees.issueId, table.id));
				if (assignee === "*") return exists(rows);
				if (assignee === "none") return notExists(rows);
				return exists(
					db
						.select({ one: sql`1` })
						.from(issueAssignees)
						.innerJoin(user, eq(user.id, issueAssignees.userId))
						.where(
							and(
								eq(issueAssignees.issueId, table.id),
								eq(user.username, assignee),
							),
						),
				);
			}),
		) as SQL;
}

/**
 * The list's ORDER BY for a `sort:` value. Comment-count sorts count the
 * thread's comments (`commentRef` is `comments.issueId` or
 * `comments.pullRequestId`). Ties fall back to the row id, so a page is
 * deterministic even when timestamps coincide.
 */
export function threadOrderBy(
	sort: SearchSort,
	commentRef: Column,
): (table: SearchableThread) => SQL[] {
	return (table) => {
		const commentsDesc = sql`(select count(*) from ${comments} where ${commentRef} = ${table.id}) desc`;
		const commentsAsc = sql`(select count(*) from ${comments} where ${commentRef} = ${table.id}) asc`;
		switch (sort) {
			case "created-asc":
				return [asc(table.createdAt), asc(table.id)];
			case "updated-desc":
				return [desc(table.updatedAt), desc(table.id)];
			case "updated-asc":
				return [asc(table.updatedAt), asc(table.id)];
			case "comments-desc":
				return [commentsDesc, desc(table.id)];
			case "comments-asc":
				return [commentsAsc, desc(table.id)];
			default:
				return [desc(table.createdAt), desc(table.id)];
		}
	};
}
