/**
 * Which repositories a cross-repository search spans: the ones the caller can
 * read (public ones for an anonymous caller), narrowed by `repo:` and `user:`
 * qualifiers. Shared by the REST `/search/issues` and the GraphQL `search`.
 * Plain server-only module (not a server-function file).
 */
import { and, eq, exists, inArray, type SQL, sql } from "drizzle-orm";
import { db } from "#/db";
import { issues, repositories } from "#/db/app-schema";
import { user } from "#/db/schema";
import { STORAGE_NAME_RE } from "#/lib/storage-name";
import { canReadRepositoryCondition } from "./repo-access";
import type { PublicUser, RepositoryRowWithOwner } from "./repository-lookup";
import { publicUserColumns } from "./repository-lookup";

/** The repository ids a `user:` login owns (a subquery). */
const ownedBy = (login: string) =>
	db
		.select({ id: repositories.id })
		.from(repositories)
		.innerJoin(user, eq(user.id, repositories.ownerId))
		.where(eq(user.username, login));

/**
 * A condition on `issues.repo_id`: readable by the viewer, and within the
 * `repo:` and `user:` qualifiers (each ANDed). A malformed `repo:` matches
 * nothing rather than erroring here; the caller has already validated shapes.
 */
export function threadScope(
	viewerId: string | null,
	scope: { repos: string[]; owners: string[] },
): SQL {
	const readable = viewerId
		? canReadRepositoryCondition(sql`${viewerId}`, issues.repoId)
		: exists(
				db
					.select({ one: sql`1` })
					.from(repositories)
					.where(
						and(
							eq(repositories.id, issues.repoId),
							eq(repositories.visibility, "public"),
						),
					),
			);
	const parts: (SQL | undefined)[] = [readable];
	for (const repo of scope.repos) {
		const [, owner = "", name = ""] = /^([^/]+)\/([^/]+)$/.exec(repo) ?? [];
		if (!STORAGE_NAME_RE.test(owner) || !STORAGE_NAME_RE.test(name)) {
			parts.push(sql`false`);
			continue;
		}
		parts.push(
			inArray(
				issues.repoId,
				db
					.select({ id: repositories.id })
					.from(repositories)
					.innerJoin(user, eq(user.id, repositories.ownerId))
					.where(and(eq(user.username, owner), eq(repositories.name, name))),
			),
		);
	}
	for (const login of scope.owners) {
		parts.push(
			STORAGE_NAME_RE.test(login)
				? inArray(issues.repoId, ownedBy(login))
				: sql`false`,
		);
	}
	return and(...parts) as SQL;
}

/** Repositories by id with their owners, for serialising results from many repositories. */
export async function repositoriesWithOwner(
	ids: number[],
): Promise<Map<number, RepositoryRowWithOwner>> {
	if (ids.length === 0) return new Map();
	const rows = await db
		.select({ repo: repositories, owner: publicUserColumns })
		.from(repositories)
		.innerJoin(user, eq(user.id, repositories.ownerId))
		.where(inArray(repositories.id, ids));
	return new Map(
		rows.map((row) => [
			row.repo.id,
			{ ...row.repo, owner: row.owner as PublicUser },
		]),
	);
}
