/**
 * Organization membership rows and the lists built on them. A membership is
 * `pending` until accepted; only `active` grants the organization's base
 * permission (repo-access.ts). Every mutation that can change a decision
 * evicts the access cache of the organization's repositories.
 */
import { and, count, eq, notExists, sql } from "drizzle-orm";
import { db } from "#/db";
import {
	type OrgMembership,
	organizations,
	orgMemberships,
	repositories,
	repositoryCollaborators,
} from "#/db/app-schema";
import { user } from "#/db/schema";
import type { OrgMembershipState } from "#/lib/org-membership";
import { organizationRepositoryIds } from "./org-access";
import { invalidateRepositoryAccess } from "./repo-access";
import type { PublicUser } from "./repository-lookup";
import { publicUserColumns } from "./repository-lookup";

export interface Page {
	limit: number;
	offset: number;
}

export interface OrganizationMember {
	membership: OrgMembership;
	user: PublicUser;
}

export interface UserOrganizationMembership {
	membership: OrgMembership;
	organization: typeof organizations.$inferSelect;
	user: PublicUser;
}

/** A member list, its total, and the page it answered. */
export interface MembershipPage<T> {
	rows: T[];
	total: number;
}

async function invalidateOrganizationRepositories(orgId: number) {
	for (const repoId of await organizationRepositoryIds(orgId)) {
		invalidateRepositoryAccess(repoId);
	}
}

export async function membershipOf(
	orgId: number,
	userId: string,
): Promise<OrgMembership | null> {
	const row = await db.query.orgMemberships.findFirst({
		where: { orgId, userId },
	});
	return row ?? null;
}

export async function listOrganizationMembers(
	orgId: number,
	page: Page,
): Promise<MembershipPage<OrganizationMember>> {
	const where = eq(orgMemberships.orgId, orgId);
	const [rows, [total]] = await Promise.all([
		db
			.select({ membership: orgMemberships, user: publicUserColumns })
			.from(orgMemberships)
			.innerJoin(user, eq(user.id, orgMemberships.userId))
			.where(and(where, eq(orgMemberships.state, "active")))
			.orderBy(user.username)
			.limit(page.limit)
			.offset(page.offset),
		db
			.select({ total: count() })
			.from(orgMemberships)
			.where(and(where, eq(orgMemberships.state, "active"))),
	]);
	return { rows, total: total?.total ?? 0 };
}

/** Add a member (or reactivate one) with `role`, in one upsert. */
export async function setOrganizationMembership(
	orgId: number,
	userId: string,
	role: OrgMembership["role"],
	state: OrgMembershipState = "active",
): Promise<OrgMembership> {
	const [row] = await db
		.insert(orgMemberships)
		.values({ orgId, userId, role, state })
		.onConflictDoUpdate({
			target: [orgMemberships.orgId, orgMemberships.userId],
			set: { role, state },
		})
		.returning();
	if (!row) throw new Error("Membership upsert returned no row");
	await invalidateOrganizationRepositories(orgId);
	return row;
}

/** True when a row was removed; a missing membership is not an error for DELETE. */
export async function removeOrganizationMembership(
	orgId: number,
	userId: string,
): Promise<boolean> {
	const removed = await db
		.delete(orgMemberships)
		.where(
			and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, userId)),
		)
		.returning({ userId: orgMemberships.userId });
	if (removed.length > 0) await invalidateOrganizationRepositories(orgId);
	return removed.length > 0;
}

export async function listMembershipsForUser(
	userId: string,
	page: Page,
	state?: OrgMembershipState,
): Promise<MembershipPage<UserOrganizationMembership>> {
	const where = and(
		eq(orgMemberships.userId, userId),
		state ? eq(orgMemberships.state, state) : undefined,
	);
	const [rows, [total]] = await Promise.all([
		db
			.select({
				membership: orgMemberships,
				organization: organizations,
				user: publicUserColumns,
			})
			.from(orgMemberships)
			.innerJoin(organizations, eq(organizations.id, orgMemberships.orgId))
			.innerJoin(user, eq(user.id, orgMemberships.userId))
			.where(where)
			.orderBy(organizations.login)
			.limit(page.limit)
			.offset(page.offset),
		db.select({ total: count() }).from(orgMemberships).where(where),
	]);
	return { rows, total: total?.total ?? 0 };
}

/** Users with a direct grant on an organization repository who are not members. */
export async function listOutsideCollaborators(
	orgId: number,
	page: Page,
): Promise<MembershipPage<PublicUser>> {
	const outside = notExists(
		db
			.select({ one: sql`1` })
			.from(orgMemberships)
			.where(
				and(
					eq(orgMemberships.orgId, orgId),
					eq(orgMemberships.userId, repositoryCollaborators.userId),
					eq(orgMemberships.state, "active"),
				),
			),
	);
	const where = and(eq(repositories.organizationId, orgId), outside);
	const [rows, [total]] = await Promise.all([
		db
			.select(publicUserColumns)
			.from(repositoryCollaborators)
			.innerJoin(
				repositories,
				eq(repositories.id, repositoryCollaborators.repoId),
			)
			.innerJoin(user, eq(user.id, repositoryCollaborators.userId))
			.where(where)
			.groupBy(user.id)
			.orderBy(user.username)
			.limit(page.limit)
			.offset(page.offset),
		db
			.select({
				total: sql<number>`count(distinct ${repositoryCollaborators.userId})`,
			})
			.from(repositoryCollaborators)
			.innerJoin(
				repositories,
				eq(repositories.id, repositoryCollaborators.repoId),
			)
			.where(where),
	]);
	return { rows, total: Number(total?.total ?? 0) };
}
