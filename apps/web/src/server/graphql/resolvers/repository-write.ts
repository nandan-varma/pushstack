/**
 * Checks shared by the repository mutations (`updateRepository`, the label
 * mutations): the `repo:write` token scope, and loading a repository by its
 * node id with the caller's access. Kept apart from repository.ts so the
 * domain modules that use them do not import each other.
 */
import { eq } from "drizzle-orm";
import { db } from "#/db";
import { type Repository, repositories } from "#/db/app-schema";
import { user } from "#/db/schema";
import { tokenAllows } from "#/lib/token-scopes";
import { oauthScopesHeader } from "../../api/auth";
import {
	getAccessForRepository,
	type RepositoryAccess,
} from "../../repo-access";
import { type PublicUser, publicUserColumns } from "../../repository-lookup";
import type { GraphQLContext } from "../context";
import { forbidden, GitHubGraphQLError, notFound } from "../errors";
import { decodeNodeId, rowIdOfNodeKey } from "../node-id";

/** The classic `repo` scope a write needs; GitHub's wording for the field. */
export function requireRepoScope(ctx: GraphQLContext, field: string) {
	if (!tokenAllows(ctx.caller.scopes, "repo:write")) {
		// The token's classic scopes, as X-OAuth-Scopes reports them.
		const granted = (oauthScopesHeader(ctx.caller.scopes) ?? "")
			.split(", ")
			.filter(Boolean)
			.map((scope) => `'${scope}'`)
			.join(", ");
		throw new GitHubGraphQLError(
			"INSUFFICIENT_SCOPES",
			`Your token has not been granted the required scopes to execute this query. The '${field}' field requires one of the following scopes: ['repo'], but your token has only been granted the: [${granted}] scopes.`,
		);
	}
}

export interface WritableRepository {
	repo: Repository;
	owner: PublicUser;
	access: RepositoryAccess;
}

/**
 * A repository row by id, fresh (never the 5 s cache), with the caller's
 * access. Unreadable and missing are the same NOT_FOUND, as on GitHub.
 */
export async function loadRepositoryById(
	ctx: GraphQLContext,
	repositoryId: string,
): Promise<WritableRepository> {
	const decoded = decodeNodeId(repositoryId);
	const repoId =
		decoded?.type === "Repository" ? rowIdOfNodeKey(decoded.key) : null;
	const notFoundError = () =>
		notFound(
			`Could not resolve to a node with the global id of '${repositoryId}'`,
		);
	if (repoId === null) throw notFoundError();
	const found = await loadRepositoryRow(repoId);
	if (!found) throw notFoundError();
	const access = await getAccessForRepository(found.repo, ctx.caller.userId);
	if (!access.canRead) throw notFoundError();
	return { ...found, access };
}

/** The row and its owner, by id, with no access check. */
export async function loadRepositoryRow(repoId: number) {
	const [found] = await db
		.select({ repo: repositories, owner: publicUserColumns })
		.from(repositories)
		.innerJoin(user, eq(repositories.ownerId, user.id))
		.where(eq(repositories.id, repoId))
		.limit(1);
	return found ?? null;
}

/** Writers only; the message GitHub gives a caller without push access. */
export function requirePushAccess(access: RepositoryAccess) {
	if (!access.canWrite) {
		throw forbidden("Must have push access to Repository.");
	}
}
