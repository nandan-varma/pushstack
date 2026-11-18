/**
 * @vitest-environment node
 *
 * REST teams: `teams/*` under an organization — CRUD with derived slugs,
 * nesting that refuses depth and cycles inside the write, memberships with
 * roles, and repository grants that only a maintainer may change.
 */
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
const { asToken, call, mintToken, patch, post } = await import(
	"../../test/api-client"
);
const { createOrganization } = await import("../organizations-store");
const { setOrganizationMembership } = await import("../organization-members");
const { db } = await import("#/db");
const { teams } = await import("#/db/app-schema");
const { eq } = await import("drizzle-orm");

const users = await createUsers("alice", "bob", "carol", "dave");
let alice: string;
let bob: string;
let carol: string;
let dave: string;

const put = (token: string, body?: unknown) => ({
	...asToken(token),
	method: "PUT",
	body: body === undefined ? undefined : JSON.stringify(body),
});
const del = (token: string) => ({ ...asToken(token), method: "DELETE" });

async function createTeam(token: string, body: Record<string, unknown>) {
	return call("/orgs/acme/teams", post(token, body));
}

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	bob = await mintToken(users.bob, ["repo:write"]);
	carol = await mintToken(users.carol, ["repo:write"]);
	dave = await mintToken(users.dave, ["repo:write"]);
	const organization = await createOrganization({ login: "acme" });
	await setOrganizationMembership(organization.id, users.alice.id, "admin");
	for (const member of [users.bob, users.carol, users.dave]) {
		await setOrganizationMembership(organization.id, member.id, "member");
	}
	await call("/orgs/acme/repos", post(alice, { name: "widgets" }));
});

describe("team CRUD", () => {
	it("creates a team with a slug derived from its name", async () => {
		const created = await createTeam(alice, {
			name: "Core Team",
			description: "The core",
			privacy: "closed",
		});
		expect(created.status).toBe(201);
		expect(created.body).toMatchObject({
			name: "Core Team",
			slug: "core-team",
			description: "The core",
			privacy: "closed",
			notification_setting: "notifications_enabled",
			permission: "pull",
			members_count: 0,
			repos_count: 0,
			parent: null,
			organization: { login: "acme" },
		});
		expect(created.body.node_id).toBe(
			Buffer.from(`04:Team${created.body.id}`).toString("base64"),
		);
	});

	it("is 422 for a duplicate slug in one organization", async () => {
		const response = await createTeam(alice, { name: "core team" });
		expect(response.status).toBe(422);
		expect(response.body.errors[0].field).toBe("name");
	});

	it("needs an organization owner", async () => {
		expect((await createTeam(bob, { name: "Members" })).status).toBe(403);
	});

	it("gets, updates and deletes a team", async () => {
		expect((await createTeam(alice, { name: "Renamable" })).status).toBe(201);
		const updated = await call(
			"/orgs/acme/teams/renamable",
			patch(alice, { name: "Renamed Team", description: "New" }),
		);
		expect(updated.status).toBe(200);
		expect(updated.body).toMatchObject({
			name: "Renamed Team",
			slug: "renamed-team",
			description: "New",
		});
		expect(
			(await call("/orgs/acme/teams/renamed-team", asToken(alice))).status,
		).toBe(200);
		expect(
			(await call("/orgs/acme/teams/renamed-team", del(alice))).status,
		).toBe(204);
		expect(
			(await call("/orgs/acme/teams/renamed-team", asToken(alice))).status,
		).toBe(404);
	});

	it("hides the teams from a non-member", async () => {
		const outsider = await createUsers("eve");
		const eve = await mintToken(outsider.eve, ["repo:read"]);
		expect((await call("/orgs/acme/teams", asToken(eve))).status).toBe(404);
		expect(
			(await call("/orgs/acme/teams/core-team", asToken(eve))).status,
		).toBe(404);
	});
});

describe("team nesting", () => {
	it("refuses a 6th level and leaves no row", async () => {
		let parent: string | undefined;
		for (let level = 1; level <= 5; level++) {
			const created = await createTeam(alice, {
				name: `Level ${level}`,
				...(parent ? { parent_team_slug: parent } : {}),
			});
			expect(created.status).toBe(201);
			parent = created.body.slug;
		}
		const tooDeep = await createTeam(alice, {
			name: "Level 6",
			parent_team_slug: parent,
		});
		expect(tooDeep.status).toBe(422);
		expect(
			(await db.select().from(teams).where(eq(teams.name, "Level 6"))).length,
		).toBe(0);
		const children = await call(
			`/orgs/acme/teams/${parent}/teams`,
			asToken(alice),
		);
		expect(children.body).toEqual([]);
	});

	it("refuses a descendant as a parent (cycle)", async () => {
		const parent = await createTeam(alice, { name: "Cycle Parent" });
		const child = await createTeam(alice, {
			name: "Cycle Child",
			parent_team_slug: parent.body.slug,
		});
		const response = await call(
			`/orgs/acme/teams/${parent.body.slug}`,
			patch(alice, { parent_team_slug: child.body.slug }),
		);
		expect(response.status).toBe(422);
	});

	it("lists child teams one level below", async () => {
		const children = await call(
			"/orgs/acme/teams/cycle-parent/teams",
			asToken(alice),
		);
		expect(children.body.map((team: { slug: string }) => team.slug)).toEqual([
			"cycle-child",
		]);
	});
});

