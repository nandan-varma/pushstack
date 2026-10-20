import {
	and,
	asc,
	count,
	desc,
	eq,
	inArray,
	isNotNull,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { db } from "#/db";
import { repositories, repositoryCollaborators, stars } from "#/db/app-schema";
import { user } from "#/db/schema";
import {
	GITIGNORE_TEMPLATE_NAMES,
	LICENSE_TEMPLATE_KEYS,
} from "#/lib/templates";
import { perfStep } from "../perf-log";
import {
	createRepositoryForUser,
	RepositoryExistsError,
} from "../repository-create";
import { type PublicUser, publicUserColumns } from "../repository-lookup";
import { type ApiContext, requireCaller, requireScope } from "./auth";
import {
	apiUrl,
	json,
	linkHeader,
	notFoundError,
	type PageParams,
	pageParams,
	validationFailedError,
} from "./http";
import { pathParams, queryParams, requestBody } from "./input";
import { readableRepository } from "./repo-lookup";
import { type RepoRole, repository } from "./serializers";

export async function starCounts(
	repoIds: number[],
): Promise<Map<number, number>> {
	if (repoIds.length === 0) return new Map();
	const rows = await db
		.select({ repoId: stars.repoId, total: count() })
		.from(stars)
		.where(inArray(stars.repoId, repoIds))
		.groupBy(stars.repoId);
	return new Map(rows.map((row) => [row.repoId, row.total]));
}

export async function getRepository(ctx: ApiContext) {
	const { repo, access } = await readableRepository(ctx);
	const stargazers = await starCounts([repo.id]);
	return json(
		repository(repo, {
			stars: stargazers.get(repo.id) ?? 0,
			role: ctx.caller ? access.role : undefined,
		}),
	);
}

interface Order {
	sort?: "created" | "updated" | "pushed" | "full_name";
	direction?: "asc" | "desc";
}

/** `sort` / `direction`: GitHub's defaults are name ascending, else newest first. */
function ordering(order: Order): SQL[] {
	const sort = order.sort ?? "full_name";
	const direction = order.direction ?? (sort === "full_name" ? "asc" : "desc");
	const column =
		sort === "created"
			? repositories.createdAt
			: sort === "full_name"
				? sql`lower(${user.username} || '/' || ${repositories.name})`
				: // No separate push timestamp yet: updated_at is the closest.
					repositories.updatedAt;
	return [
		direction === "asc" ? asc(column) : desc(column),
		asc(repositories.id),
	];
}

interface Listing {
	where: SQL | undefined;
	order: Order;
	/** The caller's collaborator row is joined for `/user/repos`. */
	callerId?: string;
}

async function listRepositories(
	url: URL,
	{ where, callerId, order }: Listing,
): Promise<{ rows: Row[]; params: PageParams; total: number }> {
	const params = pageParams(url.searchParams);
	const collaboratorJoin = and(
		eq(repositoryCollaborators.repoId, repositories.id),
		eq(repositoryCollaborators.userId, callerId ?? ""),
	);
	if (!params.reachable) return { rows: [], params, total: 0 };
	const [rows, [totalRow]] = await perfStep("db: list repositories", () =>
		Promise.all([
			db
				.select({
					repo: repositories,
					owner: publicUserColumns,
					collaboratorRole: repositoryCollaborators.role,
				})
				.from(repositories)
				.innerJoin(user, eq(repositories.ownerId, user.id))
				.leftJoin(repositoryCollaborators, collaboratorJoin)
				.where(where)
				.orderBy(...ordering(order))
				.limit(params.perPage)
				.offset(params.offset),
			db
				.select({ total: count() })
				.from(repositories)
				.leftJoin(repositoryCollaborators, collaboratorJoin)
				.where(where),
		]),
	);
	return { rows, params, total: totalRow?.total ?? 0 };
}

type Row = {
	repo: typeof repositories.$inferSelect;
	owner: PublicUser;
	collaboratorRole: "read" | "write" | "admin" | null;
};

async function respondWithRepositories(
	url: URL,
	listing: Listing,
	roleOf?: (row: Row) => RepoRole,
) {
	const { rows, params, total } = await listRepositories(url, listing);
	const stargazers = await starCounts(rows.map((row) => row.repo.id));
	const body = rows.map((row) =>
		repository(
			{ ...row.repo, owner: row.owner },
			{ stars: stargazers.get(row.repo.id) ?? 0, role: roleOf?.(row) },
		),
	);
	return json(body, 200, linkHeader(url, params, total));
}

/** `GET /user/repos`: owned and collaborated repositories, private included. */
export async function listAuthenticatedUserRepositories(ctx: ApiContext) {
	const { userId } = requireCaller(ctx);
	const raw = ctx.url.searchParams;
	if (raw.get("type") && (raw.get("visibility") || raw.get("affiliation"))) {
		throw validationFailedError(
			"If you specify visibility or affiliation, you cannot specify type.",
			[],
		);
	}

	const query = queryParams(
		ctx,
		"repos/list-for-authenticated-user",
		"Repository",
	);
	const type = query.type ?? "all";
	const visibility =
		query.visibility ??
		(type === "public" || type === "private" ? type : "all");
	const affiliations = new Set<string>(
		query.affiliation ??
			(type === "owner"
				? ["owner"]
				: type === "member"
					? ["collaborator"]
					: ["owner", "collaborator"]),
	);

	const owned = eq(repositories.ownerId, userId);
	const collaborated = isNotNull(repositoryCollaborators.userId);
	const affiliated = or(
		affiliations.has("owner") ? owned : undefined,
		affiliations.has("collaborator") ? collaborated : undefined,
	);
	return respondWithRepositories(
		ctx.url,
		{
			callerId: userId,
			order: query,
			where: and(
				// No matching affiliation (e.g. only organization_member) lists nothing.
				affiliated ?? sql`false`,
				visibility === "all"
					? undefined
					: eq(repositories.visibility, visibility),
			),
		},
		(row) =>
			row.repo.ownerId === userId ? "owner" : (row.collaboratorRole ?? "read"),
	);
}

/** `GET /users/{username}/repos`: the user's public repositories. */
export async function listUserRepositories(ctx: ApiContext) {
	const { username } = pathParams(ctx, "repos/list-for-user");
	const order = queryParams(ctx, "repos/list-for-user", "Repository");
	const [owner] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.username, username));
	if (!owner) throw notFoundError();
	return respondWithRepositories(ctx.url, {
		order,
		where: and(
			eq(repositories.ownerId, owner.id),
			eq(repositories.visibility, "public"),
		),
	});
}

