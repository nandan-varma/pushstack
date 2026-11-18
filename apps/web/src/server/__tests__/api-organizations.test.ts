/**
 * @vitest-environment node
 *
 * REST organizations: `GET /orgs/{org}` (the pinned key set), `GET /user/orgs`
 * and `/users/{username}/orgs` (what `gh org list` calls), `GET
 * /orgs/{org}/repos` and `POST /orgs/{org}/repos` (what `gh repo list <org>`
 * and `gh repo create <org>/<name>` call).
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
const { asToken, call, mintToken, post } = await import(
	"../../test/api-client"
);
const { db } = await import("#/db");
const { organizations } = await import("#/db/app-schema");
const { eq } = await import("drizzle-orm");
const { createOrganization } = await import("../organizations-store");
const { setOrganizationMembership } = await import("../organization-members");

const users = await createUsers("alice", "bob", "carol");
let alice: string;
let bob: string;
let carol: string;

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	bob = await mintToken(users.bob, ["repo:write"]);
	carol = await mintToken(users.carol, ["repo:write"]);
	const organization = await createOrganization({
		login: "acme",
		name: "Acme",
		description: "Widgets",
	});
	await setOrganizationMembership(organization.id, users.alice.id, "admin");
	await setOrganizationMembership(organization.id, users.bob.id, "member");
});

describe("GET /orgs/{org}", () => {
	it("serves GitHub's pinned key set", async () => {
		const org = await call("/orgs/acme", asToken(alice));
		expect(org.status).toBe(200);
		expect(Object.keys(org.body).sort()).toEqual(
			[
				"archived_at",
				"avatar_url",
				"blog",
				"company",
				"created_at",
				"description",
				"email",
				"events_url",
				"followers",
				"following",
				"has_organization_projects",
				"has_repository_projects",
				"hooks_url",
				"html_url",
				"id",
				"is_verified",
				"issues_url",
				"location",
				"login",
				"members_url",
				"name",
				"node_id",
				"public_gists",
				"public_members_url",
				"public_repos",
				"repos_url",
				"twitter_username",
				"type",
				"updated_at",
				"url",
			].sort(),
		);
		expect(org.body).toMatchObject({
			login: "acme",
			name: "Acme",
			description: "Widgets",
			type: "Organization",
			url: "http://localhost:3000/api/v3/orgs/acme",
			html_url: "http://localhost:3000/acme",
		});
		expect(org.body.node_id).toBe(
			Buffer.from(`012:Organization${org.body.id}`).toString("base64"),
		);
	});

	it("is 404 for an unknown organization and a name that is not a login", async () => {
		expect((await call("/orgs/nobody", asToken(alice))).status).toBe(404);
		expect((await call("/orgs/not%20a%20login", asToken(alice))).status).toBe(
			404,
		);
	});
});

describe("the organization lists", () => {
	it("lists the caller's organizations at GET /user/orgs", async () => {
		const response = await call("/user/orgs", asToken(bob));
		expect(response.body.map((org: { login: string }) => org.login)).toEqual([
			"acme",
		]);
	});

	it("lists another user's organizations at GET /users/{username}/orgs", async () => {
		const response = await call("/users/bob/orgs", asToken(alice));
		expect(response.body.map((org: { login: string }) => org.login)).toEqual([
			"acme",
		]);
		expect((await call("/users/nobody/orgs", asToken(alice))).status).toBe(404);
	});
});

describe("POST /orgs/{org}/repos", () => {
	it("creates an organization-owned repository for a member", async () => {
		const created = await call("/orgs/acme/repos", {
			...post(alice, { name: "smoke", private: true, auto_init: true }),
		});
		expect(created.status).toBe(201);
		expect(created.body).toMatchObject({
			name: "smoke",
			full_name: "acme/smoke",
			private: true,
			owner: { login: "acme", type: "Organization" },
		});
		expect(created.headers.get("Location")).toContain("/repos/acme/smoke");
	});

	it("is 404 for a non-member", async () => {
		const response = await call("/orgs/acme/repos", {
			...post(carol, { name: "outsider" }),
		});
		expect(response.status).toBe(404);
	});

	it("is 403 for a member when the organization forbids it", async () => {
		await db
			.update(organizations)
			.set({ membersCanCreateRepositories: false })
			.where(eq(organizations.login, "acme"));
		const response = await call("/orgs/acme/repos", {
			...post(bob, { name: "denied" }),
		});
		expect(response.status).toBe(403);
		await db
			.update(organizations)
			.set({ membersCanCreateRepositories: true })
			.where(eq(organizations.login, "acme"));
	});

	it("is 422 for a duplicate name", async () => {
		const response = await call("/orgs/acme/repos", {
			...post(alice, { name: "smoke" }),
		});
		expect(response.status).toBe(422);
		expect(response.body.errors[0].field).toBe("name");
	});

	it("is 422 for a team_id the caller is not on", async () => {
		const response = await call("/orgs/acme/repos", {
			...post(alice, { name: "with-team", team_id: 1 }),
		});
		expect(response.status).toBe(422);
		expect(response.body.errors[0].field).toBe("team_id");
	});
});

describe("GET /orgs/{org}/repos", () => {
	it("lists the organization's repositories to a member", async () => {
		const response = await call("/orgs/acme/repos", asToken(bob));
		expect(response.status).toBe(200);
		expect(
			response.body.map((repo: { full_name: string }) => repo.full_name),
		).toEqual(["acme/smoke"]);
	});

	it("lists only public repositories to a non-member", async () => {
		const response = await call("/orgs/acme/repos", asToken(carol));
		expect(response.body).toEqual([]);
		await call("/orgs/acme/repos", {
			...post(alice, { name: "public-one" }),
		});
		const visible = await call("/orgs/acme/repos", asToken(carol));
		expect(
			visible.body.map((repo: { full_name: string }) => repo.full_name),
		).toEqual(["acme/public-one"]);
	});

	it("sorts and filters like GitHub", async () => {
		const response = await call(
			"/orgs/acme/repos?type=private&sort=created&direction=asc",
			asToken(alice),
		);
		expect(response.body.map((repo: { name: string }) => repo.name)).toEqual([
			"smoke",
		]);
	});
});
