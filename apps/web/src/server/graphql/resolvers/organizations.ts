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
	orgMemberships,
	repositories,
	type Team,
	teamRepositories,
	teams,
} from "#/db/app-schema";
import { STORAGE_NAME_RE } from "#/lib/storage-name";
import { htmlUrl, isoTimestamp } from "../../api/http";
import {
	getAccessForRepository,
	readableRepositoriesCondition,
} from "../../repo-access";
import { repositoryOwnerOf } from "../../repository-lookup";
import {
	findTeamById,
	listChildTeams,
	listTeamMembers,
	listTeams,
	teamMembershipOf,
} from "../../team-store";
import { offsetConnection } from "../connection";
import type { GraphQLContext } from "../context";
import { notFound, unprocessable } from "../errors";
import { encodeNodeId, rowIdOfNodeKey } from "../node-id";
import { loadUser, type UserNode, userNode } from "./core";
import type { RepositoryOrder, TeamMembersArgs } from "./generated";
import {
	ordering,
	type RepoRole,
	type RepositoryNode,
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
export function loadOrganization(
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

/** The connection edges carry the node; the extra GitHub fields read as null-ish. */
export interface TeamMemberEdgeNode {
	cursor: string;
	node: UserNode;
}

export interface TeamRepositoryEdgeNode {
	cursor: string;
	node: RepositoryNode;
}

export interface TeamNode {
	__typename: "Team";
	id: string;
	databaseId: number;
	name: string;
	slug: string;
	description: string | null;
	privacy: "SECRET" | "VISIBLE";
	notificationSetting: "NOTIFICATIONS_ENABLED";
	url: string;
	createdAt: string;
	updatedAt: string;
	/** Internal: the row and its organization, for the fields around it. */
	team: Team;
	organization: OrganizationNode;
}

export function teamNode(team: Team, organization: OrganizationNode): TeamNode {
	return {
		__typename: "Team",
		id: encodeNodeId("Team", team.id),
		databaseId: team.id,
		name: team.name,
		slug: team.slug,
		description: team.description,
		privacy: team.privacy === "secret" ? "SECRET" : "VISIBLE",
		notificationSetting: "NOTIFICATIONS_ENABLED",
		url: htmlUrl(`/orgs/${organization.login}/teams/${team.slug}`),
		createdAt: isoTimestamp(team.createdAt),
		updatedAt: isoTimestamp(team.updatedAt),
		team,
		organization,
	};
}

/** The viewer's read rule: an active member, with `secret` teams for members only. */
async function canReadTeam(
	ctx: GraphQLContext,
	team: Team,
	orgRole: string | null,
): Promise<boolean> {
	const viewer = ctx.caller.userId;
	if (orgRole === "admin") return true;
	if (orgRole !== "member") return false;
	if (team.privacy !== "secret") return true;
	return (await teamMembershipOf(team.id, viewer)) !== null;
}

async function organizationTeams(
	source: OrganizationNode,
	args: {
		after?: string | null;
		before?: string | null;
		first?: number | null;
		last?: number | null;
		userLogins?: readonly (string | null)[] | null;
	},
	ctx: GraphQLContext,
) {
	const viewer = ctx.caller.userId;
	const orgRole = await organizationRoleOfSource(source, viewer);
	const userLogins = args.userLogins?.filter(
		(login): login is string => !!login,
	);
	const page = (offset: number, limit: number) =>
		listTeams(
			source.orgId,
			{ limit, offset },
			{ userId: viewer, isOrgAdmin: orgRole === "admin" },
			userLogins,
		);
	const [{ total }] = await Promise.all([page(0, 1)]);
	return offsetConnection(args, total, async (offset, limit) => {
		const teamsPage = await page(offset, limit);
		return teamsPage.rows.map((row) => teamNode(row, source));
	});
}

/** The viewer's organization role, as team visibility reads it. */
async function organizationRoleOfSource(
	source: OrganizationNode,
	viewer: string,
): Promise<string | null> {
	const [row] = await db
		.select({ role: orgMemberships.role })
		.from(orgMemberships)
		.where(
			and(
				eq(orgMemberships.orgId, source.orgId),
				eq(orgMemberships.userId, viewer),
				eq(orgMemberships.state, "active"),
			),
		);
	return row?.role ?? null;
}

async function teamMembersConnection(
	source: TeamNode,
	args: TeamMembersArgs,
	ctx: GraphQLContext,
) {
	const page = (offset: number, limit: number) =>
		listTeamMembers(source.team.id, { limit, offset });
	const [{ total }] = await Promise.all([page(0, 1)]);
	return offsetConnection(args, total, async (offset, limit) => {
		const members = await page(offset, limit);
		const nodes = await Promise.all(
			members.rows.map(async ({ user: member }) => {
				const row = await loadUser(ctx, member.id);
				return row ? userNode(row) : null;
			}),
		);
		return nodes.filter((node): node is NonNullable<typeof node> => !!node);
	});
}

async function teamRepositoriesConnection(
	source: TeamNode,
	args: {
		after?: string | null;
		before?: string | null;
		first?: number | null;
		last?: number | null;
	},
	ctx: GraphQLContext,
) {
	const viewer = ctx.caller.userId;
	const where = and(
		eq(teamRepositories.teamId, source.team.id),
		readableRepositoriesCondition(viewer),
	);
	const [totalRow] = await db
		.select({ total: count() })
		.from(teamRepositories)
		.innerJoin(repositories, eq(repositories.id, teamRepositories.repoId))
		.where(where);
	return offsetConnection(args, totalRow?.total ?? 0, async (offset, limit) => {
		const rows = await db
			.select({
				repo: repositories,
				organization: {
					id: organizations.id,
					login: organizations.login,
					name: organizations.name,
				},
			})
			.from(teamRepositories)
			.innerJoin(repositories, eq(repositories.id, teamRepositories.repoId))
			.innerJoin(
				organizations,
				eq(organizations.id, repositories.organizationId),
			)
			.where(where)
			.orderBy(repositories.name)
			.limit(limit)
			.offset(offset);
		return Promise.all(
			rows.map(async ({ repo, organization }) => {
				const access = await getAccessForRepository(repo, viewer);
				return repositoryNode(
					{
						...repo,
						owner: repositoryOwnerOf({ owner: null, organization }),
					},
					repo.ownerId === viewer ? "owner" : access.role,
				);
			}),
		);
	});
}

async function teamChildTeams(
	source: TeamNode,
	args: {
		after?: string | null;
		before?: string | null;
		first?: number | null;
		immediateOnly?: boolean | null;
		last?: number | null;
	},
) {
	const page = (offset: number, limit: number) =>
		args.immediateOnly === false
			? descendants(source.team.id, { limit, offset })
			: listChildTeams(source.team.id, { limit, offset });
	const [{ total }] = await Promise.all([page(0, 1)]);
	return offsetConnection(args, total, async (offset, limit) => {
		const children = await page(offset, limit);
		return children.rows.map((row) => teamNode(row, source.organization));
	});
}

/** Every descendant of a team, depth-first (bounded by the organization's cap). */
async function descendants(
	teamId: number,
	page: { limit: number; offset: number },
): Promise<{ rows: Team[]; total: number }> {
	const all = await db
		.select()
		.from(teams)
		.where(eq(teams.orgId, (await findTeamById(teamId))?.orgId ?? -1));
	const byParent = new Map<number, Team[]>();
	for (const row of all) {
		if (row.parentTeamId === null) continue;
		byParent.set(row.parentTeamId, [
			...(byParent.get(row.parentTeamId) ?? []),
			row,
		]);
	}
	const rows: Team[] = [];
	const walk = (id: number) => {
		for (const child of byParent.get(id) ?? []) {
			rows.push(child);
			walk(child.id);
		}
	};
	walk(teamId);
	return {
		rows: rows.slice(page.offset, page.offset + page.limit),
		total: rows.length,
	};
}

/** `node(id:)` for a team. */
const loadTeamNode: NodeLoader = async (key, ctx) => {
	const id = rowIdOfNodeKey(key);
	if (id === null) return null;
	const team = await findTeamById(id);
	if (!team) return null;
	const org = await loadOrganization(ctx, team.orgId);
	if (!org) return null;
	const organization = organizationNode(org);
	const orgRole = await organizationRoleOfSource(
		organization,
		ctx.caller.userId,
	);
	if (!(await canReadTeam(ctx, team, orgRole))) return null;
	return teamNode(team, organization);
};

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
			teams: (source: OrganizationNode, args, ctx) =>
				organizationTeams(source, args, ctx),
		},
		Team: {
			organization: (source: TeamNode) => source.organization,
			parentTeam: async (source: TeamNode) => {
				if (source.team.parentTeamId === null) return null;
				const parent = await findTeamById(source.team.parentTeamId);
				return parent ? teamNode(parent, source.organization) : null;
			},
			members: (source: TeamNode, args: TeamMembersArgs, ctx) =>
				teamMembersConnection(source, args, ctx),
			repositories: (source: TeamNode, args, ctx) =>
				teamRepositoriesConnection(source, args, ctx),
			childTeams: (source: TeamNode, args) => teamChildTeams(source, args),
		},
	},
	nodes: { Organization: loadOrganizationNode, Team: loadTeamNode },
};
