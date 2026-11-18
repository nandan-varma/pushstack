/**
 * Teams: rows, derived storage-adjacent slugs, nesting and repository grants.
 * Nesting depth and cycles are decided here, inside the write, from the
 * organization's whole team tree (bounded by MAX_TEAMS_PER_ORG), never from
 * the request alone.
 */
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { db } from "#/db";
import {
	type Repository,
	repositories,
	type Team,
	teamMemberships,
	teamRepositories,
	teams,
} from "#/db/app-schema";
import { user } from "#/db/schema";
import {
	MAX_TEAM_NESTING_DEPTH,
	MAX_TEAM_REPOS,
	MAX_TEAMS_PER_ORG,
} from "#/lib/limits";
import { STORAGE_NAME_RE } from "#/lib/storage-name";
import { isUniqueViolation } from "./db-errors";
import { invalidateRepositoryAccess } from "./repo-access";
import { publicUserColumns } from "./repository-owner";

/** A name that cannot become a slug GitHub would accept (422). */
export class TeamNameInvalidError extends Error {
	constructor() {
		super("Team name is invalid");
	}
}

/** The slug is already taken in this organization (422). */
export class TeamExistsError extends Error {
	constructor() {
		super("Team already exists");
	}
}

/** The organization holds MAX_TEAMS_PER_ORG teams (422). */
export class TeamLimitError extends Error {
	constructor() {
		super("Organization has reached its team limit");
	}
}

/** The parent would exceed MAX_TEAM_NESTING_DEPTH or close a cycle (422). */
export class TeamNestingError extends Error {}

export function teamSlug(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^[-.]+|[-.]+$/g, "");
}

type TeamRow = Pick<Team, "id" | "orgId" | "name" | "slug" | "parentTeamId">;

/** Every team of an organization, for the nesting rules (bounded by the cap). */
async function teamTree(orgId: number): Promise<TeamRow[]> {
	return db
		.select({
			id: teams.id,
			orgId: teams.orgId,
			name: teams.name,
			slug: teams.slug,
			parentTeamId: teams.parentTeamId,
		})
		.from(teams)
		.where(eq(teams.orgId, orgId))
		.limit(MAX_TEAMS_PER_ORG + 1);
}

/** A team's depth: 1 at the root. Throws on an existing cycle. */
function depthOf(tree: TeamRow[], teamId: number | null): number {
	let depth = 0;
	let current = teamId;
	while (current !== null) {
		if (depth > MAX_TEAM_NESTING_DEPTH) throw new TeamNestingError();
		const row = tree.find((team) => team.id === current);
		if (!row) throw new TeamNestingError();
		current = row.parentTeamId;
		depth++;
	}
	return depth;
}

/** The deepest descendant below `teamId` (0 for a leaf). */
function subtreeDepth(tree: TeamRow[], teamId: number): number {
	let deepest = 0;
	for (const row of tree) {
		let current = row.parentTeamId;
		let depth = 0;
		while (current !== null) {
			depth++;
			if (current === teamId) {
				deepest = Math.max(deepest, depth);
				break;
			}
			const parent = tree.find((team) => team.id === current);
			if (!parent) break;
			current = parent.parentTeamId;
		}
	}
	return deepest;
}

/**
 * The parent named by `parentTeamId` or `parentTeamSlug`, checked against the
 * depth cap. `moving` is the team being re-parented (it cannot move under its
 * own subtree).
 */
async function resolveParent(
	orgId: number,
	parent: { id?: number | null; slug?: string | null },
	moving?: number,
): Promise<TeamRow | null> {
	if (parent.id == null && parent.slug == null) return null;
	if (parent.id != null && parent.slug != null) throw new TeamNestingError();
	const tree = await teamTree(orgId);
	const found =
		parent.id != null
			? tree.find((team) => team.id === parent.id)
			: tree.find(
					(team) => team.slug.toLowerCase() === parent.slug?.toLowerCase(),
				);
	if (!found) throw new TeamNestingError();
	if (moving !== undefined) {
		// A team cannot become its own descendant.
		let current: number | null = found.id;
		let guard = 0;
		while (current !== null) {
			if (current === moving) throw new TeamNestingError();
			current = tree.find((team) => team.id === current)?.parentTeamId ?? null;
			if (++guard > MAX_TEAM_NESTING_DEPTH + 1) throw new TeamNestingError();
		}
	}
	const depth = depthOf(tree, found.id);
	const deepest = moving === undefined ? 1 : 1 + subtreeDepth(tree, moving);
	if (depth + deepest > MAX_TEAM_NESTING_DEPTH) throw new TeamNestingError();
	return found;
}