const TEMPLATES = {
	gitignore_template: GITIGNORE_TEMPLATE_NAMES,
	license_template: LICENSE_TEMPLATE_KEYS,
} as const;

const isTemplate = (known: readonly string[], value: string) =>
	known.includes(value);

export async function createAuthenticatedUserRepository(ctx: ApiContext) {
	const { userId } = requireScope(ctx, "repo:write");
	const data = await requestBody(
		ctx,
		"repos/create-for-authenticated-user",
		"Repository",
		{ message: "Repository creation failed." },
	);
	// The contract takes any template name; only ours exist.
	const unknown = (["gitignore_template", "license_template"] as const).filter(
		(field) =>
			data[field] !== undefined && !isTemplate(TEMPLATES[field], data[field]),
	);
	if (unknown.length > 0) {
		throw validationFailedError(
			"Repository creation failed.",
			unknown.map((field) => ({
				resource: "Repository",
				field,
				code: "invalid",
			})),
		);
	}
	const gitignoreTemplate = data.gitignore_template as
		| (typeof GITIGNORE_TEMPLATE_NAMES)[number]
		| undefined;
	const licenseTemplate = data.license_template as
		| (typeof LICENSE_TEMPLATE_KEYS)[number]
		| undefined;
	const [owner] = await db
		.select({ ...publicUserColumns, email: user.email })
		.from(user)
		.where(eq(user.id, userId));
	if (!owner) throw notFoundError();

	let repo: Awaited<ReturnType<typeof createRepositoryForUser>>;
	try {
		repo = await createRepositoryForUser(owner, {
			name: data.name,
			description: data.description ?? undefined,
			visibility: data.private ? "private" : "public",
			autoInit: data.auto_init,
			// GitHub applies the templates only together with auto_init.
			gitignoreTemplate: data.auto_init ? gitignoreTemplate : undefined,
			licenseTemplate: data.auto_init ? licenseTemplate : undefined,
		});
	} catch (error) {
		if (error instanceof RepositoryExistsError) {
			throw validationFailedError("Repository creation failed.", [
				{
					resource: "Repository",
					code: "custom",
					field: "name",
					message: "name already exists on this account",
				},
			]);
		}
		throw error;
	}
	return json(
		repository({ ...repo, owner }, { stars: 0, role: "owner" }),
		201,
		{ Location: apiUrl(`/repos/${owner.username}/${repo.name}`) },
	);
}
