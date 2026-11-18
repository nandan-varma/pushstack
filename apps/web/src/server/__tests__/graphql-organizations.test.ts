/**
 * @vitest-environment node
 *
 * GraphQL organizations: `Query.organization`, `Query.repositoryOwner`
 * resolving an Organization through `__typename`, `Organization.repositories`,
 * `Repository.owner` for an organization-owned repository, and the legacy
 * `012:Organization` node id that `node(id:)` resolves.
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
const { graphql } = await import("../../test/graphql-client");
const { createOrganization } = await import("../organizations-store");
const { setOrganizationMembership } = await import("../organization-members");

const users = await createUsers("alice", "bob", "carol", "dave");
let alice: string;
let bob: string;
let carol: string;
let dave: string;
let acmeId: number;

const FIELDS = `login databaseId description websiteUrl email location isVerified url resourcePath`;

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	bob = await mintToken(users.bob, ["repo:write"]);
	carol = await mintToken(users.carol, ["repo:write"]);
	dave = await mintToken(users.dave, ["repo:write"]);
	const organization = await createOrganization({
		login: "acme",
		name: "Acme",
		description: "Widgets",
		blog: "https://acme.example",
		email: "hello@acme.test",
	});
	acmeId = organization.id;
	await setOrganizationMembership(organization.id, users.alice.id, "admin");
	await setOrganizationMembership(organization.id, users.bob.id, "member");
	await setOrganizationMembership(organization.id, users.carol.id, "member");
	await call(
		"/orgs/acme/repos",
		post(alice, { name: "smoke", auto_init: true }),
	);
	await call(
		"/orgs/acme/repos",
		post(alice, { name: "secret", private: true }),
	);
});

describe("Query.organization", () => {
	it("serves the organization's profile", async () => {
		const { body } = await graphql(
			alice,
			`query { organization(login: "acme") { ${FIELDS} } }`,
		);
		expect(body.errors).toBeUndefined();
		expect(body.data.organization).toMatchObject({
			login: "acme",
			databaseId: acmeId,
			description: "Widgets",
			websiteUrl: "https://acme.example",
			email: "hello@acme.test",
			isVerified: false,
			url: "http://localhost:3000/acme",
			resourcePath: "/acme",
		});
	});

	it("is NOT_FOUND for an unknown organization", async () => {
		const { body } = await graphql(
			alice,
			`query { organization(login: "nobody") { login } }`,
		);
		expect(body.data.organization).toBeNull();
		expect(body.errors[0].type).toBe("NOT_FOUND");
	});
});

describe("the RepositoryOwner interface", () => {
	it("resolves repositoryOwner to an Organization", async () => {
		const { body } = await graphql(
			alice,
			`query { repositoryOwner(login: "acme") { __typename login ... on Organization { databaseId } } }`,
		);
		expect(body.data.repositoryOwner).toEqual({
			__typename: "Organization",
			login: "acme",
			databaseId: acmeId,
		});
	});
});

describe("Organization.repositories", () => {
	it("lists what the viewer can read", async () => {
		const member = await graphql(
			bob,
			`query { organization(login: "acme") { repositories(first: 10, orderBy: {field: NAME, direction: ASC}) { totalCount nodes { nameWithOwner owner { __typename login } } } } }`,
		);
		expect(
			member.body.data.organization.repositories.nodes.map(
				(node: { nameWithOwner: string }) => node.nameWithOwner,
			),
		).toEqual(["acme/secret", "acme/smoke"]);
		expect(member.body.data.organization.repositories.nodes[0].owner).toEqual({
			__typename: "Organization",
			login: "acme",
		});

		const outsider = await graphql(
			dave,
			`query { organization(login: "acme") { repositories(first: 10) { totalCount nodes { nameWithOwner } } } }`,
		);
		expect(
			outsider.body.data.organization.repositories.nodes.map(
				(node: { nameWithOwner: string }) => node.nameWithOwner,
			),
		).toEqual(["acme/smoke"]);
	});

	it("serves an organization-owned repository's owner as an Organization", async () => {
		const { body } = await graphql(
			bob,
			`query { repository(owner: "acme", name: "smoke") { nameWithOwner isInOrganization owner { __typename login } } }`,
		);
		expect(body.errors).toBeUndefined();
		expect(body.data.repository).toEqual({
			nameWithOwner: "acme/smoke",
			isInOrganization: true,
			owner: { __typename: "Organization", login: "acme" },
		});
	});
});

describe("GraphQL teams", () => {
	const put = (token: string, body: unknown) => ({
		...asToken(token),
		method: "PUT",
		body: JSON.stringify(body),
	});

	it("serves Organization.teams with members and children", async () => {
		await call("/orgs/acme/teams", post(alice, { name: "Core Team" }));
		await call(
			"/orgs/acme/teams/core-team/memberships/bob",
			put(alice, { role: "maintainer" }),
		);
		await call(
			"/orgs/acme/teams",
			post(alice, { name: "Child", parent_team_slug: "core-team" }),
		);
		const { body } = await graphql(
			bob,
			`query { organization(login: "acme") { teams(first: 10) { totalCount nodes { name slug privacy url parentTeam { slug } members(first: 10) { totalCount nodes { login } } childTeams(first: 10) { totalCount nodes { slug } } } } } }`,
		);
		expect(body.errors).toBeUndefined();
		const teams = body.data.organization.teams;
		expect(teams.totalCount).toBe(2);
		const core = teams.nodes.find(
			(team: { slug: string }) => team.slug === "core-team",
		);
		expect(core).toMatchObject({
			name: "Core Team",
			privacy: "VISIBLE",
			url: "http://localhost:3000/orgs/acme/teams/core-team",
			parentTeam: null,
			members: { totalCount: 1, nodes: [{ login: "bob" }] },
			childTeams: { totalCount: 1, nodes: [{ slug: "child" }] },
		});
		const child = teams.nodes.find(
			(team: { slug: string }) => team.slug === "child",
		);
		expect(child.parentTeam).toEqual({ slug: "core-team" });
	});

	it("hides a secret team from a member who is not on it", async () => {
		await call(
			"/orgs/acme/teams",
			post(alice, { name: "Secret", privacy: "secret" }),
		);
		const outsider = await graphql(
			dave,
			`query { organization(login: "acme") { teams(first: 10) { nodes { slug } } } }`,
		);
		expect(
			outsider.body.data.organization.teams.nodes.map(
				(team: { slug: string }) => team.slug,
			),
		).not.toContain("secret");
		await call(
			"/orgs/acme/teams/secret/memberships/carol",
			put(alice, { role: "member" }),
		);
		const insider = await graphql(
			carol,
			`query { organization(login: "acme") { teams(first: 10) { nodes { slug } } } }`,
		);
		expect(
			insider.body.data.organization.teams.nodes.map(
				(team: { slug: string }) => team.slug,
			),
		).toContain("secret");
	});
});

describe("node(id:)", () => {
	it("resolves a Team's legacy node id", async () => {
		const created = await call(
			"/orgs/acme/teams",
			post(alice, { name: "Node Team" }),
		);
		const id = Buffer.from(`04:Team${created.body.id}`).toString("base64");
		const { body } = await graphql(
			alice,
			`query($id: ID!) { node(id: $id) { __typename ... on Team { slug } } }`,
			{ id },
		);
		expect(body.data.node).toEqual({ __typename: "Team", slug: "node-team" });
	});

	it("resolves the Organization's legacy node id", async () => {
		const id = Buffer.from(`012:Organization${acmeId}`).toString("base64");
		const { body } = await graphql(
			alice,
			`query($id: ID!) { node(id: $id) { __typename ... on Organization { login } } }`,
			{ id },
		);
		expect(body.data.node).toEqual({
			__typename: "Organization",
			login: "acme",
		});
	});
});
