/**
 * The `/orgs/{org}/teams` endpoints: team CRUD, members and repository grants.
 * Read access is an active organization membership (a `secret` team only for
 * its members and organization owners); writes need an organization owner or,
 * for a team's own rows, a team maintainer. Nesting, slugs and caps are decided
 * in team-store.ts, inside the write.
 */
import { eq } from "drizzle-orm";
import { db } from "#/db";
import type { Organization, Team } from "#/db/app-schema";
import { user } from "#/db/schema";
import { STORAGE_NAME_RE } from "#/lib/storage-name";
import { organizationRoleOf } from "../org-access";
import { membershipOf } from "../organization-members";
import { getOrganizationByLogin } from "../organizations-store";
import { findRepositoryByName, repositoryOwnerOf } from "../repository-lookup";
import {
	createTeam,
	deleteTeam,
	findTeamById,
	findTeamBySlug,
	listChildTeams,
	listTeamMembers,
	listTeamRepositories,
	listTeams,
	REST_PERMISSIONS,
	removeTeamMembership,
	removeTeamRepo,
	setTeamMembership,
	setTeamRepoPermission,
	TeamExistsError,
	TeamLimitError,
	TeamNameInvalidError,
	TeamNestingError,
	teamCounts,
	teamMembershipOf,
	teamPermissionFromRest,
	teamRepoPermission,
	updateTeam,
} from "../team-store";
import {
	type ApiContext,
	type Caller,
	requireCaller,
	requireScope,
} from "./auth";
import {
	ApiError,
	forbiddenError,
	json,
	linkHeader,
	noContent,
	notFoundError,
	pageParams,
	validationFailedError,
} from "./http";
import { pathParams, queryParams, requestBody } from "./input";
import { repositoryPayload } from "./repos";
import {
	repository as repositoryShape,
	simpleUser,
	team,
	teamMembership,
} from "./serializers";

async function organizationNamed(login: string): Promise<Organization> {
	if (!STORAGE_NAME_RE.test(login)) throw notFoundError();
	const organization = await getOrganizationByLogin(login);
	if (!organization) throw notFoundError();
	return organization;
}

type TeamOperation =
	| "teams/get-by-name"
	| "teams/update-in-org"
	| "teams/delete-in-org"
	| "teams/list-child-in-org"
	| "teams/list-members-in-org"
	| "teams/list-repos-in-org"
	| "teams/check-permissions-for-repo-in-org"
	| "teams/add-or-update-repo-permissions-in-org"
	| "teams/remove-repo-in-org"
	| "teams/get-membership-for-user-in-org"
	| "teams/add-or-update-membership-for-user-in-org"
	| "teams/remove-membership-for-user-in-org";

/** The team named by the route, or GitHub's 404. */
async function teamNamed(
	ctx: ApiContext,
	operation: TeamOperation,
): Promise<{ organization: Organization; team: Team }> {
	const { org, team_slug } = pathParams(ctx, operation);
	const organization = await organizationNamed(org);
	const team = await findTeamBySlug(organization.id, team_slug);
	if (!team) throw notFoundError();
	return { organization, team };
}

/** An active organization member, or the 404 a non-member sees. */
async function requireMember(
	ctx: ApiContext,
	organization: Organization,
): Promise<Caller> {
	const caller = requireCaller(ctx);
	const membership = await membershipOf(organization.id, caller.userId);
	if (membership?.state !== "active") throw notFoundError();
	return caller;
}

/** An organization owner (the team endpoints' write guard), or 403. */
async function requireOwner(
	ctx: ApiContext,
	organization: Organization,
): Promise<Caller> {
	const caller = requireScope(ctx, "repo:write");
	const role = await organizationRoleOf(organization.id, caller.userId);
	if (role !== "admin") {
		throw forbiddenError(
			"You must be an organization owner to perform this action",
		);
	}
	return caller;
}

/** A visible team: every member of a `closed` team, its own members for `secret`. */
async function requireTeamRead(
	ctx: ApiContext,
	organization: Organization,
	team: Team,
): Promise<Caller> {
	const caller = requireCaller(ctx);
	const role = await organizationRoleOf(organization.id, caller.userId);
	if (role === "admin") return caller;
	if (role !== "member") throw notFoundError();
	if (
		team.privacy === "secret" &&
		!(await teamMembershipOf(team.id, caller.userId))
	) {
		throw notFoundError();
	}
	return caller;
}

