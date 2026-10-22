/**
 * Repository domain: `repository`, `repositoryOwner`, `user`, the
 * `Repository` type, `User.repositories`/`User.repository` and the
 * `createRepository` mutation. Permissions come from repo-access.ts; a
 * repository the caller can't read is null plus a NOT_FOUND error, as on
 * GitHub.
 */
import {
	and,
	asc,
	count,
	desc,
	eq,
	exists,
	inArray,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { db } from "#/db";
import {
	type Repository,
	repositories,
	repositoryCollaborators,
	stars,
} from "#/db/app-schema";
import { user } from "#/db/schema";
import { STORAGE_NAME_RE } from "#/lib/storage-name";
import { tokenAllows } from "#/lib/token-scopes";
import { oauthScopesHeader } from "../../api/auth";
import { htmlUrl, isoTimestamp } from "../../api/http";
import { starCounts } from "../../api/repos";
import { getBranches } from "../../git-read";
import { ownerKeyOf } from "../../git-storage-naming";
import {
	getAccessForRepository,
	readableRepositoriesCondition,
} from "../../repo-access";
import {
	createRepositoryForUser,
	RepositoryExistsError,
	repoNameSchema,
} from "../../repository-create";
import {
	findRepositoryByName,
	type PublicUser,
	publicUserColumns,
} from "../../repository-lookup";
import { type ConnectionArgs, offsetConnection } from "../connection";
import type { GraphQLContext } from "../context";
import {
	GitHubGraphQLError,
	notFound,
	repositoryNotFound,
	unprocessable,
} from "../errors";
import { decodeNodeId, encodeNodeId, rowIdOfNodeKey } from "../node-id";
import { loadUser, loadUserByLogin, type UserNode, userNode } from "./core";
import type { DomainResolvers, NodeLoader } from "./types";

type Role = "owner" | "admin" | "write" | "read" | "anonymous";
type RepoRow = Repository & { owner: PublicUser };

export interface RepositoryNode {
	__typename: "Repository";
	id: string;
	databaseId: number;
	name: string;
	nameWithOwner: string;
	description: string | null;
	url: string;
	resourcePath: string;
	createdAt: string;
	updatedAt: string;
	/** Not tracked yet: GitHub's value for a repository never pushed to. */
	pushedAt: null;
	archivedAt: null;
	isPrivate: boolean;
	visibility: "PUBLIC" | "PRIVATE";
	// Facts of PushStack, not defaults: there are no forks, templates,
	// mirrors, archives, locks, organizations, wikis, projects or
	// discussions, and issues are always on.
	isFork: false;
	isTemplate: false;
	isMirror: false;
	mirrorUrl: null;
	isArchived: false;
	isLocked: false;
	isInOrganization: false;
	hasIssuesEnabled: true;
	hasWikiEnabled: false;
	hasProjectsEnabled: false;
	hasDiscussionsEnabled: false;
	homepageUrl: null;
	parent: null;
	templateRepository: null;
	forkCount: 0;
	// git-write.ts's mergeBranches: fast-forward or a merge commit only.
	mergeCommitAllowed: true;
	squashMergeAllowed: false;
	rebaseMergeAllowed: false;
	deleteBranchOnMerge: false;
	sshUrl: string;
	/** Internal: the row and the caller's role, for the computed fields. */
	row: RepoRow;
	role: Role;
}

export function repositoryNode(row: RepoRow, role: Role): RepositoryNode {
	const fullName = `${row.owner.username}/${row.name}`;
	const host = new URL(htmlUrl("/")).host;
	return {
		__typename: "Repository",
		id: encodeNodeId("Repository", row.id),
		databaseId: row.id,
		name: row.name,
		nameWithOwner: fullName,
		description: row.description,
		url: htmlUrl(`/${fullName}`),
		resourcePath: `/${fullName}`,
		createdAt: isoTimestamp(row.createdAt),
		updatedAt: isoTimestamp(row.updatedAt),
		pushedAt: null,
		archivedAt: null,
		isPrivate: row.visibility === "private",
		visibility: row.visibility === "private" ? "PRIVATE" : "PUBLIC",
		isFork: false,
		isTemplate: false,
		isMirror: false,
		mirrorUrl: null,
		isArchived: false,
		isLocked: false,
		isInOrganization: false,
		hasIssuesEnabled: true,
		hasWikiEnabled: false,
		hasProjectsEnabled: false,
		hasDiscussionsEnabled: false,
		homepageUrl: null,
		parent: null,
		templateRepository: null,
		forkCount: 0,
		mergeCommitAllowed: true,
		squashMergeAllowed: false,
		rebaseMergeAllowed: false,
		deleteBranchOnMerge: false,
		sshUrl: `git@${host}:${fullName}.git`,
		row,
		role,
	};
}

const PERMISSION: Record<Role, "ADMIN" | "WRITE" | "READ"> = {
	owner: "ADMIN",
	admin: "ADMIN",
	write: "WRITE",
	read: "READ",
	// Anyone who can see a public repository may read it.
	anonymous: "READ",
};

/** A readable repository by coordinates, or null (missing and unreadable alike). */
export async function readableRepositoryNode(
	ctx: GraphQLContext,
	owner: string,
	name: string,
): Promise<RepositoryNode | null> {
	if (!STORAGE_NAME_RE.test(owner) || !STORAGE_NAME_RE.test(name)) return null;
	return ctx.memo(`repository:${owner}/${name}`, async () => {
		const row = await findRepositoryByName(owner, name);
		if (!row) return null;
		const access = await getAccessForRepository(row, ctx.caller.userId);
		return access.canRead ? repositoryNode(row, access.role) : null;
	});
}

function requireRepoScope(ctx: GraphQLContext) {
	if (!tokenAllows(ctx.caller.scopes, "repo:write")) {
		// The token's classic scopes, as X-OAuth-Scopes reports them.
		const granted = (oauthScopesHeader(ctx.caller.scopes) ?? "")
			.split(", ")
			.filter(Boolean)
			.map((scope) => `'${scope}'`)
			.join(", ");
		throw new GitHubGraphQLError(
			"INSUFFICIENT_SCOPES",
			`Your token has not been granted the required scopes to execute this query. The 'createRepository' field requires one of the following scopes: ['repo'], but your token has only been granted the: [${granted}] scopes.`,
		);
	}
}

/** Branch names, once per repository per request (empty repositories have none). */
function branchesOf(ctx: GraphQLContext, repo: RepositoryNode) {
	return ctx.memo(`branches:${repo.row.id}`, async () =>
		(await getBranches(ownerKeyOf(repo.row), repo.row.name)).map(
			(branch) => branch.name,
		),
	);
}

async function defaultBranchRef(repo: RepositoryNode, ctx: GraphQLContext) {
	const branches = await branchesOf(ctx, repo);
	const name = repo.row.defaultBranch;
	return branches.includes(name) ? refNode(repo, name) : null;
}

function refNode(repo: RepositoryNode, branch: string) {
	return {
		__typename: "Ref",
		id: encodeNodeId("Ref", `${repo.row.id}:refs/heads/${branch}`),
		name: branch,
		prefix: "refs/heads/",
	};
}

function loadStarCount(ctx: GraphQLContext, repoId: number) {
	return ctx
		.loader<number, number>("star-count", (ids) => starCounts(ids))
		.load(repoId)
		.then((total) => total ?? 0);
}

function loadViewerHasStarred(ctx: GraphQLContext, repoId: number) {
	return ctx
		.loader<number, true>("viewer-starred", async (ids) => {
			const rows = await db
				.select({ repoId: stars.repoId })
				.from(stars)
				.where(
					and(eq(stars.userId, ctx.caller.userId), inArray(stars.repoId, ids)),
				);
			return new Map(rows.map((row) => [row.repoId, true as const]));
		})
		.load(repoId)
		.then((starred) => starred === true);
}

interface RepositoriesArgs extends ConnectionArgs {
	affiliations?: ("OWNER" | "COLLABORATOR" | "ORGANIZATION_MEMBER")[] | null;
	ownerAffiliations?:
		| ("OWNER" | "COLLABORATOR" | "ORGANIZATION_MEMBER")[]
		| null;
	privacy?: "PUBLIC" | "PRIVATE" | null;
	visibility?: "PUBLIC" | "PRIVATE" | "INTERNAL" | null;
	isFork?: boolean | null;
	isArchived?: boolean | null;
	orderBy?: {
		field: "CREATED_AT" | "NAME" | "PUSHED_AT" | "STARGAZERS" | "UPDATED_AT";
		direction: "ASC" | "DESC";
	} | null;
}

const collaboratorOf = (userId: string) =>
	exists(
		db
			.select({ one: sql`1` })
			.from(repositoryCollaborators)
			.where(
				and(
					eq(repositoryCollaborators.repoId, repositories.id),
					eq(repositoryCollaborators.userId, userId),
				),
			),
	);

/** `OWNER`/`COLLABORATOR` of `userId`; ORGANIZATION_MEMBER matches nothing. */
function affiliated(
	userId: string,
	affiliations: readonly string[],
): SQL | undefined {
	return (
		or(
			affiliations.includes("OWNER")
				? eq(repositories.ownerId, userId)
				: undefined,
			affiliations.includes("COLLABORATOR")
				? collaboratorOf(userId)
				: undefined,
		) ?? sql`false`
	);
}

function ordering(orderBy: RepositoriesArgs["orderBy"]): SQL[] {
	if (!orderBy) return [asc(repositories.id)];
	const column =
		orderBy.field === "NAME"
			? sql`lower(${repositories.name})`
			: orderBy.field === "CREATED_AT"
				? repositories.createdAt
				: orderBy.field === "STARGAZERS"
					? sql`(select count(*) from ${stars} where ${stars.repoId} = ${repositories.id})`
					: // No push timestamp yet: updated_at, as the REST API's `pushed` sort.
						repositories.updatedAt;
	return [
		orderBy.direction === "ASC" ? asc(column) : desc(column),
		asc(repositories.id),
	];
}

async function userRepositories(
	owner: UserNode,
	args: RepositoriesArgs,
	ctx: GraphQLContext,
) {
	const viewer = ctx.caller.userId;
	const privacy = args.privacy ?? args.visibility;
	const where = and(
		affiliated(
			owner.userId,
			args.ownerAffiliations ?? ["OWNER", "COLLABORATOR"],
		),
		args.affiliations ? affiliated(viewer, args.affiliations) : undefined,
		readableRepositoriesCondition(viewer),
		privacy
			? eq(
					repositories.visibility,
					privacy === "PRIVATE" ? "private" : "public",
				)
			: undefined,
		// Nothing is a fork or archived (or internal) here.
		args.isFork === true || args.isArchived === true || privacy === "INTERNAL"
			? sql`false`
			: undefined,
	);
	const [totalRow] = await db
		.select({ total: count() })
		.from(repositories)
		.where(where);
	return offsetConnection(args, totalRow?.total ?? 0, async (offset, limit) => {
		const rows = await db
			.select({
				repo: repositories,
				owner: publicUserColumns,
				collaboratorRole: sql<
					"read" | "write" | "admin" | null
				>`(select ${repositoryCollaborators.role} from ${repositoryCollaborators} where ${repositoryCollaborators.repoId} = ${repositories.id} and ${repositoryCollaborators.userId} = ${viewer})`,
			})
			.from(repositories)
			.innerJoin(user, eq(repositories.ownerId, user.id))
			.where(where)
			.orderBy(...ordering(args.orderBy))
			.limit(limit)
			.offset(offset);
		return rows.map(({ repo, owner: ownerRow, collaboratorRole }) =>
			repositoryNode(
				{ ...repo, owner: ownerRow },
				repo.ownerId === viewer
					? "owner"
					: // Neither owner nor collaborator: readable because it is public.
						(collaboratorRole ?? "anonymous"),
			),
		);
	});
}

/**
 * Repositories by id for `node(s)`: one query per request batch, readable
 * ones only (repo-access.ts's SQL read rule), with the caller's role.
 */
const loadRepositoryNode: NodeLoader = async (key, ctx) => {
	const id = rowIdOfNodeKey(key);
	if (id === null) return null;
	const viewer = ctx.caller.userId;
	const node = await ctx
		.loader<number, RepositoryNode>("repository-node", async (ids) => {
			const rows = await db
				.select({
					repo: repositories,
					owner: publicUserColumns,
					collaboratorRole: sql<
						"read" | "write" | "admin" | null
					>`(select ${repositoryCollaborators.role} from ${repositoryCollaborators} where ${repositoryCollaborators.repoId} = ${repositories.id} and ${repositoryCollaborators.userId} = ${viewer})`,
				})
				.from(repositories)
				.innerJoin(user, eq(repositories.ownerId, user.id))
				.where(
					and(
						inArray(repositories.id, ids),
						readableRepositoriesCondition(viewer),
					),
				);
			return new Map(
				rows.map(({ repo, owner, collaboratorRole }) => [
					repo.id,
					repositoryNode(
						{ ...repo, owner },
						repo.ownerId === viewer
							? "owner"
							: (collaboratorRole ?? "anonymous"),
					),
				]),
			);
		})
		.load(id);
	return node ?? null;
};

const loadRefNode: NodeLoader = async (key, ctx) => {
	const match = /^(\d{1,10}):refs\/heads\/(.+)$/.exec(key);
	if (!match) return null;
	const repo = await loadRepositoryNode(match[1] as string, ctx);
	if (!repo) return null;
	const node = repo as RepositoryNode;
	const name = match[2] as string;
	if (!(await branchesOf(ctx, node)).includes(name)) return null;
	return refNode(node, name);
};

interface CreateRepositoryInput {
	clientMutationId?: string | null;
	name: string;
	description?: string | null;
	visibility: "PUBLIC" | "PRIVATE" | "INTERNAL";
	ownerId?: string | null;
	teamId?: string | null;
	template?: boolean | null;
	homepageUrl?: string | null;
	hasIssuesEnabled?: boolean | null;
	hasWikiEnabled?: boolean | null;
}

async function createRepository(
	input: CreateRepositoryInput,
	ctx: GraphQLContext,
) {
	requireRepoScope(ctx);
	const viewer = await loadUser(ctx, ctx.caller.userId);
	if (!viewer) throw new Error("Authenticated user missing");
	if (input.ownerId != null) {
		const owner = decodeNodeId(input.ownerId);
		if (owner?.type !== "User" || owner.key !== String(viewer.apiId)) {
			throw notFound(
				`Could not resolve to a node with the global id of '${input.ownerId}'`,
			);
		}
	}
	// What PushStack has no notion of is refused, never silently dropped —
	// except `hasWikiEnabled`, which gh sends as true on every create: there
	// are no wikis, and the repository reports `hasWikiEnabled: false`.
	if (input.teamId != null) throw unprocessable("Teams are not supported.");
	if (input.template)
		throw unprocessable("Template repositories are not supported.");
	if (input.homepageUrl)
		throw unprocessable("Homepage URLs are not supported.");
	if (input.hasIssuesEnabled === false) {
		throw unprocessable("Issues cannot be disabled.");
	}
	if (input.visibility === "INTERNAL") {
		throw unprocessable("Internal repositories are not supported.");
	}
	const name = repoNameSchema.safeParse(input.name);
	if (!name.success) {
		throw unprocessable(
			`Name ${name.error.issues[0]?.message ?? "is invalid"}`,
		);
	}
	const [owner] = await db
		.select({ ...publicUserColumns, email: user.email })
		.from(user)
		.where(eq(user.id, viewer.id));
	if (!owner) throw new Error("Authenticated user missing");
	try {
		const repo = await createRepositoryForUser(owner, {
			name: name.data,
			description: input.description ?? undefined,
			visibility: input.visibility === "PRIVATE" ? "private" : "public",
			autoInit: false,
		});
		return {
			clientMutationId: input.clientMutationId ?? null,
			repository: repositoryNode({ ...repo, owner }, "owner"),
		};
	} catch (error) {
		if (error instanceof RepositoryExistsError) {
			throw unprocessable("Name already exists on this account");
		}
		throw error;
	}
}

export const repositoryResolvers: DomainResolvers = {
	types: {
		Query: {
			repository: async (
				_source,
				args: { owner: string; name: string },
				ctx,
			) => {
				const repo = await readableRepositoryNode(ctx, args.owner, args.name);
				if (!repo) throw repositoryNotFound(args.owner, args.name);
				return repo;
			},
			// GitHub answers an unknown owner with null and no error here...
			repositoryOwner: async (_source, args: { login: string }, ctx) => {
				const row = await loadUserByLogin(ctx, args.login);
				return row ? userNode(row) : null;
			},
			// ...but with NOT_FOUND for `user`.
			user: async (_source, args: { login: string }, ctx) => {
				const row = await loadUserByLogin(ctx, args.login);
				if (!row) {
					throw notFound(
						`Could not resolve to a User with the login of '${args.login}'.`,
					);
				}
				return userNode(row);
			},
		},
		Mutation: {
			createRepository: (
				_source,
				args: { input: CreateRepositoryInput },
				ctx,
			) => createRepository(args.input, ctx),
		},
		User: {
			repositories: (source: UserNode, args: RepositoriesArgs, ctx) =>
				userRepositories(source, args, ctx),
			repository: (source: UserNode, args: { name: string }, ctx) =>
				readableRepositoryNode(ctx, source.login, args.name),
		},
		Repository: {
			owner: async (source: RepositoryNode, _args, ctx) => {
				const row = await loadUser(ctx, source.row.ownerId);
				if (!row) throw new Error("Repository owner missing");
				return userNode(row);
			},
			defaultBranchRef: (source: RepositoryNode, _args, ctx) =>
				defaultBranchRef(source, ctx),
			isEmpty: async (source: RepositoryNode, _args, ctx) =>
				(await branchesOf(ctx, source)).length === 0,
			stargazerCount: (source: RepositoryNode, _args, ctx) =>
				loadStarCount(ctx, source.row.id),
			viewerHasStarred: (source: RepositoryNode, _args, ctx) =>
				loadViewerHasStarred(ctx, source.row.id),
			viewerPermission: (source: RepositoryNode) => PERMISSION[source.role],
			viewerCanAdminister: (source: RepositoryNode) =>
				source.role === "owner" || source.role === "admin",
		},
	},
	nodes: { Repository: loadRepositoryNode, Ref: loadRefNode },
};
