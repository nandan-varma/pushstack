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
import { z } from "zod";
import { db } from "#/db";
import { repositories, repositoryCollaborators, stars } from "#/db/app-schema";
import { user } from "#/db/schema";
import { MAX_REPO_DESCRIPTION_CHARS } from "#/lib/limits";
import { STORAGE_NAME_RE } from "#/lib/storage-name";
import {
	GITIGNORE_TEMPLATE_NAMES,
	LICENSE_TEMPLATE_KEYS,
} from "#/lib/templates";
import { perfStep } from "../perf-log";
import {
	createRepositoryForUser,
	RepositoryExistsError,
	repoNameSchema,
} from "../repository-create";
import { type PublicUser, publicUserColumns } from "../repository-lookup";
import { type ApiContext, requireCaller, requireScope } from "./auth";
import {
	apiUrl,
	type FieldError,
	json,
	linkHeader,
	notFoundError,
	type PageParams,
	pageParams,
	readJsonObject,
	validationFailedError,
} from "./http";
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

const sortSchema = z.enum(["created", "updated", "pushed", "full_name"]);
const directionSchema = z.enum(["asc", "desc"]);

/** `sort` / `direction`: GitHub's defaults are name ascending, else newest first. */
function ordering(query: URLSearchParams): SQL[] {
	const sort = sortSchema
		.catch("full_name")
		.parse(query.get("sort") ?? undefined);
	const direction = directionSchema
		.catch(sort === "full_name" ? "asc" : "desc")
		.parse(query.get("direction") ?? undefined);
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
	/** The caller's collaborator row is joined for `/user/repos`. */
	callerId?: string;
}

async function listRepositories(
	url: URL,
	{ where, callerId }: Listing,
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
				.orderBy(...ordering(url.searchParams))
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

const visibilitySchema = z.enum(["all", "public", "private"]);
const affiliationSchema = z.enum([
	"owner",
	"collaborator",
	"organization_member",
]);
const typeSchema = z.enum(["all", "owner", "public", "private", "member"]);

function invalidParam(field: string): never {
	throw validationFailedError("Validation Failed", [
		{ resource: "Repository", field, code: "invalid" },
	]);
}

/** `GET /user/repos`: owned and collaborated repositories, private included. */
export async function listAuthenticatedUserRepositories(ctx: ApiContext) {
	const { userId } = requireCaller(ctx);
	const query = ctx.url.searchParams;
	const visibilityParam = query.get("visibility");
	const affiliationParam = query.get("affiliation");
	const typeParam = query.get("type");
	if (typeParam && (visibilityParam || affiliationParam)) {
		throw validationFailedError(
			"If you specify visibility or affiliation, you cannot specify type.",
			[],
		);
	}

	const type = typeSchema.safeParse(typeParam ?? "all");
	if (!type.success) invalidParam("type");
	const visibility = visibilitySchema.safeParse(
		visibilityParam ??
			(type.data === "public" || type.data === "private" ? type.data : "all"),
	);
	if (!visibility.success) invalidParam("visibility");
	const affiliations = new Set(
		(
			affiliationParam ??
			(type.data === "owner"
				? "owner"
				: type.data === "member"
					? "collaborator"
					: "owner,collaborator")
		).split(","),
	);
	for (const value of affiliations) {
		if (!affiliationSchema.safeParse(value).success)
			invalidParam("affiliation");
	}

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
			where: and(
				// No matching affiliation (e.g. only organization_member) lists nothing.
				affiliated ?? sql`false`,
				visibility.data === "all"
					? undefined
					: eq(repositories.visibility, visibility.data),
			),
		},
		(row) =>
			row.repo.ownerId === userId ? "owner" : (row.collaboratorRole ?? "read"),
	);
}

/** `GET /users/{username}/repos`: the user's public repositories. */
export async function listUserRepositories(ctx: ApiContext) {
	const username = ctx.params.username ?? "";
	if (!STORAGE_NAME_RE.test(username)) throw notFoundError();
	const [owner] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.username, username));
	if (!owner) throw notFoundError();
	return respondWithRepositories(ctx.url, {
		where: and(
			eq(repositories.ownerId, owner.id),
			eq(repositories.visibility, "public"),
		),
	});
}

const createBodySchema = z.object({
	name: repoNameSchema,
	description: z.string().trim().max(MAX_REPO_DESCRIPTION_CHARS).nullish(),
	private: z.boolean().default(false),
	auto_init: z.boolean().default(false),
	gitignore_template: z.enum(GITIGNORE_TEMPLATE_NAMES).optional(),
	license_template: z.enum(LICENSE_TEMPLATE_KEYS).optional(),
});

/** GitHub's `errors[]` for a failed body parse: missing_field vs invalid. */
function bodyErrors(
	error: z.ZodError,
	body: Record<string, unknown>,
): FieldError[] {
	return error.issues.map((issue) => {
		const field = String(issue.path[0] ?? "");
		return {
			resource: "Repository",
			field,
			code: body[field] === undefined ? "missing_field" : "invalid",
		};
	});
}

export async function createAuthenticatedUserRepository(ctx: ApiContext) {
	const { userId } = requireScope(ctx, "repo:write");
	const body = await readJsonObject(ctx.request);
	const parsed = createBodySchema.safeParse(body);
	if (!parsed.success) {
		throw validationFailedError(
			"Repository creation failed.",
			bodyErrors(parsed.error, body),
		);
	}
	const [owner] = await db
		.select({ ...publicUserColumns, email: user.email })
		.from(user)
		.where(eq(user.id, userId));
	if (!owner) throw notFoundError();

	let repo: Awaited<ReturnType<typeof createRepositoryForUser>>;
	try {
		repo = await createRepositoryForUser(owner, {
			name: parsed.data.name,
			description: parsed.data.description ?? undefined,
			visibility: parsed.data.private ? "private" : "public",
			autoInit: parsed.data.auto_init,
			// GitHub applies the templates only together with auto_init.
			gitignoreTemplate: parsed.data.auto_init
				? parsed.data.gitignore_template
				: undefined,
			licenseTemplate: parsed.data.auto_init
				? parsed.data.license_template
				: undefined,
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