/** An organization owner or the team's maintainer, or 403. */
async function requireTeamManager(
	ctx: ApiContext,
	organization: Organization,
	team: Team,
): Promise<Caller> {
	const caller = requireScope(ctx, "repo:write");
	if ((await organizationRoleOf(organization.id, caller.userId)) === "admin") {
		return caller;
	}
	const membership = await teamMembershipOf(team.id, caller.userId);
	if (membership?.role !== "maintainer") {
		throw forbiddenError(
			"You must be a team maintainer to perform this action",
		);
	}
	return caller;
}

function mapTeamError(error: unknown): never {
	if (error instanceof TeamExistsError) {
		throw validationFailedError("Validation Failed", [
			{
				resource: "Team",
				field: "name",
				code: "custom",
				message: "already exists",
			},
		]);
	}
	if (error instanceof TeamNameInvalidError) {
		throw validationFailedError("Validation Failed", [
			{ resource: "Team", field: "name", code: "invalid" },
		]);
	}
	if (error instanceof TeamNestingError) {
		throw validationFailedError("Validation Failed", [
			{
				resource: "Team",
				field: "parent_team_id",
				code: "invalid",
				message: "Parent team is invalid, too deep or a descendant",
			},
		]);
	}
	if (error instanceof TeamLimitError) {
		throw new ApiError(422, error.message);
	}
	throw error;
}

async function respondWithTeam(
	organization: Organization,
	row: Team,
	status = 200,
): Promise<Response> {
	const parent = row.parentTeamId ? await findTeamById(row.parentTeamId) : null;
	const counts = await teamCounts([row.id, ...(parent ? [parent.id] : [])]);
	return json(
		team({
			team: row,
			organization,
			counts: counts.get(row.id) ?? { members: 0, repos: 0 },
			parent: parent
				? {
						team: parent,
						counts: counts.get(parent.id) ?? { members: 0, repos: 0 },
					}
				: null,
		}),
		status,
	);
}

/** The user named by `{username}`, or a 404. */
async function userByLogin(login: string): Promise<typeof user.$inferSelect> {
	if (!STORAGE_NAME_RE.test(login)) throw notFoundError();
	const [row] = await db.select().from(user).where(eq(user.username, login));
	if (!row) throw notFoundError();
	return row;
}

/** The `{owner}/{repo}` repository, which must belong to this organization. */
async function organizationRepository(
	organization: Organization,
	owner: string,
	name: string,
) {
	const repo = await findRepositoryByName(owner, name);
	if (!repo || repo.organizationId !== organization.id) throw notFoundError();
	return repo;
}

/** `GET /orgs/{org}/teams`. */
export async function listTeamsHandler(ctx: ApiContext) {
	const { org } = pathParams(ctx, "teams/list");
	const organization = await organizationNamed(org);
	const caller = await requireMember(ctx, organization);
	queryParams(ctx, "teams/list", "Team");
	const isOrgAdmin =
		(await organizationRoleOf(organization.id, caller.userId)) === "admin";
	const params = pageParams(ctx.url.searchParams);
	if (!params.reachable) return json([], 200, linkHeader(ctx.url, params, 0));
	const page = await listTeams(
		organization.id,
		{ limit: params.perPage, offset: params.offset },
		{ userId: caller.userId, isOrgAdmin },
	);
	const counts = await teamCounts(page.rows.map((row) => row.id));
	const parents = await Promise.all(
		page.rows.map((row) =>
			row.parentTeamId ? findTeamById(row.parentTeamId) : null,
		),
	);
	const parentCounts = await teamCounts(
		parents.flatMap((row) => (row ? [row.id] : [])),
	);
	return json(
		page.rows.map((row, index) => {
			const parent = parents[index] ?? null;
			return team({
				team: row,
				organization,
				counts: counts.get(row.id) ?? { members: 0, repos: 0 },
				parent: parent
					? {
							team: parent,
							counts: parentCounts.get(parent.id) ?? { members: 0, repos: 0 },
						}
					: null,
			});
		}),
		200,
		linkHeader(ctx.url, params, page.total),
	);
}

/** `GET /orgs/{org}/teams/{team_slug}`. */
export async function getTeam(ctx: ApiContext) {
	const { organization, team: row } = await teamNamed(ctx, "teams/get-by-name");
	await requireTeamRead(ctx, organization, row);
	return respondWithTeam(organization, row);
}

/** `POST /orgs/{org}/teams`. */
export async function createTeamHandler(ctx: ApiContext) {
	const { org } = pathParams(ctx, "teams/create");
	const organization = await organizationNamed(org);
	await requireOwner(ctx, organization);
	const data = await requestBody(ctx, "teams/create", "Team");
	let created: Team;
	try {
		created = await createTeam(organization.id, {
			name: data.name,
			description: data.description ?? null,
			privacy: data.privacy,
			parentTeamId: data.parent_team_id,
			parentTeamSlug: data.parent_team_slug,
		});
	} catch (error) {
		mapTeamError(error);
	}
	return respondWithTeam(organization, created, 201);
}

