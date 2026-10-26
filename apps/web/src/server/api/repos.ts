import {
	and,
	asc,
	count,
	desc,
	eq,
	exists,
	gte,
	inArray,
	isNotNull,
	lt,
	ne,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { GitInvalidRequestError, isNotFoundError } from "git-fs-s3";
import { db } from "#/db";
import {
	issues,
	repositories,
	repositoryCollaborators,
	stars,
} from "#/db/app-schema";
import { user } from "#/db/schema";
import { isHttpUrl } from "#/lib/homepage";
import { MAX_REPO_TOPICS } from "#/lib/limits";
import { STORAGE_NAME_RE } from "#/lib/storage-name";
import {
	GITIGNORE_TEMPLATE_NAMES,
	LICENSE_TEMPLATE_KEYS,
} from "#/lib/templates";
import { parseTopics } from "#/lib/topics";
import { ArchiveLimitError } from "../git-read";
import { safeBranchNameSchema } from "../git-ref-name";
import { perfStep } from "../perf-log";
import { ARCHIVED_MESSAGE, getAccessForRepository } from "../repo-access";
import {
	createRepositoryForUser,
	generateRepositoryFromTemplate,
	RepositoryExistsError,
} from "../repository-create";
import {
	findRepositoryByName,
	type PublicUser,
	publicUserColumns,
	publicUserFields,
} from "../repository-lookup";
import {
	ArchivedRepositoryError,
	deleteRepositoryAndStorage,
	InvalidHomepageError,
	NoMergeMethodError,
	RepositoryNameTakenError,
	transferRepository,
	updateRepositorySettings,
} from "../repository-settings";
import { watcherCounts } from "../watch-store";
import { type ApiContext, requireCaller, requireScope } from "./auth";
import {
	apiUrl,
	forbiddenError,
	json,
	linkHeader,
	noContent,
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

/** GitHub counts open issues and pull requests together; one query for the page. */
export async function openIssueCounts(
	repoIds: number[],
): Promise<Map<number, number>> {
	if (repoIds.length === 0) return new Map();
	const rows = await perfStep("db: repository open issue counts", () =>
		db
			.select({ repoId: issues.repoId, total: count() })
			.from(issues)
			.where(and(inArray(issues.repoId, repoIds), eq(issues.status, "open")))
			.groupBy(issues.repoId),
	);
	return new Map(rows.map((row) => [row.repoId, row.total]));
}

export async function getRepository(ctx: ApiContext) {
	const { repo, access } = await readableRepository(ctx);
	const [stargazers, openIssues, watchers] = await Promise.all([
		starCounts([repo.id]),
		openIssueCounts([repo.id]),
		watcherCounts([repo.id]),
	]);
	return json(
		repository(repo, {
			stars: stargazers.get(repo.id) ?? 0,
			openIssues: openIssues.get(repo.id) ?? 0,
			subscribers: watchers.get(repo.id) ?? 0,
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

export interface Listing {
	where: SQL | undefined;
	order: Order;
	/** The caller's collaborator row is joined for `/user/repos`. */
	callerId?: string;
}

export async function listRepositories(
	url: URL,
	{ where, callerId, order }: Listing,
): Promise<{ rows: Row[]; params: PageParams; total: number }> {
	const params = pageParams(url.searchParams);
	const collaboratorJoin = and(
		eq(repositoryCollaborators.repoId, repositories.id),
		eq(repositoryCollaborators.userId, callerId ?? ""),
	);
	// Past the skip bound the page is empty, but the total is still the real one.
	if (!params.reachable) {
		// The same join as the page query: 'where' may name the collaborator row.
		const [totalRow] = await db
			.select({ total: count() })
			.from(repositories)
			.leftJoin(repositoryCollaborators, collaboratorJoin)
			.where(where);
		return { rows: [], params, total: totalRow?.total ?? 0 };
	}
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

export type Row = {
	repo: typeof repositories.$inferSelect;
	owner: PublicUser;
	collaboratorRole: "read" | "write" | "admin" | null;
};

/** Repository shapes for listed rows, with their star and open issue counts. */
export async function repositoryShapes(
	rows: Row[],
	roleOf?: (row: Row) => RepoRole,
) {
	const repoIds = rows.map((row) => row.repo.id);
	const [stargazers, openIssues] = await Promise.all([
		starCounts(repoIds),
		openIssueCounts(repoIds),
	]);
	return rows.map((row) =>
		repository(
			{ ...row.repo, owner: row.owner },
			{
				stars: stargazers.get(row.repo.id) ?? 0,
				openIssues: openIssues.get(row.repo.id) ?? 0,
				role: roleOf?.(row),
			},
		),
	);
}

async function respondWithRepositories(
	url: URL,
	listing: Listing,
	roleOf?: (row: Row) => RepoRole,
) {
	const { rows, params, total } = await listRepositories(url, listing);
	return json(
		await repositoryShapes(rows, roleOf),
		200,
		linkHeader(url, params, total),
	);
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
				// `since` and `before` bound the last update, as GitHub's do.
				query.since
					? gte(repositories.updatedAt, new Date(query.since))
					: undefined,
				query.before
					? lt(repositories.updatedAt, new Date(query.before))
					: undefined,
			),
		},
		(row) =>
			row.repo.ownerId === userId ? "owner" : (row.collaboratorRole ?? "read"),
	);
}

/** `GET /users/{username}/repos`: the user's public repositories. */
export async function listUserRepositories(ctx: ApiContext) {
	const { username } = pathParams(ctx, "repos/list-for-user");
	if (!STORAGE_NAME_RE.test(username)) throw notFoundError();
	const order = queryParams(ctx, "repos/list-for-user", "Repository");
	const [owner] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.username, username));
	if (!owner) throw notFoundError();
	const ownedBy = eq(repositories.ownerId, owner.id);
	// `member`: repositories the user collaborates on, owned by someone else.
	const collaboratedBy = and(
		ne(repositories.ownerId, owner.id),
		exists(
			db
				.select({ id: repositoryCollaborators.id })
				.from(repositoryCollaborators)
				.where(
					and(
						eq(repositoryCollaborators.repoId, repositories.id),
						eq(repositoryCollaborators.userId, owner.id),
					),
				),
		),
	);
	const type = order.type ?? "owner";
	return respondWithRepositories(ctx.url, {
		order,
		where: and(
			type === "owner"
				? ownedBy
				: type === "member"
					? collaboratedBy
					: or(ownedBy, collaboratedBy),
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

	if (data.homepage && !isHttpUrl(data.homepage)) {
		throw validationFailedError("Repository creation failed.", [
			{ resource: "Repository", field: "homepage", code: "invalid" },
		]);
	}
	let repo: Awaited<ReturnType<typeof createRepositoryForUser>>;
	try {
		repo = await createRepositoryForUser(owner, {
			name: data.name,
			description: data.description ?? undefined,
			homepage: data.homepage || undefined,
			visibility: data.private ? "private" : "public",
			autoInit: data.auto_init,
			hasIssues: data.has_issues,
			hasWiki: data.has_wiki,
			hasProjects: data.has_projects,
			isTemplate: data.is_template,
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
		repository({ ...repo, owner }, { stars: 0, openIssues: 0, role: "owner" }),
		201,
		{ Location: apiUrl(`/repos/${owner.username}/${repo.name}`) },
	);
}

const adminDenied = () =>
	forbiddenError("Must have admin rights to Repository.");

/** The repository for an owner/admin-only change, fresh from the database. */
async function adminRepository(
	ctx: ApiContext,
	scope: "repo:write",
	roles: ReadonlyArray<"owner" | "admin"> = ["owner", "admin"],
) {
	requireScope(ctx, scope);
	// Unarchiving, and everything that explains why it can't be done, runs here.
	const { repo, access } = await readableRepository(ctx, {
		allowArchivedWrites: true,
	});
	if (!roles.some((role) => role === access.role)) throw adminDenied();
	// Changes act on the row as it is now, not a cached copy up to 5 s old.
	const fresh = await db.query.repositories.findFirst({
		where: { id: repo.id },
		with: { owner: publicUserFields },
	});
	if (!fresh) throw notFoundError();
	return { repo: fresh, access };
}

async function respondWithRepository(
	_ctx: ApiContext,
	repo: Awaited<ReturnType<typeof readableRepository>>["repo"],
	role: RepoRole,
	status = 200,
) {
	const [stargazers, openIssues] = await Promise.all([
		starCounts([repo.id]),
		openIssueCounts([repo.id]),
	]);
	return json(
		repository(repo, {
			stars: stargazers.get(repo.id) ?? 0,
			openIssues: openIssues.get(repo.id) ?? 0,
			role,
		}),
		status,
	);
}

const mapSettingsError = (error: unknown): never => {
	if (error instanceof ArchivedRepositoryError) {
		throw forbiddenError(ARCHIVED_MESSAGE);
	}
	if (error instanceof NoMergeMethodError) {
		throw validationFailedError("Validation Failed", [
			{
				resource: "Repository",
				code: "custom",
				message: "At least one merge type must be enabled.",
			},
		]);
	}
	if (error instanceof InvalidHomepageError) {
		throw validationFailedError("Validation Failed", [
			{ resource: "Repository", field: "homepage", code: "invalid" },
		]);
	}
	if (error instanceof RepositoryNameTakenError) {
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
};

/** `PATCH /repos/{owner}/{repo}`. */
export async function updateRepositoryHandler(ctx: ApiContext) {
	const { repo, access } = await adminRepository(ctx, "repo:write");
	const data = await requestBody(ctx, "repos/update", "Repository");
	const visibility =
		data.visibility ??
		(data.private === undefined
			? undefined
			: data.private
				? "private"
				: "public");
	if (
		data.visibility !== undefined &&
		data.private !== undefined &&
		(data.private ? "private" : "public") !== data.visibility
	) {
		throw validationFailedError("Invalid request.", [
			{
				resource: "Repository",
				field: "visibility",
				code: "invalid",
				message: "visibility conflicts with private",
			},
		]);
	}
	if (data.default_branch !== undefined) {
		const parsed = safeBranchNameSchema.safeParse(data.default_branch);
		if (!parsed.success) {
			throw validationFailedError("Validation Failed", [
				{ resource: "Repository", field: "default_branch", code: "invalid" },
			]);
		}
	}
	try {
		const updated = await updateRepositorySettings(repo, {
			name: data.name,
			description: data.description,
			homepage: data.homepage,
			visibility,
			defaultBranch: data.default_branch,
			archived: data.archived,
			isTemplate: data.is_template,
			hasIssues: data.has_issues,
			hasWiki: data.has_wiki,
			allowMergeCommit: data.allow_merge_commit,
			allowSquashMerge: data.allow_squash_merge,
			allowRebaseMerge: data.allow_rebase_merge,
			hasProjects: data.has_projects,
		});
		return respondWithRepository(
			ctx,
			{ ...updated, owner: repo.owner },
			access.role === "owner" ? "owner" : "admin",
		);
	} catch (error) {
		if (isNotFoundError(error) || error instanceof GitInvalidRequestError) {
			throw validationFailedError("Validation Failed", [
				{
					resource: "Repository",
					field: "default_branch",
					code: "invalid",
					message: "branch does not exist",
				},
			]);
		}
		return mapSettingsError(error);
	}
}

/** `DELETE /repos/{owner}/{repo}`. */
export async function deleteRepositoryHandler(ctx: ApiContext) {
	const { repo } = await adminRepository(ctx, "repo:write", ["owner"]);
	await deleteRepositoryAndStorage(repo);
	return noContent();
}

/** `GET /repos/{owner}/{repo}/topics`. */
export async function getTopics(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const params = pageParams(ctx.url.searchParams);
	const names = params.reachable
		? repo.topics.slice(params.offset, params.offset + params.perPage)
		: [];
	return json({ names }, 200, linkHeader(ctx.url, params, repo.topics.length));
}

/** `PUT /repos/{owner}/{repo}/topics`. */
export async function replaceTopics(ctx: ApiContext) {
	const { repo } = await adminRepository(ctx, "repo:write");
	const { names } = await requestBody(
		ctx,
		"repos/replace-all-topics",
		"Repository",
	);
	const { topics, invalid, tooMany } = parseTopics(names);
	if (invalid.length > 0 || tooMany) {
		throw validationFailedError(
			invalid.length > 0
				? `Invalid topic: ${invalid[0]}. Topics must start with a lowercase letter or number, consist of 50 characters or less, and can include hyphens.`
				: `Too many topics: a repository can have at most ${MAX_REPO_TOPICS}.`,
			[{ resource: "Repository", field: "names", code: "invalid" }],
		);
	}
	try {
		await updateRepositorySettings(repo, { topics });
	} catch (error) {
		mapSettingsError(error);
	}
	return json({ names: topics });
}

/** `POST /repos/{owner}/{repo}/transfer`. */
export async function transferRepositoryHandler(ctx: ApiContext) {
	const { repo } = await adminRepository(ctx, "repo:write", ["owner"]);
	const data = await requestBody(ctx, "repos/transfer", "Repository");
	const target = await db.query.user.findFirst({
		columns: { id: true, apiId: true, username: true, name: true, image: true },
		where: { username: data.new_owner },
	});
	if (!target) {
		throw validationFailedError("Validation Failed", [
			{ resource: "Repository", field: "new_owner", code: "invalid" },
		]);
	}
	try {
		const updated = await transferRepository(repo, target, data.new_name);
		return respondWithRepository(
			ctx,
			{ ...updated, owner: target },
			"owner",
			202,
		);
	} catch (error) {
		return mapSettingsError(error);
	}
}

/** `POST /repos/{template_owner}/{template_repo}/generate`. */
export async function generateFromTemplate(ctx: ApiContext) {
	const { userId } = requireScope(ctx, "repo:write");
	const { template_owner, template_repo } = pathParams(
		ctx,
		"repos/create-using-template",
	);
	if (
		!STORAGE_NAME_RE.test(template_owner) ||
		!STORAGE_NAME_RE.test(template_repo)
	) {
		throw notFoundError();
	}
	const template = await findRepositoryByName(template_owner, template_repo);
	if (!template) throw notFoundError();
	const access = await getAccessForRepository(template, userId);
	if (!access.canRead || !template.isTemplate) throw notFoundError();
	const data = await requestBody(
		ctx,
		"repos/create-using-template",
		"Repository",
		{ message: "Repository creation failed." },
	);
	const [owner] = await db
		.select({ ...publicUserColumns, email: user.email })
		.from(user)
		.where(eq(user.id, userId));
	if (!owner) throw notFoundError();
	if (data.owner !== undefined && data.owner !== owner.username) {
		throw validationFailedError("Repository creation failed.", [
			{ resource: "Repository", field: "owner", code: "invalid" },
		]);
	}
	let repo: Awaited<ReturnType<typeof generateRepositoryFromTemplate>>;
	try {
		repo = await generateRepositoryFromTemplate(template, owner, {
			name: data.name,
			description: data.description ?? undefined,
			visibility: data.private ? "private" : "public",
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
		if (error instanceof ArchiveLimitError) {
			throw validationFailedError("Repository creation failed.", [
				{
					resource: "Repository",
					code: "custom",
					message: error.message,
				},
			]);
		}
		throw error;
	}
	return json(
		repository({ ...repo, owner }, { stars: 0, openIssues: 0, role: "owner" }),
		201,
		{ Location: apiUrl(`/repos/${owner.username}/${repo.name}`) },
	);
}