describe("team memberships", () => {
	it("adds a maintainer and a plain member", async () => {
		const maintainer = await call(
			"/orgs/acme/teams/core-team/memberships/bob",
			put(alice, { role: "maintainer" }),
		);
		expect(maintainer.status).toBe(200);
		expect(maintainer.body).toMatchObject({
			role: "maintainer",
			state: "active",
		});

		const member = await call(
			"/orgs/acme/teams/core-team/memberships/carol",
			put(alice, { role: "member" }),
		);
		expect(member.body.role).toBe("member");

		const fetched = await call(
			"/orgs/acme/teams/core-team/memberships/carol",
			asToken(alice),
		);
		expect(fetched.body.role).toBe("member");

		const members = await call(
			"/orgs/acme/teams/core-team/members",
			asToken(alice),
		);
		expect(members.body.map((row: { login: string }) => row.login)).toEqual([
			"bob",
			"carol",
		]);
	});

	it("is 422 for a user who is not an organization member", async () => {
		const nonMember = await createUsers("frank");
		await call(
			"/orgs/acme/teams/core-team/memberships/bob",
			put(alice, { role: "maintainer" }),
		);
		const frank = await mintToken(nonMember.frank, ["repo:read"]);
		expect(frank).toBeTruthy();
		const response = await call(
			"/orgs/acme/teams/core-team/memberships/frank",
			put(alice, { role: "member" }),
		);
		expect(response.status).toBe(422);
	});

	it("removes a membership", async () => {
		const response = await call(
			"/orgs/acme/teams/core-team/memberships/carol",
			del(alice),
		);
		expect(response.status).toBe(204);
		expect(
			(
				await call(
					"/orgs/acme/teams/core-team/memberships/carol",
					asToken(alice),
				)
			).status,
		).toBe(404);
	});
});

describe("team repository grants", () => {
	it("lets a maintainer grant a repository and refuses a plain member", async () => {
		const granted = await call(
			"/orgs/acme/teams/core-team/repos/acme/widgets",
			put(bob, { permission: "push" }),
		);
		expect(granted.status).toBe(204);

		const checked = await call(
			"/orgs/acme/teams/core-team/repos/acme/widgets",
			asToken(bob),
		);
		expect(checked.status).toBe(200);
		expect(checked.body).toMatchObject({
			full_name: "acme/widgets",
			role_name: "push",
			permissions: { push: true, pull: true, admin: false },
		});

		await call(
			"/orgs/acme/teams/core-team/memberships/carol",
			put(alice, { role: "member" }),
		);
		const refused = await call(
			"/orgs/acme/teams/core-team/repos/acme/widgets",
			put(carol, { permission: "admin" }),
		);
		expect(refused.status).toBe(403);

		const team = await call("/orgs/acme/teams/core-team", asToken(alice));
		expect(team.body.repos_count).toBe(1);

		const repos = await call(
			"/orgs/acme/teams/core-team/repos",
			asToken(alice),
		);
		expect(
			repos.body.map((repo: { full_name: string }) => repo.full_name),
		).toEqual(["acme/widgets"]);

		expect(
			(await call("/orgs/acme/teams/core-team/repos/acme/widgets", del(bob)))
				.status,
		).toBe(204);
	});

	it("is 404 for a repository outside the organization", async () => {
		await call("/user/repos", post(dave, { name: "personal" }));
		const response = await call(
			"/orgs/acme/teams/core-team/repos/dave/personal",
			put(alice, { permission: "read" }),
		);
		expect(response.status).toBe(404);
	});
});

describe("POST /orgs/{org}/repos with team_id", () => {
	it("grants the team when the caller belongs to it", async () => {
		const created = await call(
			"/orgs/acme/repos",
			post(bob, { name: "team-repo", team_id: 999_999 }),
		);
		expect(created.status).toBe(422);
		const team = await call("/orgs/acme/teams/core-team", asToken(alice));
		const ok = await call(
			"/orgs/acme/repos",
			post(bob, { name: "team-repo", team_id: team.body.id }),
		);
		expect(ok.status).toBe(201);
		const after = await call("/orgs/acme/teams/core-team", asToken(alice));
		expect(after.body.repos_count).toBe(1);
	});
});