/** `PATCH /orgs/{org}/teams/{team_slug}`. */
export async function updateTeamHandler(ctx: ApiContext) {
	const { organization, team: row } = await teamNamed(
		ctx,
		"teams/update-in-org",
	);
	await requireOwner(ctx, organization);
	const data = await requestBody(ctx, "teams/update-in-org", "Team");
	let updated: Team;
	try {
		updated = await updateTeam(row, {
			name: data.name,
			description: data.description,
			privacy: data.privacy,
			parentTeamId: data.parent_team_id,
			parentTeamSlug: data.parent_team_slug,
		});
	} catch (error) {
		mapTeamError(error);
	}
	return respondWithTeam(organization, updated);
}

/** `DELETE /orgs/{org}/teams/{team_slug}`. */
export async function deleteTeamHandler(ctx: ApiContext) {
	const { organization, team: row } = await teamNamed(
		ctx,
		"teams/delete-in-org",
	);
	await requireOwner(ctx, organization);
	await deleteTeam(row);
	return noContent();
}

/** `GET /orgs/{org}/teams/{team_slug}/members`. */
export async function listTeamMembersHandler(ctx: ApiContext) {
	const { organization, team: row } = await teamNamed(
		ctx,
		"teams/list-members-in-org",
	);
	await requireTeamRead(ctx, organization, row);
	const query = queryParams(ctx, "teams/list-members-in-org", "Team");
	const params = pageParams(ctx.url.searchParams);
	if (!params.reachable) return json([], 200, linkHeader(ctx.url, params, 0));
	const page = await listTeamMembers(
		row.id,
		{ limit: params.perPage, offset: params.offset },
		query.role === "all" ? undefined : query.role,
	);
	return json(
		page.rows.map((member) => simpleUser(member.user)),
		200,
		linkHeader(ctx.url, params, page.total),
	);
}

/** `GET /orgs/{org}/teams/{team_slug}/teams`. */
export async function listChildTeamsHandler(ctx: ApiContext) {
	const { organization, team: row } = await teamNamed(
		ctx,
		"teams/list-child-in-org",
	);
	await requireTeamRead(ctx, organization, row);
	queryParams(ctx, "teams/list-child-in-org", "Team");
	const params = pageParams(ctx.url.searchParams);
	if (!params.reachable) return json([], 200, linkHeader(ctx.url, params, 0));
	const page = await listChildTeams(row.id, {
		limit: params.perPage,
		offset: params.offset,
	});
	const counts = await teamCounts(page.rows.map((child) => child.id));
	return json(
		page.rows.map((child) =>
			team({
				team: child,
				organization,
				counts: counts.get(child.id) ?? { members: 0, repos: 0 },
				parent: { team: row, counts: { members: 0, repos: 0 } },
			}),
		),
		200,
		linkHeader(ctx.url, params, page.total),
	);
}

/** `GET /orgs/{org}/teams/{team_slug}/repos`. */
export async function listTeamReposHandler(ctx: ApiContext) {
	const { organization, team: row } = await teamNamed(
		ctx,
		"teams/list-repos-in-org",
	);
	const caller = await requireTeamRead(ctx, organization, row);
	queryParams(ctx, "teams/list-repos-in-org", "Team");
	const params = pageParams(ctx.url.searchParams);
	if (!params.reachable) return json([], 200, linkHeader(ctx.url, params, 0));
	const page = await listTeamRepositories(row.id, {
		limit: params.perPage,
		offset: params.offset,
	});
	const shapes = await Promise.all(
		page.rows.map(async ({ repo }) =>
			repositoryBrightness(
				await repositoryPayload(
					{ ...repo, owner: organizationOwner(organization) },
					caller.userId,
					{},
				),
			),
		),
	);
	return json(shapes, 200, linkHeader(ctx.url, params, page.total));
}

/** The organization as a repository owner, for a repository payload. */
function organizationOwner(organization: Organization) {
	return repositoryOwnerOf({
		owner: null,
		organization: {
			id: organization.id,
			login: organization.login,
			name: organization.name,
		},
	});
}

/** A repository payload as GitHub nests it: nothing to strip today. */
function repositoryBrightness<T>(payload: T): T {
	return payload;
}

