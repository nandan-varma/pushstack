/**
 * GitHub's search API: `GET /search/repositories` and `GET /search/issues`
 * (what `gh search repos|issues|prs` call), answering `total_count`,
 * `incomplete_results` and `items` with each item's `score`.
 *
 * Only repositories the caller can read are searched. The qualifiers that
 * scope a search to repositories (`repo:`, `user:`, `org:`, `owner:`,
 * `is:public|private`, `archived:`, `fork:`) are read here; an issue search
 * hands the rest to the issue/PR query syntax (`#/lib/search-query`), with
 * `state:` and `type:` as their `is:` forms. Any other qualifier is searched
 * as text, so it matches what contains it (usually nothing).
 */
import {
	and,
	asc,
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
import { repositories, stars } from "#/db/app-schema";
import { user } from "#/db/schema";
import { parseSearchQuery } from "#/lib/search-query";
import { containing } from "../db-filters";
import { perfStep } from "../perf-log";
import { readableRepositoriesCondition } from "../repo-access";
import {
	publicUserColumns,
	type RepositoryRowWithOwner,
} from "../repository-lookup";
import { searchFilter, searchSort } from "../thread-search";
import { listThreads, type Thread, type ThreadSort } from "../thread-store";
import type { ApiContext } from "./auth";
import {
	json,
	linkHeader,
	type PageParams,
	pageParams,
	validationFailedError,
} from "./http";
import { queryParams } from "./input";
import { openIssueCounts, starCounts } from "./repos";
import { repository } from "./serializers";
import { serializeThreadsAcross } from "./threads";

/** Every match scores the same: results are ordered, not ranked. */
const SCORE = 1;

/**
 * Whitespace-separated tokens; a double-quoted run keeps its spaces. Advanced
 * search's grouping parentheses and `AND` (gh sends `( text ) repo:o/r`) are
 * dropped: every term is ANDed anyway. `OR` and `NOT` are not supported.
 */
const tokensOf = (q: string) =>
	(q.match(/(?:[^\s"]+|"[^"]*"?)+/g) ?? [])
		.map((token) => token.replace(/^\(+/, "").replace(/\)+$/, ""))
		.filter((token) => token !== "" && token !== "AND");

const unquote = (value: string) =>
	value.length >= 2 && value.startsWith('"') && value.endsWith('"')
		? value.slice(1, -1)
		: value;

interface RepositoryScope {
	/** `repo:owner/name`, `user:`/`org:`/`owner:` names; ORed, as on GitHub. */
	repos: { owner: string; name: string }[];
	owners: string[];
	visibility?: "public" | "private";
	/** A qualifier no PushStack repository can match (`archived:true`, …). */
	matchesNothing: boolean;
	/** `in:name` / `in:description` (repository search). */
	fields: Set<"name" | "description">;
	/** The tokens left for the query syntax. */
	rest: string[];
}

function repositoryScope(q: string): RepositoryScope {
	const scope: RepositoryScope = {
		repos: [],
		owners: [],
		matchesNothing: false,
		fields: new Set(),
		rest: [],
	};
	const visibilities = new Set<"public" | "private">();
	for (const token of tokensOf(q)) {
		const colon = token.indexOf(":");
		const name = colon > 0 ? token.slice(0, colon).toLowerCase() : "";
		const value = unquote(token.slice(colon + 1));
		const lower = value.toLowerCase();
		switch (name) {
			case "repo": {
				const [owner, repo, ...extra] = value.split("/");
				if (owner && repo && extra.length === 0) {
					scope.repos.push({ owner, name: repo });
				} else scope.matchesNothing = true;
				break;
			}
			case "user":
			case "org":
			case "owner":
				scope.owners.push(value);
				break;
			case "archived":
				// No repository is archived.
				if (lower === "true") scope.matchesNothing = true;
				break;
			case "fork":
				// No repository is a fork.
				if (lower === "only") scope.matchesNothing = true;
				break;
			case "in":
				for (const field of lower.split(",")) {
					if (field === "name" || field === "description") {
						scope.fields.add(field);
					}
				}
				break;
			case "is":
				if (lower === "public" || lower === "private") {
					visibilities.add(lower);
				} else scope.rest.push(token);
				break;
			case "state":
				scope.rest.push(`is:${value}`);
				break;
			case "type":
				scope.rest.push(
					`is:${lower === "pr" || lower === "pull-request" ? "pr" : value}`,
				);
				break;
			default:
				scope.rest.push(token);
		}
	}
	if (visibilities.size > 1) scope.matchesNothing = true;
	else scope.visibility = [...visibilities][0];
	return scope;
}

const sameName = (column: SQL | typeof user.username, value: string) =>
	sql`lower(${column}) = lower(${value})`;

/** The repositories `scope` names that the caller may read. */
function repositoryCondition(
	ctx: ApiContext,
	scope: RepositoryScope,
): SQL | undefined {
	if (scope.matchesNothing) return sql`false`;
	const named = [
		...scope.repos.map(
			({ owner, name }) =>
				and(
					sameName(user.username, owner),
					sameName(sql`${repositories.name}`, name),
				) as SQL,
		),
		...scope.owners.map((owner) => sameName(user.username, owner)),
	];
	return and(
		ctx.caller
			? readableRepositoriesCondition(ctx.caller.userId)
			: eq(repositories.visibility, "public"),
		named.length > 0 ? or(...named) : undefined,
		scope.visibility
			? eq(repositories.visibility, scope.visibility)
			: undefined,
	);
}

/** `q` is required: GitHub's 422 names it `missing`. */
function requireQuery(ctx: ApiContext) {
	if (!ctx.url.searchParams.get("q")?.trim()) {
		throw validationFailedError("Validation Failed", [
			{ resource: "Search", field: "q", code: "missing" },
		]);
	}
}

function results<T>(url: URL, params: PageParams, total: number, items: T[]) {
	return json(
		{ total_count: total, incomplete_results: false, items },
		200,
		linkHeader(url, params, total),
	);
}

/** `GET /search/repositories`: name and description text, then the qualifiers above. */
export async function searchRepositories(ctx: ApiContext) {
	requireQuery(ctx);
	const query = queryParams(ctx, "search/repos", "Search");
	const params = pageParams(ctx.url.searchParams);
	const scope = repositoryScope(query.q);
	const fields =
		scope.fields.size > 0 ? scope.fields : new Set(["name", "description"]);
	const terms = scope.rest.map(unquote).filter(Boolean);
	const where = and(
		repositoryCondition(ctx, scope),
		...terms.map((term) =>
			or(
				fields.has("name")
					? ilike(repositories.name, containing(term))
					: undefined,
				fields.has("description")
					? ilike(repositories.description, containing(term))
					: undefined,
			),
		),
	);
	if (!params.reachable) return results(ctx.url, params, 0, []);

	const starCount = sql<number>`(select count(*) from ${stars} where ${stars.repoId} = ${repositories.id})`;
	const order = query.order === "asc" ? asc : desc;
	// Best match (no `sort`): an exact name first, then the most starred.
	const ordering =
		query.sort === "updated"
			? [order(repositories.updatedAt)]
			: query.sort === "stars"
				? [order(starCount)]
				: [
						desc(
							sql`lower(${repositories.name}) in (${sql.join(
								[...terms.map((term) => sql`lower(${term})`), sql`null`],
								sql`, `,
							)})`,
						),
						desc(starCount),
						desc(repositories.updatedAt),
					];
	const [rows, [totalRow]] = await perfStep("db: search repositories", () =>
		Promise.all([
			db
				.select({ repo: repositories, owner: publicUserColumns })
				.from(repositories)
				.innerJoin(user, eq(repositories.ownerId, user.id))
				.where(where)
				.orderBy(...ordering, asc(repositories.id))
				.limit(params.perPage)
				.offset(params.offset),
			db
				.select({ total: count() })
				.from(repositories)
				.innerJoin(user, eq(repositories.ownerId, user.id))
				.where(where),
		]),
	);
	const ids = rows.map((row) => row.repo.id);
	const [stargazers, openIssues] = await Promise.all([
		starCounts(ids),
		openIssueCounts(ids),
	]);
	const items = rows.map((row) => ({
		...repository(
			{ ...row.repo, owner: row.owner },
			{
				stars: stargazers.get(row.repo.id) ?? 0,
				openIssues: openIssues.get(row.repo.id) ?? 0,
			},
		),
		score: SCORE,
	}));
	return results(ctx.url, params, totalRow?.total ?? 0, items);
}

/** GitHub's `sort` + `order` as a thread order; `undefined` keeps the query's `sort:`. */
function threadSort(
	sort: string | undefined,
	order: "asc" | "desc" | undefined,
): ThreadSort | undefined {
	const direction = order ?? "desc";
	if (sort === "created" || sort === "updated") return { by: sort, direction };
	if (sort === "comments")
		return { by: "comments", direction, tiebreak: "desc" };
	// Reactions and interactions aren't ranked: best match (newest first).
	return undefined;
}

/**
 * `GET /search/issues`: issues and pull requests across the repositories the
 * caller can read, in the issue/PR query syntax plus the scope qualifiers.
 */
export async function searchIssuesAndPullRequests(ctx: ApiContext) {
	requireQuery(ctx);
	const query = queryParams(ctx, "search/issues-and-pull-requests", "Search");
	const params = pageParams(ctx.url.searchParams);
	const scope = repositoryScope(query.q);
	const search = parseSearchQuery(scope.rest.join(" "));
	if (search.matchesNothing || !params.reachable) {
		return results(ctx.url, params, 0, []);
	}
	const readable = db
		.select({ id: repositories.id })
		.from(repositories)
		.innerJoin(user, eq(repositories.ownerId, user.id))
		.where(repositoryCondition(ctx, scope));
	const { threads, total } = await perfStep("db: search issues", () =>
		listThreads(
			{
				repoId: sql`${readable}`,
				...(search.type && {
					kind: search.type === "pr" ? "pull_request" : "issue",
				}),
				...(search.status === "open" && { state: "open" }),
				...(search.status === "closed" && { state: "closed" }),
				...(search.status === "merged" && { state: "closed", merged: true }),
				...searchFilter(search),
			},
			{
				sort: threadSort(query.sort, query.order) ?? searchSort(search.sort),
				limit: params.perPage,
				offset: params.offset,
			},
		),
	);
	const items = await serializeAcrossRepositories(threads);
	return results(
		ctx.url,
		params,
		total,
		items.map((item) => ({ ...item, score: SCORE })),
	);
}

/** Issue shapes for threads from many repositories, in the threads' order. */
async function serializeAcrossRepositories(threads: Thread[]) {
	const repoIds = [...new Set(threads.map((thread) => thread.repoId))];
	if (repoIds.length === 0) return [];
	const rows = await db
		.select({ repo: repositories, owner: publicUserColumns })
		.from(repositories)
		.innerJoin(user, eq(repositories.ownerId, user.id))
		.where(inArray(repositories.id, repoIds));
	const repos = new Map<number, RepositoryRowWithOwner>(
		rows.map((row) => [row.repo.id, { ...row.repo, owner: row.owner }]),
	);
	return serializeThreadsAcross(threads, (thread) => {
		const repo = repos.get(thread.repoId);
		if (!repo) throw new Error(`Repository ${thread.repoId} vanished`);
		return repo;
	});
}
