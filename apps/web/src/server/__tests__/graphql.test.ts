/**
 * @vitest-environment node
 *
 * GitHub's GraphQL API (`/api/graphql`): the real handler over pglite and
 * the in-memory git store, with real personal access tokens.
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

const { createUsers, signIn } = await import("../../test/app-harness");
const { asToken, call, mintToken } = await import("../../test/api-client");
const { graphql } = await import("../../test/graphql-client");
const repositories = await import("../repositories");
const files = await import("../files");

const users = await createUsers("alice", "bob", "carol");
let alice: string;
let bob: string;
let aliceRead: string;

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	aliceRead = await mintToken(users.alice, ["repo:read"]);
	bob = await mintToken(users.bob, ["repo:write"]);
	signIn(users.alice);
	const created = await repositories.createRepository({
		data: { name: "public-one", visibility: "public", description: "First" },
	});
	await repositories.createRepository({
		data: { name: "secret", visibility: "private" },
	});
	await files.uploadFile({
		data: {
			repoId: created.id,
			branchName: "main",
			path: "README.md",
			content: btoa("# hi\n"),
			commitMessage: "init",
		},
	});
});

describe("authentication", () => {
	it("requires a token, as GitHub does", async () => {
		const { status, body } = await graphql(null, "{ viewer { login } }");
		expect(status).toBe(401);
		expect(body.message).toBe(
			"This endpoint requires you to be authenticated.",
		);
	});

	it("401s bad credentials", async () => {
		const { status, body } = await graphql("pst_nope", "{ viewer { login } }");
		expect(status).toBe(401);
		expect(body.message).toBe("Bad credentials");
	});

	it("answers gh's UserCurrent", async () => {
		const { status, body, headers } = await graphql(
			alice,
			"query UserCurrent{viewer{login}}",
		);
		expect(status).toBe(200);
		expect(body).toEqual({ data: { viewer: { login: "alice" } } });
		expect(headers.get("x-ratelimit-resource")).toBe("graphql");
	});
});

describe("X-OAuth-Scopes", () => {
	it("maps repo:write to GitHub's classic scopes, on REST and GraphQL", async () => {
		const rest = await call("/", asToken(alice));
		expect(rest.status).toBe(200);
		expect(rest.headers.get("x-oauth-scopes")).toBe("read:org, repo");
		const gql = await graphql(alice, "{ viewer { login } }");
		expect(gql.headers.get("x-oauth-scopes")).toBe("read:org, repo");
	});

	it("sends none for a read-only token, like a fine-grained token", async () => {
		const rest = await call("/user", asToken(aliceRead));
		expect(rest.status).toBe(200);
		expect(rest.headers.has("x-oauth-scopes")).toBe(false);
	});
});

describe("repository", () => {
	it("resolves a readable repository", async () => {
		const { body } = await graphql(
			bob,
			`query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) {
				id databaseId name nameWithOwner description isPrivate visibility viewerPermission
				isEmpty defaultBranchRef { name prefix } owner { login ... on User { id } }
				stargazerCount viewerHasStarred url sshUrl
			} }`,
			{ owner: "alice", name: "public-one" },
		);
		expect(body.errors).toBeUndefined();
		expect(body.data.repository).toMatchObject({
			name: "public-one",
			nameWithOwner: "alice/public-one",
			description: "First",
			isPrivate: false,
			visibility: "PUBLIC",
			viewerPermission: "READ",
			isEmpty: false,
			defaultBranchRef: { name: "main", prefix: "refs/heads/" },
			owner: { login: "alice" },
			stargazerCount: 0,
			viewerHasStarred: false,
		});
	});

	it("answers an unreadable repository like a missing one: null plus NOT_FOUND", async () => {
		const { status, body } = await graphql(
			bob,
			'{ repository(owner: "alice", name: "secret") { name } }',
		);
		expect(status).toBe(200);
		expect(body).toEqual({
			data: { repository: null },
			errors: [
				{
					type: "NOT_FOUND",
					path: ["repository"],
					locations: [{ line: 1, column: 3 }],
					message:
						"Could not resolve to a Repository with the name 'alice/secret'.",
				},
			],
		});
	});

	it("an empty repository has no default branch ref", async () => {
		const { body } = await graphql(
			alice,
			'{ repository(owner: "alice", name: "secret") { isEmpty defaultBranchRef { name } viewerPermission viewerCanAdminister } }',
		);
		expect(body.data.repository).toEqual({
			isEmpty: true,
			defaultBranchRef: null,
			viewerPermission: "ADMIN",
			viewerCanAdminister: true,
		});
	});
});

describe("node ids", () => {
	it("round-trips repository and user ids through node(id:)", async () => {
		const { body } = await graphql(
			alice,
			'{ repository(owner: "alice", name: "public-one") { id owner { id } defaultBranchRef { id } } }',
		);
		const { id, owner, defaultBranchRef } = body.data.repository;
		const nodes = await graphql(
			alice,
			`query($ids: [ID!]!) { nodes(ids: $ids) { __typename id ... on Repository { name } ... on User { login } ... on Ref { name } } }`,
			{ ids: [id, owner.id, defaultBranchRef.id] },
		);
		expect(nodes.body.data.nodes).toEqual([
			{ __typename: "Repository", id, name: "public-one" },
			{ __typename: "User", id: owner.id, login: "alice" },
			{ __typename: "Ref", id: defaultBranchRef.id, name: "main" },
		]);
	});

	it("resolves an out-of-range id to null without failing its batch", async () => {
		const { body } = await graphql(
			alice,
			'{ repository(owner: "alice", name: "public-one") { id owner { id } } }',
		);
		const { id, owner } = body.data.repository;
		const huge = (type: string) =>
			Buffer.from(
				`${String(type.length).padStart(2, "0")}:${type}9999999999`,
			).toString("base64");
		const nodes = await graphql(
			alice,
			`query($ids: [ID!]!) { nodes(ids: $ids) { __typename id } }`,
			{ ids: [id, huge("Repository"), owner.id, huge("User")] },
		);
		expect(nodes.body.data.nodes).toEqual([
			{ __typename: "Repository", id },
			null,
			{ __typename: "User", id: owner.id },
			null,
		]);
	});

	it("uses the REST API's node_id for users", async () => {
		const { body } = await graphql(alice, "{ viewer { id databaseId } }");
		expect(Buffer.from(body.data.viewer.id, "base64").toString()).toBe(
			`04:User${body.data.viewer.databaseId}`,
		);
	});

	it("does not resolve another user's private repository by id", async () => {
		const { body: own } = await graphql(
			alice,
			'{ repository(owner: "alice", name: "secret") { id } }',
		);
		const { body } = await graphql(
			bob,
			`query($id: ID!) { node(id: $id) { id } }`,
			{ id: own.data.repository.id },
		);
		expect(body.data.node).toBeNull();
		expect(body.errors[0].type).toBe("NOT_FOUND");
	});
});

describe("connections", () => {
	it("pages viewer repositories with opaque cursors", async () => {
		const first = await graphql(
			alice,
			"{ viewer { repositories(first: 1, orderBy: {field: NAME, direction: ASC}) { totalCount nodes { name } pageInfo { hasNextPage endCursor } } } }",
		);
		const page = first.body.data.viewer.repositories;
		expect(page.totalCount).toBe(2);
		expect(page.nodes).toEqual([{ name: "public-one" }]);
		expect(page.pageInfo.hasNextPage).toBe(true);
		const next = await graphql(
			alice,
			`query($after: String) { viewer { repositories(first: 1, after: $after, orderBy: {field: NAME, direction: ASC}) { nodes { name } edges { cursor } pageInfo { hasNextPage } } } }`,
			{ after: page.pageInfo.endCursor },
		);
		expect(next.body.data.viewer.repositories.nodes).toEqual([
			{ name: "secret" },
		]);
		expect(next.body.data.viewer.repositories.pageInfo.hasNextPage).toBe(false);
	});

	it("lists only what the viewer may read", async () => {
		const { body } = await graphql(
			bob,
			'{ user(login: "alice") { repositories(first: 10) { totalCount nodes { name } } } }',
		);
		expect(body.data.user.repositories).toEqual({
			totalCount: 1,
			nodes: [{ name: "public-one" }],
		});
	});

	it("requires first or last, at most 100", async () => {
		const missing = await graphql(
			alice,
			"{ viewer { repositories { totalCount } } }",
		);
		expect(missing.body).toEqual({
			errors: [
				{
					type: "MISSING_PAGINATION_BOUNDARIES",
					message:
						"You must provide a `first` or `last` value to properly paginate the `repositories` connection.",
				},
			],
		});
		const excessive = await graphql(
			alice,
			"{ viewer { repositories(first: 101) { totalCount } } }",
		);
		expect(excessive.body.errors[0].type).toBe("EXCESSIVE_PAGINATION");
	});

	it("bounds nested fan-out by node count", async () => {
		const { body } = await graphql(
			alice,
			`{ a: user(login: "alice") { repositories(first: 100) { nodes { owner { ... on User { repositories(first: 100) { nodes { owner { ... on User { repositories(first: 100) { totalCount } } } } } } } } } } }`,
		);
		expect(body.errors[0].type).toBe("MAX_NODE_LIMIT_EXCEEDED");
		expect(body.data).toBeUndefined();
	});

	it("reports the query's cost in rateLimit", async () => {
		const { body } = await graphql(
			alice,
			"{ viewer { repositories(first: 50) { totalCount } } rateLimit { cost nodeCount limit remaining used resetAt } }",
		);
		expect(body.data.rateLimit).toMatchObject({ cost: 1, nodeCount: 50 });
		expect(body.data.rateLimit.limit).toBeGreaterThan(0);
	});
});

describe("width limits", () => {
	const repoId = async () =>
		(
			await graphql(
				alice,
				'{ repository(owner: "alice", name: "public-one") { id } }',
			)
		).body.data.repository.id as string;

	it("caps nodes(ids:) at 100, as GitHub does", async () => {
		const id = await repoId();
		for (const count of [101, 3000]) {
			const { body } = await graphql(
				alice,
				"query($ids: [ID!]!) { nodes(ids: $ids) { id } }",
				{
					ids: Array.from({ length: count }, () => id),
				},
			);
			expect(body.data).toBeUndefined();
			expect(body.errors[0]).toMatchObject({
				type: "EXCESSIVE_PAGINATION",
				message: `Requesting ${count} records on the \`nodes\` field exceeds the \`ids\` limit of 100 records.`,
			});
		}
	});

	it("resolves 100 ids in one batch, counting them as nodes", async () => {
		const id = await repoId();
		const { body } = await graphql(
			alice,
			"query($ids: [ID!]!) { nodes(ids: $ids) { id } rateLimit { nodeCount } }",
			{ ids: Array.from({ length: 100 }, () => id) },
		);
		expect(body.errors).toBeUndefined();
		expect(body.data.nodes).toHaveLength(100);
		expect(body.data.rateLimit.nodeCount).toBe(100);
	});

	it("rejects 1000 aliased repository lookups before running them", async () => {
		const aliases = Array.from(
			{ length: 1000 },
			(_, i) =>
				`r${i}: repository(owner: "alice", name: "public-one") { isEmpty }`,
		).join(" ");
		const { body } = await graphql(alice, `{ ${aliases} }`);
		expect(body.data).toBeUndefined();
		expect(body.errors[0].type).toBe("MAX_NODE_LIMIT_EXCEEDED");
	});

	it("counts lookups toward the node count", async () => {
		const { body } = await graphql(
			alice,
			'{ a: repository(owner: "alice", name: "public-one") { id } b: user(login: "bob") { login } rateLimit { nodeCount } }',
		);
		expect(body.data.rateLimit.nodeCount).toBe(2);
	});

	it("rejects 900 aliased introspection copies", async () => {
		const aliases = Array.from(
			{ length: 900 },
			(_, i) => `s${i}: __schema { types { fields { type { name } } } }`,
		).join(" ");
		const { body } = await graphql(alice, `{ ${aliases} }`);
		expect(body.data).toBeUndefined();
		expect(body.errors[0].type).toBe("MAX_NODE_LIMIT_EXCEEDED");
	});

	it("charges a mutation 5 points", async () => {
		const before = await graphql(alice, "{ rateLimit { used } }");
		await graphql(
			alice,
			'mutation { createRepository(input: {name: "costly", visibility: PUBLIC}) { repository { name } } }',
		);
		const after = await graphql(alice, "{ rateLimit { used } }");
		// The second rateLimit query itself costs 1.
		expect(
			after.body.data.rateLimit.used - before.body.data.rateLimit.used,
		).toBe(6);
	});
});

describe("errors", () => {
	it("reports validation errors without data", async () => {
		const { status, body } = await graphql(alice, "{ viewer { nope } }");
		expect(status).toBe(200);
		expect(body.data).toBeUndefined();
		expect(body.errors[0].message).toMatch(/nope/);
	});

	it("reports parse errors", async () => {
		const { body } = await graphql(alice, "{ viewer {");
		expect(body.errors[0].message).toMatch(/Syntax Error/);
	});
});

describe("createRepository", () => {
	it("creates a repository for the viewer", async () => {
		const { body } = await graphql(
			alice,
			`mutation($input: CreateRepositoryInput!) { createRepository(input: $input) { repository { nameWithOwner isPrivate viewerPermission } } }`,
			{
				input: { name: "made-by-gql", visibility: "PRIVATE", description: "x" },
			},
		);
		expect(body.errors).toBeUndefined();
		expect(body.data.createRepository.repository).toEqual({
			nameWithOwner: "alice/made-by-gql",
			isPrivate: true,
			viewerPermission: "ADMIN",
		});
	});

	it("needs a repo:write token", async () => {
		const { body } = await graphql(
			aliceRead,
			`mutation { createRepository(input: {name: "nope", visibility: PUBLIC}) { repository { name } } }`,
		);
		expect(body.errors[0].type).toBe("INSUFFICIENT_SCOPES");
		// A read-only token has no classic scopes to list.
		expect(body.errors[0].message).toMatch(/granted the: \[\] scopes\.$/);
	});

	it("refuses an existing name", async () => {
		const { body } = await graphql(
			alice,
			`mutation { createRepository(input: {name: "public-one", visibility: PUBLIC}) { repository { name } } }`,
		);
		expect(body.errors[0]).toMatchObject({
			type: "UNPROCESSABLE",
			message: "Name already exists on this account",
		});
	});
});
