/**
 * Organizations domain: `Query.organization`, the `Organization` type (a
 * `RepositoryOwner`), `Repository.owner` for an organization-owned repository,
 * and `node(id:)`. `Query.repositoryOwner` resolves an organization through the
 * same loaders from the repository domain.
 */
import { and, count, eq, inArray } from "drizzle-orm";
import { db } from "#/db";
import {
	type Organization,
	organizations,
	repositories,
} from "#/db/app-schema";
import { STORAGE_NAME_RE } from "#/lib/storage-name";
import { htmlUrl, isoTimestamp } from "../../api/http";
import {
	getAccessForRepository,
	readableRepositoriesCondition,
} from "../../repo-access";
import { repositoryOwnerOf } from "../../repository-lookup";
import { offsetConnection } from "../connection";
import type { GraphQLContext } from "../context";
import { notFound, unprocessable } from "../errors";
import { encodeNodeId, rowIdOfNodeKey } from "../node-id";
import type { RepositoryOrder } from "./generated";
import {
	ordering,
	type RepoRole,
	readableRepositoryNode,
	repositoryNode,
} from "./repository";
import type { DomainResolvers, NodeLoader } from "./types";

const organizationColumns = {
	id: organizations.id,
	login: organizations.login,
	name: organizations.name,
	description: organizations.description,
	blog: organizations.blog,
	location: organizations.location,
	email: organizations.email,
	createdAt: organizations.createdAt,
	updatedAt: organizations.updatedAt,
};
type OrganizationRow = {
	id: number;
	login: string;
	name: string | null;
	description: string | null;
	blog: string | null;
	location: string | null;
	email: string | null;
	createdAt: Date;
	updatedAt: Date;
};

export interface OrganizationNode {
	__typename: "Organization";
	id: string;
	databaseId: number;
	login: string;
	name: string | null;
	description: string | null;
	location: string | null;
	websiteUrl: string | null;
	email: string | null;
	avatarUrl: string;
	isVerified: boolean;
	createdAt: string;
	updatedAt: string;
	url: string;
	resourcePath: string;
	/** Internal: the row id, for the fields other domains add. */
	orgId: number;
}

export function organizationNode(
	row: Organization | OrganizationRow,
): OrganizationNode {
	return {
		__typename: "Organization",
		id: encodeNodeId("Organization", row.id),
		databaseId: row.id,
		login: row.login,
		name: row.name || null,
		description: row.description,
		location: row.location,
		websiteUrl: row.blog,
		email: row.email,
		// No avatar is stored or fetched: an empty URI, never a remote image.
		avatarUrl: "",
		isVerified: false,
		createdAt: isoTimestamp(row.createdAt),
		updatedAt: isoTimestamp(row.updatedAt),
		url: htmlUrl(`/${row.login}`),
		resourcePath: `/${row.login}`,
		orgId: row.id,
	};
}

/** Organizations by row id, batched per request. */
function loadOrganization(
	ctx: GraphQLContext,
	orgId: number,
): Promise<OrganizationRow | undefined> {
	return ctx
		.loader<number, OrganizationRow>("organization-by-id", async (ids) => {
			const rows = await db
				.select(organizationColumns)
				.from(organizations)
				.where(inArray(organizations.id, ids));
			return new Map(rows.map((row) => [row.id, row]));
		})
		.load(orgId);
}

export async function loadOrganizationByLogin(
	ctx: GraphQLContext,
	login: string,
): Promise<OrganizationRow | undefined> {
	if (!STORAGE_NAME_RE.test(login)) return undefined;
	return ctx
		.loader<string, OrganizationRow>(
			"organization-by-login",
			async (logins) => {
				const rows = await db
					.select(organizationColumns)
					.from(organizations)
					.where(inArray(organizations.login, logins));
				return new Map(rows.map((row) => [row.login, row]));
			},
		)
		.load(login);
}

/** `Repository.owner` for an organization-owned repository. */
export async function organizationOwnerNode(
	ctx: GraphQLContext,
	orgId: number,
): Promise<OrganizationNode> {
	const row = await loadOrganization(ctx, orgId);
	if (!row) throw new Error("Repository owner missing");
	return organizationNode(row);
}

interface OrganizationRepositoriesArgs {
	affiliations?: readonly (string | null)[] | null;
	after?: string | null;
	before?: string | null;
	first?: number | null;
	isArchived?: boolean | null;
	isFork?: boolean | null;
	last?: number | null;
	orderBy?: RepositoryOrder | null;
	ownerAffiliations?: readonly (string | null)[] | null;
	privacy?: string | null;
	visibility?: string | null;
}

/** `Organization.repositories`: the organization's repositories the viewer can read. */
async function organizationRepositories(
	source: OrganizationNode,
	args: OrganizationRepositoriesArgs,
	ctx: GraphQLContext,
) {
	const viewer = ctx.caller.userId;
	const privacy = args.privacy ?? args.visibility;
	if (privacy === "INTERNAL" || args.isArchived === true) {
		throw unprocessable("Unsupported repository filter");
	}
	const where = and(
		eq(repositories.organizationId, source.orgId),
		readableRepositoriesCondition(viewer),
		privacy
			? eq(
					repositories.visibility,
					privacy === "PRIVATE" ? "private" : "public",
				)
			: undefined,
		args.isFork == null ? undefined : eq(repositories.isFork, args.isFork),
	);
	const [totalRow] = await db
		.select({ total: count() })
		.from(repositories)
		.where(where);
	return offsetConnection(args, totalRow?.total ?? 0, async (offset, limit) => {
		const rows = await db
			.select({
				repo: repositories,
				owner: {
					login: organizations.login,
					id: organizations.id,
					name: organizations.name,
				},
			})
			.from(repositories)
			.innerJoin(
				organizations,
				eq(repositories.organizationId, organizations.id),
			)
			.where(where)
			.orderBy(...ordering(args.orderBy))
			.limit(limit)
			.offset(offset);
		return Promise.all(
			rows.map(async ({ repo, owner }) => {
				const access = await getAccessForRepository(repo, viewer);
				const role: RepoRole = repo.ownerId === viewer ? "owner" : access.role;
				return repositoryNode(
					{
						...repo,
						owner: repositoryOwnerOf({
							owner: null,
							organization: {
								id: owner.id,
								login: owner.login,
								name: owner.name,
							},
						}),
					},
					role,
				);
			}),
		);
	});
}

/** `node(id:)` for an organization. */
const loadOrganizationNode: NodeLoader = async (key, ctx) => {
	const id = rowIdOfNodeKey(key);
	if (id === null) return null;
	const row = await loadOrganization(ctx, id);
	return row ? organizationNode(row) : null;
};

export const organizationsResolvers: DomainResolvers = {
	types: {
		Query: {
			organization: async (_source, args: { login: string }, ctx) => {
				const row = await loadOrganizationByLogin(ctx, args.login);
				if (!row) {
					throw notFound(
						`Could not resolve to an Organization with the login of '${args.login}'.`,
					);
				}
				return organizationNode(row);
			},
		},
		Organization: {
			repositories: (source: OrganizationNode, args, ctx) =>
				organizationRepositories(source, args, ctx),
			repository: (source: OrganizationNode, args: { name: string }, ctx) =>
				readableRepositoryNode(ctx, source.login, args.name),
		},
	},
	nodes: { Organization: loadOrganizationNode },
};
