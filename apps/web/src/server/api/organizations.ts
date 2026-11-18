/**
 * The organization membership endpoints: who belongs to an organization, the
 * caller's own memberships, and the owner-only member management. Access
 * decisions read through org-access.ts and organization-members.ts; every
 * mutation there evicts the affected repositories' cached access.
 */
import { and, count, eq } from "drizzle-orm";
import { db } from "#/db";
import {
	type Organization,
	organizations,
	orgMemberships,
} from "#/db/app-schema";
import { user } from "#/db/schema";
import { STORAGE_NAME_RE } from "#/lib/storage-name";
import {
	OrganizationAccessError,
	requireOrganizationRole,
} from "../org-access";
import {
	listMembershipsForUser,
	listOrganizationMembers,
	listOutsideCollaborators,
	membershipOf,
	removeOrganizationMembership,
	setOrganizationMembership,
} from "../organization-members";
import {
	countPublicRepositories,
	getOrganizationByLogin,
} from "../organizations-store";
import { type ApiContext, requireCaller, requireScope } from "./auth";
import {
	forbiddenError,
	json,
	linkHeader,
	noContent,
	notFoundError,
	pageParams,
} from "./http";
import { pathParams, queryParams, requestBody } from "./input";
import {
	organization,
	organizationMembership,
	simpleUser,
} from "./serializers";

async function organizationNamed(login: string): Promise<Organization> {
	if (!STORAGE_NAME_RE.test(login)) throw notFoundError();
	const organization = await getOrganizationByLogin(login);
	if (!organization) throw notFoundError();
	return organization;
}

/** The user behind a `{username}` path segment, or GitHub's 404. */
async function userByLogin(login: string): Promise<typeof user.$inferSelect> {
	if (!STORAGE_NAME_RE.test(login)) throw notFoundError();
	const [row] = await db.select().from(user).where(eq(user.username, login));
	if (!row) throw notFoundError();
	return row;
}

/** GitHub's 403 for a caller who is not an organization owner. */
async function requireOrganizationOwner(
	ctx: ApiContext,
	organization: Organization,
): Promise<{ userId: string }> {
	const caller = requireScope(ctx, "repo:write");
	try {
		await requireOrganizationRole(organization.id, caller.userId, ["admin"]);
	} catch (error) {
		if (error instanceof OrganizationAccessError) {
			throw forbiddenError(error.message);
		}
		throw error;
	}
	return caller;
}

/** The organization membership by `{org}` and `{username}`, or a 404. */
async function membershipNamed(
	ctx: ApiContext,
	operation:
		| "orgs/get-membership-for-user"
		| "orgs/set-membership-for-user"
		| "orgs/remove-membership-for-user",
): Promise<{
	organization: Organization;
	member: typeof user.$inferSelect;
}> {
	const { org, username } = pathParams(ctx, operation);
	const organization = await organizationNamed(org);
	await requireOrganizationOwner(ctx, organization);
	const member = await userByLogin(username);
	return { organization, member };
}

/** `GET /orgs/{org}/members`. */
export async function listMembers(ctx: ApiContext) {
	const { org } = pathParams(ctx, "orgs/list-members");
	const organization = await organizationNamed(org);
	queryParams(ctx, "orgs/list-members", "Organization");
	const params = pageParams(ctx.url.searchParams);
	if (!params.reachable) return json([], 200, linkHeader(ctx.url, params, 0));
	const page = await listOrganizationMembers(organization.id, {
		limit: params.perPage,
		offset: params.offset,
	});
	return json(
		page.rows.map((row) => simpleUser(row.user)),
		200,
		linkHeader(ctx.url, params, page.total),
	);
}

/** `GET /orgs/{org}/members/{username}`: 204 when an active member. */
export async function checkMembership(ctx: ApiContext) {
	const { org, username } = pathParams(ctx, "orgs/check-membership-for-user");
	const organization = await organizationNamed(org);
	const member = await userByLogin(username);
	const membership = await membershipOf(organization.id, member.id);
	if (membership?.state !== "active") throw notFoundError();
	return noContent();
}

/** `DELETE /orgs/{org}/members/{username}`. */
export async function removeMember(ctx: ApiContext) {
	const { org, username } = pathParams(ctx, "orgs/remove-member");
	const organization = await organizationNamed(org);
	await requireOrganizationOwner(ctx, organization);
	const member = await userByLogin(username);
	await removeOrganizationMembership(organization.id, member.id);
	return noContent();
}

/** `GET /orgs/{org}/memberships/{username}`. */
export async function getMembership(ctx: ApiContext) {
	const { organization, member } = await membershipNamed(
		ctx,
		"orgs/get-membership-for-user",
	);
	const membership = await membershipOf(organization.id, member.id);
	if (!membership) throw notFoundError();
	return json(organizationMembership(membership, organization, member));
}

/** `PUT /orgs/{org}/memberships/{username}`. */
export async function setMembership(ctx: ApiContext) {
	const { org, username } = pathParams(ctx, "orgs/set-membership-for-user");
	const organization = await organizationNamed(org);
	await requireOrganizationOwner(ctx, organization);
	const member = await userByLogin(username);
	const data = await requestBody(
		ctx,
		"orgs/set-membership-for-user",
		"Organization",
	);
	const membership = await setOrganizationMembership(
		organization.id,
		member.id,
		data.role ?? "member",
	);
	return json(organizationMembership(membership, organization, member));
}