export interface CreateTeamInput {
	name: string;
	description?: string | null;
	privacy?: "closed" | "secret";
	parentTeamId?: number;
	parentTeamSlug?: string;
}

export async function createTeam(
	orgId: number,
	input: CreateTeamInput,
): Promise<Team> {
	const slug = teamSlug(input.name);
	if (!STORAGE_NAME_RE.test(slug)) throw new TeamNameInvalidError();
	const [{ total } = { total: 0 }] = await db
		.select({ total: count() })
		.from(teams)
		.where(eq(teams.orgId, orgId));
	if (total >= MAX_TEAMS_PER_ORG) throw new TeamLimitError();
	const parent = await resolveParent(orgId, {
		id: input.parentTeamId,
		slug: input.parentTeamSlug,
	});
	try {
		const [team] = await db
			.insert(teams)
			.values({
				orgId,
				slug,
				name: input.name,
				description: input.description || null,
				privacy: input.privacy ?? "closed",
				parentTeamId: parent?.id ?? null,
			})
			.returning();
		if (!team) throw new Error("Team insert returned no row");
		return team;
	} catch (error) {
		if (isUniqueViolation(error)) throw new TeamExistsError();
		throw error;
	}
}

export interface UpdateTeamInput {
	name?: string;
	description?: string | null;
	privacy?: "closed" | "secret";
	parentTeamId?: number | null;
	parentTeamSlug?: string | null;
}

export async function updateTeam(
	team: Team,
	input: UpdateTeamInput,
): Promise<Team> {
	const movingParent =
		input.parentTeamId !== undefined || input.parentTeamSlug !== undefined;
	const parent = movingParent
		? await resolveParent(
				team.orgId,
				{ id: input.parentTeamId, slug: input.parentTeamSlug },
				team.id,
			)
		: null;
	const name = input.name ?? team.name;
	const slug = input.name === undefined ? team.slug : teamSlug(name);
	if (!STORAGE_NAME_RE.test(slug)) throw new TeamNameInvalidError();
	try {
		const [updated] = await db
			.update(teams)
			.set({
				name,
				slug,
				description:
					input.description === undefined
						? team.description
						: input.description || null,
				privacy: input.privacy ?? team.privacy,
				parentTeamId: movingParent ? (parent?.id ?? null) : team.parentTeamId,
				updatedAt: new Date(),
			})
			.where(eq(teams.id, team.id))
			.returning();
		if (!updated) throw new Error("Team update returned no row");
		return updated;
	} catch (error) {
		if (isUniqueViolation(error)) throw new TeamExistsError();
		throw error;
	}
}

/** Delete a team; its children move to its parent, as GitHub does. */
export async function deleteTeam(team: Team): Promise<void> {
	await db.transaction(async (tx) => {
		await tx
			.update(teams)
			.set({ parentTeamId: team.parentTeamId })
			.where(eq(teams.parentTeamId, team.id));
		await tx.delete(teams).where(eq(teams.id, team.id));
	});
}

export function findTeamBySlug(
	orgId: number,
	slug: string,
): Promise<Team | null> {
	if (!STORAGE_NAME_RE.test(slug)) return Promise.resolve(null);
	return db
		.select()
		.from(teams)
		.where(
			and(
				eq(teams.orgId, orgId),
				sql`lower(${teams.slug}) = ${slug.toLowerCase()}`,
			),
		)
		.limit(1)
		.then(([row]) => row ?? null);
}

export function findTeamById(teamId: number): Promise<Team | null> {
	return db
		.select()
		.from(teams)
		.where(eq(teams.id, teamId))
		.limit(1)
		.then(([row]) => row ?? null);
}