/** `GET /orgs/{org}/teams/{team_slug}/repos/{owner}/{repo}`. */
export async function checkTeamRepoPermission(ctx: ApiContext) {
	const { organization, team: row } = await teamNamed(
		ctx,
		"teams/check-permissions-for-repo-in-org",
	);
	const caller = await requireTeamRead(ctx, organization, row);
	const { owner, repo } = pathParams(
		ctx,
		"teams/check-permissions-for-repo-in-org",
	);
	const repository = await organizationRepository(organization, owner, repo);
	const permission = await teamRepoPermission(row.id, repository.id);
	if (!permission) throw notFoundError();
	const rest = REST_PERMISSIONS[permission];
	const payload = await repositoryPayload(
		{ ...repository, owner: organizationOwner(organization) },
		caller.userId,
		{},
	);
	return json({
		...repositoryShape(
			{ ...repository, owner: organizationOwner(organization) },
			{ stars: 0, openIssues: 0, forksCount: 0 },
		),
		...payload,
		role_name: rest,
		permissions: {
			admin: rest === "admin",
			push: rest !== "pull",
			pull: true,
			triage: rest !== "pull",
			maintain: rest === "maintain" || rest === "admin",
		},
	});
}

/** `PUT /orgs/{org}/teams/{team_slug}/repos/{owner}/{repo}`. */
export async function setTeamRepoPermissionHandler(ctx: ApiContext) {
	const { organization, team: row } = await teamNamed(
		ctx,
		"teams/add-or-update-repo-permissions-in-org",
	);
	await requireTeamManager(ctx, organization, row);
	const { owner, repo } = pathParams(
		ctx,
		"teams/add-or-update-repo-permissions-in-org",
	);
	const repository = await organizationRepository(organization, owner, repo);
	const data = await requestBody(
		ctx,
		"teams/add-or-update-repo-permissions-in-org",
		"Team",
	);
	await setTeamRepoPermission(
		row.id,
		repository.id,
		teamPermissionFromRest(data.permission),
	);
	return noContent();
}

/** `DELETE /orgs/{org}/teams/{team_slug}/repos/{owner}/{repo}`. */
export async function removeTeamRepoHandler(ctx: ApiContext) {
	const { organization, team: row } = await teamNamed(
		ctx,
		"teams/remove-repo-in-org",
	);
	await requireTeamManager(ctx, organization, row);
	const { owner, repo } = pathParams(ctx, "teams/remove-repo-in-org");
	const repository = await organizationRepository(organization, owner, repo);
	await removeTeamRepo(row.id, repository.id);
	return noContent();
}

/** `GET /orgs/{org}/teams/{team_slug}/memberships/{username}`. */
export async function getTeamMembership(ctx: ApiContext) {
	const { organization, team: row } = await teamNamed(
		ctx,
		"teams/get-membership-for-user-in-org",
	);
	await requireTeamRead(ctx, organization, row);
	const { username } = pathParams(ctx, "teams/get-membership-for-user-in-org");
	const member = await userByLogin(username);
	const membership = await teamMembershipOf(row.id, member.id);
	if (!membership) throw notFoundError();
	return json(
		teamMembership(organization, row, member.username, membership.role),
	);
}

/** `PUT /orgs/{org}/teams/{team_slug}/memberships/{username}`. */
export async function setTeamMembershipHandler(ctx: ApiContext) {
	const { organization, team: row } = await teamNamed(
		ctx,
		"teams/add-or-update-membership-for-user-in-org",
	);
	await requireTeamManager(ctx, organization, row);
	const { username } = pathParams(
		ctx,
		"teams/add-or-update-membership-for-user-in-org",
	);
	const member = await userByLogin(username);
	const orgMembership = await membershipOf(organization.id, member.id);
	if (orgMembership?.state !== "active") {
		throw new ApiError(422, "User is not a member of the organization");
	}
	const data = await requestBody(
		ctx,
		"teams/add-or-update-membership-for-user-in-org",
		"Team",
	);
	const membership = await setTeamMembership(row.id, member.id, data.role);
	return json(
		teamMembership(organization, row, member.username, membership.role),
	);
}

/** `DELETE /orgs/{org}/teams/{team_slug}/memberships/{username}`. */
export async function removeTeamMembershipHandler(ctx: ApiContext) {
	const { organization, team: row } = await teamNamed(
		ctx,
		"teams/remove-membership-for-user-in-org",
	);
	await requireTeamManager(ctx, organization, row);
	const { username } = pathParams(
		ctx,
		"teams/remove-membership-for-user-in-org",
	);
	const member = await userByLogin(username);
	await removeTeamMembership(row.id, member.id);
	return noContent();
}
