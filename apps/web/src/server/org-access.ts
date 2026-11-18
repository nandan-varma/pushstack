/**
 * Organization roles as the guard reads them: `admin` administers the
 * organization and its members, `member` is only eligible for the
 * organization's base repository permission. A pending membership has no role.
 */
import { db } from "#/db";
import type { orgMemberships } from "#/db/app-schema";

export type OrganizationRole = (typeof orgMemberships.$inferSelect)["role"];

export class OrganizationAccessError extends Error {
	constructor() {
		super("You must be an organization owner to perform this action");
	}
}

export async function organizationRoleOf(
	orgId: number,
	userId: string | null | undefined,
): Promise<OrganizationRole | null> {
	if (!userId) return null;
	const row = await db.query.orgMemberships.findFirst({
		columns: { role: true },
		where: { orgId, userId, state: "active" },
	});
	return row?.role ?? null;
}

/** The caller's role, or the error a handler maps to GitHub's 403. */
export async function requireOrganizationRole(
	orgId: number,
	userId: string,
	roles: readonly OrganizationRole[],
): Promise<OrganizationRole> {
	const role = await organizationRoleOf(orgId, userId);
	if (!role || !roles.includes(role)) throw new OrganizationAccessError();
	return role;
}

/** Every repository the organization owns (the rows an access change affects). */
export function organizationRepositoryIds(orgId: number): Promise<number[]> {
	return db.query.repositories
		.findMany({
			columns: { id: true },
			where: { organizationId: orgId },
		})
		.then((rows) => rows.map((row) => row.id));
}