/** `DELETE /orgs/{org}/memberships/{username}`. */
export async function removeMembership(ctx: ApiContext) {
	const { organization, member } = await membershipNamed(
		ctx,
		"orgs/remove-membership-for-user",
	);
	await removeOrganizationMembership(organization.id, member.id);
	return noContent();
}

/** `GET /user/memberships/orgs`. */
export async function listCallerMemberships(ctx: ApiContext) {
	const caller = requireCaller(ctx);
	const query = queryParams(
		ctx,
		"orgs/list-memberships-for-authenticated-user",
		"Organization",
	);
	const params = pageParams(ctx.url.searchParams);
	if (!params.reachable) return json([], 200, linkHeader(ctx.url, params, 0));
	const page = await listMembershipsForUser(
		caller.userId,
		{ limit: params.perPage, offset: params.offset },
		query.state,
	);
	return json(
		page.rows.map((row) =>
			organizationMembership(row.membership, row.organization, row.user),
		),
		200,
		linkHeader(ctx.url, params, page.total),
	);
}

/** `GET /user/memberships/orgs/{org}`. */
export async function getCallerMembership(ctx: ApiContext) {
	const caller = requireCaller(ctx);
	const { org } = pathParams(ctx, "orgs/get-membership-for-authenticated-user");
	const organization = await organizationNamed(org);
	const membership = await membershipOf(organization.id, caller.userId);
	if (!membership) throw notFoundError();
	const [member] = await db
		.select()
		.from(user)
		.where(eq(user.id, caller.userId));
	if (!member) throw notFoundError();
	return json(organizationMembership(membership, organization, member));
}

/** `GET /orgs/{org}/outside_collaborators`. */
export async function listOutsideCollaboratorsHandler(ctx: ApiContext) {
	const { org } = pathParams(ctx, "orgs/list-outside-collaborators");
	const organization = await organizationNamed(org);
	await requireOrganizationOwner(ctx, organization);
	queryParams(ctx, "orgs/list-outside-collaborators", "Organization");
	const params = pageParams(ctx.url.searchParams);
	if (!params.reachable) return json([], 200, linkHeader(ctx.url, params, 0));
	const page = await listOutsideCollaborators(organization.id, {
		limit: params.perPage,
		offset: params.offset,
	});
	return json(
		page.rows.map(simpleUser),
		200,
		linkHeader(ctx.url, params, page.total),
	);
}

/** `GET /orgs/{org}`: the organization's public profile. */
export async function getOrganization(ctx: ApiContext) {
	const { org } = pathParams(ctx, "orgs/get");
	const organizationRow = await organizationNamed(org);
	return json(
		organization(organizationRow, {
			publicRepos: await countPublicRepositories(organizationRow.id),
		}),
	);
}

/** The organizations in `where`, a page at a time, with the caller's own. */
async function respondWithOrganizations(
	ctx: ApiContext,
	where: ReturnType<typeof and>,
) {
	const params = pageParams(ctx.url.searchParams);
	if (!params.reachable) return json([], 200, linkHeader(ctx.url, params, 0));
	const [rows, [total]] = await Promise.all([
		db
			.select({ organization: organizations })
			.from(organizations)
			.innerJoin(
				orgMemberships,
				and(
					eq(orgMemberships.orgId, organizations.id),
					eq(orgMemberships.state, "active"),
				),
			)
			.where(where)
			.groupBy(organizations.id)
			.orderBy(organizations.login)
			.limit(params.perPage)
			.offset(params.offset),
		db
			.select({ total: count() })
			.from(organizations)
			.innerJoin(
				orgMemberships,
				and(
					eq(orgMemberships.orgId, organizations.id),
					eq(orgMemberships.state, "active"),
				),
			)
			.where(where),
	]);
	const shapes = await Promise.all(
		rows.map(async (row) =>
			organization(row.organization, {
				publicRepos: await countPublicRepositories(row.organization.id),
			}),
		),
	);
	return json(shapes, 200, linkHeader(ctx.url, params, total?.total ?? 0));
}

/** `GET /user/orgs`: the organizations the caller is an active member of. */
export async function listCallerOrganizations(ctx: ApiContext) {
	const caller = requireCaller(ctx);
	queryParams(ctx, "orgs/list-for-authenticated-user", "Organization");
	return respondWithOrganizations(
		ctx,
		and(
			eq(orgMemberships.userId, caller.userId),
			eq(orgMemberships.state, "active"),
		),
	);
}

/** `GET /users/{username}/orgs`: the same list for another user. */
export async function listUserOrganizations(ctx: ApiContext) {
	const { username } = pathParams(ctx, "orgs/list-for-user");
	queryParams(ctx, "orgs/list-for-user", "Organization");
	const member = await userByLogin(username);
	return respondWithOrganizations(
		ctx,
		and(
			eq(orgMemberships.userId, member.id),
			eq(orgMemberships.state, "active"),
		),
	);
}