export interface Page {
	limit: number;
	offset: number;
}

/** A team list with its covered window's total. */
export interface TeamPage {
	rows: Team[];
	total: number;
}

/** Teams the caller may see: all for an organization owner, otherwise closed and own. */
export function listTeams(
	orgId: number,
	page: Page,
	viewer: { userId: string; isOrgAdmin: boolean },
	userLogins?: string[],
): Promise<TeamPage> {
	const memberLogins = userLogins?.length
		? sql`exists (select 1 from ${teamMemberships} inner join ${user} on ${user.id} = ${teamMemberships.userId} where ${teamMemberships.teamId} = ${teams.id} and ${user.username} in ${userLogins})`
		: undefined;
	const visible = viewer.isOrgAdmin
		? and(eq(teams.orgId, orgId), memberLogins)
		: and(
				eq(teams.orgId, orgId),
				sql`(${teams.privacy} = 'closed' or exists (select 1 from ${teamMemberships} where ${teamMemberships.teamId} = ${teams.id} and ${teamMemberships.userId} = ${viewer.userId}))`,
				memberLogins,
			);
	return pageOf(visible, page);
}

export function listChildTeams(teamId: number, page: Page): Promise<TeamPage> {
	return pageOf(eq(teams.parentTeamId, teamId), page);
}

async function pageOf(
	where: ReturnType<typeof and>,
	page: Page,
): Promise<TeamPage> {
	const [rows, [total]] = await Promise.all([
		db
			.select()
			.from(teams)
			.where(where)
			.orderBy(teams.slug)
			.limit(page.limit)
			.offset(page.offset),
		db.select({ total: count() }).from(teams).where(where),
	]);
	return { rows, total: total?.total ?? 0 };
}

/** Team members (all roles), with their user rows. */
export function listTeamMembers(
	teamId: number,
	page: Page,
	role?: "member" | "maintainer",
) {
	const where = and(
		eq(teamMemberships.teamId, teamId),
		role ? eq(teamMemberships.role, role) : undefined,
	);
	return Promise.all([
		db
			.select({ membership: teamMemberships, user: publicUserColumns })
			.from(teamMemberships)
			.innerJoin(user, eq(user.id, teamMemberships.userId))
			.where(where)
			.orderBy(user.username)
			.limit(page.limit)
			.offset(page.offset),
		db
			.select({ total: count() })
			.from(teamMemberships)
			.where(where)
			.then(([row]) => row?.total ?? 0),
	]).then(([rows, total]) => ({ rows, total }));
}

export function teamMembershipOf(
	teamId: number,
	userId: string,
): Promise<{ role: "member" | "maintainer" } | null> {
	return db.query.teamMemberships
		.findFirst({
			columns: { role: true },
			where: { teamId, userId },
		})
		.then((row) => row ?? null);
}

export async function setTeamMembership(
	teamId: number,
	userId: string,
	role: "member" | "maintainer",
) {
	const [row] = await db
		.insert(teamMemberships)
		.values({ teamId, userId, role })
		.onConflictDoUpdate({
			target: [teamMemberships.teamId, teamMemberships.userId],
			set: { role },
		})
		.returning();
	if (!row) throw new Error("Team membership upsert returned no row");
	await invalidateTeamRepositories(teamId);
	return row;
}

export async function removeTeamMembership(
	teamId: number,
	userId: string,
): Promise<boolean> {
	const removed = await db
		.delete(teamMemberships)
		.where(
			and(
				eq(teamMemberships.teamId, teamId),
				eq(teamMemberships.userId, userId),
			),
		)
		.returning({ userId: teamMemberships.userId });
	if (removed.length > 0) await invalidateTeamRepositories(teamId);
	return removed.length > 0;
}

