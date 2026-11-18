/**
 * @vitest-environment node
 *
 * Organization memberships in the access ladder: the organization's base
 * permission is a floor under a direct collaborator grant, a pending
 * membership grants nothing, and a removal is live on the next request.
 */
import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));
vi.mock("@tanstack/react-start", () => import("../../test/server-test-utils"));
vi.mock(
	"#/server/session",
	async () => (await import("../../test/app-harness")).sessionModule,
);

const { createUsers } = await import("../../test/app-harness");
const { db } = await import("#/db");
const { repositories, repositoryCollaborators } = await import(
	"../../db/app-schema"
);
const { createOrganization } = await import("../organizations-store");
const { removeOrganizationMembership, setOrganizationMembership } =
	await import("../organization-members");
const { getAccessForRepository, getRepositoryAccess } = await import(
	"../repo-access"
);
const { mintToken, call } = await import("../../test/api-client");

type BasePermission = "none" | "read" | "write" | "admin";
type DirectRole = "read" | "triage" | "write" | "maintain" | "admin";

const users = await createUsers("orgadmin", "orgmember", "orgoutsider");
let organizationId: number;
let repository: typeof repositories.$inferSelect;
let adminToken: string;

const RANK: Record<BasePermission | DirectRole, number> = {
	none: 0,
	read: 1,
	triage: 2,
	write: 3,
	maintain: 4,
	admin: 5,
};

const EXPECTED = {
	read: { read: true, write: false, moderate: false, merge: false },
	triage: { read: true, write: false, moderate: true, merge: false },
	write: { read: true, write: true, moderate: false, merge: true },
	maintain: { read: true, write: true, moderate: true, merge: true },
	admin: { read: true, write: true, moderate: true, merge: true },
	none: { read: false, write: false, moderate: false, merge: false },
} as const;

beforeAll(async () => {
	const organization = await createOrganization({ login: "acme" });
	organizationId = organization.id;
	await setOrganizationMembership(organizationId, users.orgadmin.id, "admin");
	await setOrganizationMembership(organizationId, users.orgmember.id, "member");
	const [row] = await db
		.insert(repositories)
		.values({
			organizationId,
			name: "secret",
			visibility: "private",
		})
		.returning();
	if (!row) throw new Error("repository insert returned no row");
	repository = row;
	adminToken = await mintToken(users.orgadmin, ["repo:write"]);
});

async function accessFor(base: BasePermission, direct: DirectRole | null) {
	await db.execute(
		sql`update organizations set default_repository_permission = ${base} where id = ${organizationId}`,
	);
	await db
		.delete(repositoryCollaborators)
		.where(
			and(
				eq(repositoryCollaborators.repoId, repository.id),
				eq(repositoryCollaborators.userId, users.orgmember.id),
			),
		);
	if (direct) {
		await db.insert(repositoryCollaborators).values({
			repoId: repository.id,
			userId: users.orgmember.id,
			role: direct,
		});
	}
	return getAccessForRepository(repository, users.orgmember.id);
}

describe("the organization base permission", () => {
	it.each([
		["none", "read"],
		["none", "triage"],
		["none", "write"],
		["none", "maintain"],
		["none", "admin"],
		["none", null],
		["read", null],
		["read", "triage"],
		["read", "write"],
		["write", null],
		["write", "maintain"],
		["admin", null],
		["admin", "read"],
	] as Array<[BasePermission, DirectRole | null]>)(
		"highest of base %s and direct %s",
		async (base, direct) => {
			const access = await accessFor(base, direct);
			const effective =
				RANK[base] >= RANK[direct ?? "none"] ? base : (direct as DirectRole);
			const expected = EXPECTED[effective];
			expect({
				read: access.canRead,
				write: access.canWrite,
				moderate: access.canModerate,
				merge: access.canMergePullRequest,
			}).toEqual(expected);
			expect(access.role).toBe(effective === "none" ? "anonymous" : effective);
		},
	);

	it("grants nothing while the membership is pending", async () => {
		await db.execute(
			sql`update org_memberships set state = 'pending' where org_id = ${organizationId} and user_id = ${users.orgmember.id}`,
		);
		const access = await accessFor("admin", null);
		expect(access.canRead).toBe(false);
		expect(access.role).toBe("anonymous");
		await db.execute(
			sql`update org_memberships set state = 'active' where org_id = ${organizationId} and user_id = ${users.orgmember.id}`,
		);
	});
});

describe("organization membership REST", () => {
	beforeAll(async () => {
		await db.execute(
			sql`update organizations set default_repository_permission = 'read' where id = ${organizationId}`,
		);
	});

	it("answers the membership object gh reads", async () => {
		const put = await call("/orgs/acme/memberships/orgmember", {
			authorization: `token ${adminToken}`,
			method: "PUT",
			body: JSON.stringify({ role: "member" }),
		});
		expect(put.status).toBe(200);
		expect(Object.keys(put.body).sort()).toEqual([
			"organization",
			"organization_url",
			"role",
			"state",
			"url",
			"user",
		]);

		const read = await call("/orgs/acme/memberships/orgmember", {
			authorization: `token ${adminToken}`,
		});
		expect(read.status).toBe(200);
		expect(read.body).toMatchObject({
			state: "active",
			role: "member",
			organization: { login: "acme" },
			user: { login: "orgmember" },
		});

		const members = await call("/orgs/acme/members", {
			authorization: `token ${adminToken}`,
		});
		expect(members.status).toBe(200);
		expect(
			members.body.map((member: { login: string }) => member.login),
		).toEqual(["orgadmin", "orgmember"]);

		const mine = await call("/user/memberships/orgs", {
			authorization: `token ${adminToken}`,
		});
		expect(mine.status).toBe(200);
		expect(mine.body[0]).toMatchObject({
			state: "active",
			role: "admin",
			organization: { login: "acme" },
		});
	});

	it("removes the member's read access on the next request", async () => {
		expect(
			(await getRepositoryAccess(repository.id, users.orgmember.id))?.canRead,
		).toBe(true);
		const removed = await call("/orgs/acme/members/orgmember", {
			authorization: `token ${adminToken}`,
			method: "DELETE",
		});
		expect(removed.status).toBe(204);
		expect(
			(await getRepositoryAccess(repository.id, users.orgmember.id))?.canRead,
		).toBe(false);
	});

	it("refuses member management to a plain member", async () => {
		await setOrganizationMembership(
			organizationId,
			users.orgoutsider.id,
			"member",
		);
		const token = await mintToken(users.orgoutsider, ["repo:write"]);
		const listed = await call("/orgs/acme/outside_collaborators", {
			authorization: `token ${token}`,
		});
		expect(listed.status).toBe(403);
		await removeOrganizationMembership(organizationId, users.orgoutsider.id);
	});
});
