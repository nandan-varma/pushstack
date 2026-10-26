/**
 * Repository search over the query syntax in `#/lib/repository-search-query`:
 * the condition (readable by the viewer, then the words, owner, visibility and
 * topics) and one page of rows with their totals. Shared by the REST
 * `/search/repositories` and the GraphQL `search`. Plain server-only module.
 */
import {
	and,
	count,
	desc,
	eq,
	ilike,
	inArray,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { db } from "#/db";
import { repositories } from "#/db/app-schema";
import { user } from "#/db/schema";
import type { RepositorySearchQuery } from "#/lib/repository-search-query";
import { containing } from "./db-filters";
import { readableRepositoriesCondition } from "./repo-access";
import {
	publicUserColumns,
	type RepositoryRowWithOwner,
} from "./repository-lookup";

/** The repositories a parsed query matches, for `viewerId` (null: anonymous). */
export function repositorySearchWhere(
	query: RepositorySearchQuery,
	viewerId: string | null,
): SQL {
	if (query.matchesNothing) return sql`false`;
	return and(
		viewerId
			? readableRepositoriesCondition(viewerId)
			: eq(repositories.visibility, "public"),
		...query.terms.map((term) =>
			or(
				ilike(repositories.name, containing(term)),
				ilike(repositories.description, containing(term)),
			),
		),
		query.owner === undefined
			? undefined
			: inArray(
					repositories.ownerId,
					db
						.select({ id: user.id })
						.from(user)
						.where(eq(user.username, query.owner)),
				),
		query.visibility === undefined
			? undefined
			: eq(repositories.visibility, query.visibility),
		...query.topics.map(
			(topic) =>
				sql`${repositories.topics} @> ${JSON.stringify([topic])}::jsonb`,
		),
	) as SQL;
}

/** One page of matching repositories, newest-updated first, and the total. */
export async function findRepositorySearchPage(
	where: SQL,
	{ limit, offset }: { limit: number; offset: number },
): Promise<{ rows: RepositoryRowWithOwner[]; total: number }> {
	const [rows, [totalRow]] = await Promise.all([
		db
			.select({ repo: repositories, owner: publicUserColumns })
			.from(repositories)
			.innerJoin(user, eq(user.id, repositories.ownerId))
			.where(where)
			.orderBy(desc(repositories.updatedAt), desc(repositories.id))
			.limit(limit)
			.offset(offset),
		db.select({ total: count() }).from(repositories).where(where),
	]);
	return {
		rows: rows.map((row) => ({ ...row.repo, owner: row.owner })),
		total: totalRow?.total ?? 0,
	};
}