/** The team's member count and repository count, for its shape. */
export async function teamCounts(
	teamIds: number[],
): Promise<Map<number, { members: number; repos: number }>> {
	const counts = new Map<number, { members: number; repos: number }>(
		teamIds.map((id) => [id, { members: 0, repos: 0 }]),
	);
	if (teamIds.length === 0) return counts;
	const [members, repos] = await Promise.all([
		db
			.select({ teamId: teamMemberships.teamId, total: count() })
			.from(teamMemberships)
			.where(inArray(teamMemberships.teamId, teamIds))
			.groupBy(teamMemberships.teamId),
		db
			.select({ teamId: teamRepositories.teamId, total: count() })
			.from(teamRepositories)
			.where(inArray(teamRepositories.teamId, teamIds))
			.groupBy(teamRepositories.teamId),
	]);
	for (const row of members) {
		const entry = counts.get(row.teamId);
		if (entry) entry.members = row.total;
	}
	for (const row of repos) {
		const entry = counts.get(row.teamId);
		if (entry) entry.repos = row.total;
	}
	return counts;
}

/** A team's grants with the repository rows they name. */
export interface TeamRepositoryRow {
	grant: { permission: "read" | "triage" | "write" | "maintain" | "admin" };
	repo: Repository;
}

export function listTeamRepositories(
	teamId: number,
	page: Page,
): Promise<{ rows: TeamRepositoryRow[]; total: number }> {
	const where = eq(teamRepositories.teamId, teamId);
	return Promise.all([
		db
			.select({
				grant: { permission: teamRepositories.permission },
				repo: repositories,
			})
			.from(teamRepositories)
			.innerJoin(repositories, eq(repositories.id, teamRepositories.repoId))
			.where(where)
			.orderBy(repositories.name)
			.limit(page.limit)
			.offset(page.offset),
		db
			.select({ total: count() })
			.from(teamRepositories)
			.where(where)
			.then(([row]) => row?.total ?? 0),
	]).then(([rows, total]) => ({ rows, total }));
}

const PERMISSIONS = ["read", "triage", "write", "maintain", "admin"] as const;
export type TeamPermission = (typeof PERMISSIONS)[number];

/** GitHub's permission names as the ladder stores them. */
export const REST_PERMISSIONS: Record<
	TeamPermission,
	"pull" | "triage" | "push" | "maintain" | "admin"
> = {
	read: "pull",
	triage: "triage",
	write: "push",
	maintain: "maintain",
	admin: "admin",
};

export function teamPermissionFromRest(
	permission: "pull" | "triage" | "push" | "maintain" | "admin",
): TeamPermission {
	return permission === "pull"
		? "read"
		: permission === "push"
			? "write"
			: permission;
}

export function teamRepoPermission(
	teamId: number,
	repoId: number,
): Promise<TeamPermission | null> {
	return db.query.teamRepositories
		.findFirst({
			columns: { permission: true },
			where: { teamId, repoId },
		})
		.then((row) => row?.permission ?? null);
}

/** Grant a repository to a team (bounded per team), evicting the access cache. */
export async function setTeamRepoPermission(
	teamId: number,
	repoId: number,
	permission: TeamPermission,
): Promise<void> {
	const existing = await teamRepoPermission(teamId, repoId);
	if (!existing) {
		const [{ total } = { total: 0 }] = await db
			.select({ total: count() })
			.from(teamRepositories)
			.where(eq(teamRepositories.teamId, teamId));
		if (total >= MAX_TEAM_REPOS) throw new TeamLimitError();
	}
	await db
		.insert(teamRepositories)
		.values({ teamId, repoId, permission })
		.onConflictDoUpdate({
			target: [teamRepositories.teamId, teamRepositories.repoId],
			set: { permission },
		});
	await invalidateRepositoryAccess(repoId);
}

export async function removeTeamRepo(
	teamId: number,
	repoId: number,
): Promise<boolean> {
	const removed = await db
		.delete(teamRepositories)
		.where(
			and(
				eq(teamRepositories.teamId, teamId),
				eq(teamRepositories.repoId, repoId),
			),
		)
		.returning({ repoId: teamRepositories.repoId });
	if (removed.length > 0) await invalidateRepositoryAccess(repoId);
	return removed.length > 0;
}

async function invalidateTeamRepositories(teamId: number): Promise<void> {
	const rows = await db
		.select({ repoId: teamRepositories.repoId })
		.from(teamRepositories)
		.where(eq(teamRepositories.teamId, teamId));
	for (const row of rows) invalidateRepositoryAccess(row.repoId);
}
