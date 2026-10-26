/**
 * `GET /search/repositories` and `GET /search/issues` (issues and pull
 * requests), over the query syntaxes in `#/lib/repository-search-query` and
 * `#/lib/search-query`. A qualifier or value the search does not serve is a
 * 422 naming it, never a silently wider or empty answer.
 */
import { eq } from "drizzle-orm";
import { db } from "#/db";
import { user } from "#/db/schema";
import {
	parseRepositorySearchQuery,
	UnservedQuery,
} from "#/lib/repository-search-query";
import {
	parseSearchQuery,
	splitScopeQualifiers,
	unservedQualifier,
} from "#/lib/search-query";
import { repositorySearchWhere } from "../repository-search";
import { repositoriesWithOwner, threadScope } from "../search-scope";
import { searchFilter, searchSort } from "../thread-search";
import { listThreads, type ThreadSort } from "../thread-store";
import type { ApiContext } from "./auth";
import { json, linkHeader, pageParams, validationFailedError } from "./http";
import { queryParams } from "./input";
import { listRepositories, repositoryShapes } from "./repos";
import type { Shape } from "./serializers";
import { serializeThreads } from "./threads";

/** A query the search refuses, as GitHub's 422 `Validation Failed` names the field. */
function refused(error: unknown): never {
	if (error instanceof UnservedQuery) {
		throw validationFailedError("Validation Failed", [
			{
				resource: "Search",
				field: "q",
				code: "invalid",
				message: error.message,
			},
		]);
	}
	throw error;
}

/** `GET /search/repositories`: newest-updated first (no best-match ranking). */
export async function searchRepositoriesHandler(ctx: ApiContext) {
	const { q, order } = queryParams(ctx, "search/repos", "Repository");
	let query: ReturnType<typeof parseRepositorySearchQuery>;
	try {
		query = parseRepositorySearchQuery(q);
	} catch (error) {
		refused(error);
	}
	const viewer = ctx.caller?.userId ?? null;
	const where = repositorySearchWhere(query, viewer);
	const { rows, params, total } = await listRepositories(ctx.url, {
		where,
		order: { sort: "updated", direction: order ?? "desc" },
	});
	return json(
		{
			total_count: total,
			incomplete_results: false,
			items: await repositoryShapes(rows, undefined, viewer),
		},
		200,
		linkHeader(ctx.url, params, total),
	);
}

/** `GET /search/issues`: issues and pull requests across the readable repositories. */
export async function searchIssuesHandler(ctx: ApiContext) {
	const { q, sort, order } = queryParams(
		ctx,
		"search/issues-and-pull-requests",
		"Issue",
	);
	const viewer = ctx.caller?.userId ?? null;
	const params = pageParams(ctx.url.searchParams);
	let query: ReturnType<typeof parseSearchQuery>;
	let scope: ReturnType<typeof splitScopeQualifiers>;
	try {
		scope = splitScopeQualifiers(q);
		if (scope.repos.length > 1 || scope.owners.length > 1) {
			throw new UnservedQuery(
				"Only one repo: and one user: qualifier is served",
			);
		}
		const unserved = unservedQualifier(scope.rest);
		if (unserved) {
			throw new UnservedQuery(`The search qualifier ${unserved} is not served`);
		}
		query = parseSearchQuery(scope.rest);
	} catch (error) {
		refused(error);
	}
	const [viewerRow] = viewer
		? await db
				.select({ username: user.username })
				.from(user)
				.where(eq(user.id, viewer))
		: [];
	const found = query.matchesNothing
		? { threads: [], total: 0 }
		: await (async () => {
				const filter = {
					repoScope: threadScope(viewer, scope),
					kind:
						query.type === "pr"
							? ("pull_request" as const)
							: query.type === "issue"
								? ("issue" as const)
								: undefined,
					state:
						query.status === "open"
							? ("open" as const)
							: query.status === "closed" || query.status === "merged"
								? ("closed" as const)
								: undefined,
					merged: query.status === "merged" ? true : undefined,
					...searchFilter(query, viewerRow?.username),
				};
				// `sort` and `order` as the REST API names them; the `sort:` qualifier otherwise.
				const threadSort: ThreadSort = sort
					? { by: sort, direction: order ?? "desc" }
					: searchSort(query.sort);
				const total = (
					await listThreads(filter, { limit: 1, sort: threadSort })
				).total;
				if (!params.reachable || total === 0) {
					return { threads: [], total };
				}
				const { threads } = await listThreads(filter, {
					limit: params.perPage,
					offset: params.offset,
					sort: threadSort,
				});
				return { threads, total };
			})();
	const repos = await repositoriesWithOwner([
		...new Set(found.threads.map((thread) => thread.repoId)),
	]);
	const shapes = new Map<number, Shape<"issue">>();
	for (const [repoId, repo] of repos) {
		const threads = found.threads.filter((thread) => thread.repoId === repoId);
		for (const shape of await serializeThreads(repo, threads)) {
			shapes.set(shape.id, shape);
		}
	}
	// A result whose repository did not load is a failure, not a null item.
	const items = found.threads.map((thread) => {
		const shape = shapes.get(thread.id);
		if (!shape) throw new Error("Search result repository missing");
		return shape;
	});
	return json(
		{ total_count: found.total, incomplete_results: false, items },
		200,
		linkHeader(ctx.url, params, found.total),
	);
}
