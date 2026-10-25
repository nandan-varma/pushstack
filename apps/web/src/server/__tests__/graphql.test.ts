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
const { encodeNodeId } = await import("../graphql/node-id");

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

describe("Commit.blame", () => {
	const blameQuery = (path: string) => `{
		repository(owner: "alice", name: "public-one") {
			ref(qualifiedName: "refs/heads/main") {
				target { ... on Commit { oid blame(path: "${path}") { ranges { startingLine endingLine age commit { oid messageHeadline } } } } }
			}
		}
	}`;

	it("returns line ranges grouped by commit, through ref and object", async () => {
		const { body } = await graphql(alice, blameQuery("README.md"));
		expect(body.errors).toBeUndefined();
		const { oid, blame } = body.data.repository.ref.target;
		expect(blame.ranges).toHaveLength(1);
		expect(blame.ranges[0]).toMatchObject({
			startingLine: 1,
			endingLine: 1,
			age: 1,
			commit: { oid, messageHeadline: "init" },
		});

		const { body: byObject } = await graphql(
			alice,
			`{ repository(owner: "alice", name: "public-one") {
				object(expression: "HEAD") { ... on Commit { oid blame(path: "README.md") { ranges { startingLine } } } }
			} }`,
		);
		expect(byObject.data.repository.object.blame.ranges).toEqual([
			{ startingLine: 1 },
		]);
	});

	it("reports a missing path as NOT_FOUND and an invalid one as UNPROCESSABLE", async () => {
		const { body: missing } = await graphql(alice, blameQuery("nope.txt"));
		expect(missing.errors[0].type).toBe("NOT_FOUND");
		const { body: invalid } = await graphql(alice, blameQuery("../x"));
		expect(invalid.errors[0].type).toBe("UNPROCESSABLE");
	});

	it("maps a file too large to blame to UNPROCESSABLE, not a timeout", async () => {
		const repo = await repositories.getRepositoryByName({
			data: { owner: "alice", name: "public-one" },
		});
		await files.uploadFile({
			data: {
				repoId: repo.id,
				branchName: "main",
				path: "wide.txt",
				content: btoa("a".repeat(1024 * 1024 + 1)),
				commitMessage: "wide",
			},
		});
		const { body } = await graphql(
			alice,
			`{ repository(owner: "alice", name: "public-one") { object(expression: "main") { ... on Commit { blame(path: "wide.txt") { ranges { startingLine } } } } } }`,
		);
		expect(body.errors[0].type).toBe("UNPROCESSABLE");
		expect(body.errors[0].message).toContain("blame limit");
	});

	it("answers a path-traversing or malformed expression with null, not a lookup", async () => {
		for (const expression of ["refs/../../secret/x", "../x", "a..b", ""]) {
			const { body } = await graphql(
				alice,
				`query($e: String) { repository(owner: "alice", name: "public-one") { object(expression: $e) { oid } } }`,
				{ e: expression },
			);
			expect(body.errors).toBeUndefined();
			expect(body.data.repository.object).toBeNull();
		}
	});

	it("weighs blame heavily and allows one per query", async () => {
		const one = `object(expression: "HEAD") { ... on Commit { blame(path: "README.md") { ranges { startingLine } } } }`;
		const { body } = await graphql(
			alice,
			`{ repository(owner: "alice", name: "public-one") { ${one} } }`,
		);
		expect(body.errors).toBeUndefined();
		const { body: two } = await graphql(
			alice,
			`{ repository(owner: "alice", name: "public-one") { a: ${one} b: ${one} } }`,
		);
		expect(two.errors[0].type).toBe("MAX_NODE_LIMIT_EXCEEDED");
		expect(two.errors[0].message).toContain("blame");
	});

	it("does not expose commits of an unreadable repository", async () => {
		const { body } = await graphql(
			bob,
			`{ repository(owner: "alice", name: "secret") { object(expression: "HEAD") { oid } } }`,
		);
		expect(body.data.repository).toBeNull();
		expect(body.errors[0].type).toBe("NOT_FOUND");
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
		const huge = (type: "Repository" | "User") =>
			encodeNodeId(type, 9999999999);
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

	it("reports no next page when paging backward with before, as GitHub does", async () => {
		const first = await graphql(
			alice,
			"{ viewer { repositories(first: 2, orderBy: {field: NAME, direction: ASC}) { pageInfo { endCursor } } } }",
		);
		const before = first.body.data.viewer.repositories.pageInfo.endCursor;
		const { body } = await graphql(
			alice,
			`query($before: String) { viewer { repositories(last: 1, before: $before, orderBy: {field: NAME, direction: ASC}) { nodes { name } pageInfo { hasNextPage hasPreviousPage } } } }`,
			{ before },
		);
		expect(body.errors).toBeUndefined();
		expect(body.data.viewer.repositories.nodes).toHaveLength(1);
		expect(body.data.viewer.repositories.pageInfo).toEqual({
			hasNextPage: false,
			hasPreviousPage: false,
		});
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

	it("drops null list items: ownerAffiliations falls back to its default, affiliations matches nothing", async () => {
		const query = `query($owner: [RepositoryAffiliation], $mine: [RepositoryAffiliation]) { user(login: "alice") { repositories(first: 10, ownerAffiliations: $owner, affiliations: $mine) { totalCount } } }`;
		const defaulted = await graphql(bob, query, { owner: [null] });
		expect(defaulted.body.errors).toBeUndefined();
		expect(defaulted.body.data.user.repositories.totalCount).toBe(1);
		const none = await graphql(bob, query, { mine: [null] });
		expect(none.body.errors).toBeUndefined();
		expect(none.body.data.user.repositories.totalCount).toBe(0);
	});

	it("allows count-only connections through fragments without page boundaries", async () => {
		const result = await graphql(
			alice,
			`query { viewer { repositories { ...Count } } } fragment Count on RepositoryConnection { totalCount }`,
		);
		expect(result.body.errors).toBeUndefined();
		expect(result.body.data.viewer.repositories.totalCount).toBe(2);
	});

	it("requires first or last, at most 100", async () => {
		const missing = await graphql(
			alice,
			"{ viewer { repositories { nodes { name } } } }",
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

	it("charges each aliased mutation, in the graphql and core-write buckets", async () => {
		const rate = async () =>
			(await call("/rate_limit", asToken(alice))).body.resources;
		const before = await graphql(alice, "{ rateLimit { used } }");
		const writesBefore = (await rate()).core_write.used;
		await graphql(
			alice,
			'mutation { a: createRepository(input: {name: "costly-a", visibility: PUBLIC}) { repository { name } } b: createRepository(input: {name: "costly-b", visibility: PUBLIC}) { repository { name } } }',
		);
		const after = await graphql(alice, "{ rateLimit { used } }");
		expect(
			after.body.data.rateLimit.used - before.body.data.rateLimit.used,
		).toBe(11);
		// /rate_limit itself is a core read, not a write.
		expect((await rate()).core_write.used - writesBefore).toBe(2);
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

	it("bounds and trims the description like every other create path", async () => {
		const tooLong = await graphql(
			alice,
			`mutation($input: CreateRepositoryInput!) { createRepository(input: $input) { repository { name } } }`,
			{
				input: {
					name: "long-desc",
					visibility: "PUBLIC",
					description: "x".repeat(501),
				},
			},
		);
		expect(tooLong.body.errors[0].type).toBe("UNPROCESSABLE");
		expect(tooLong.body.errors[0].message).toMatch(/^Description /);
		const trimmed = await graphql(
			alice,
			`mutation($input: CreateRepositoryInput!) { createRepository(input: $input) { repository { description } } }`,
			{
				input: {
					name: "trimmed-desc",
					visibility: "PUBLIC",
					description: "  spaced  ",
				},
			},
		);
		expect(trimmed.body.data.createRepository.repository.description).toBe(
			"spaced",
		);
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

describe("updateRepository", () => {
	const update = `mutation($input: UpdateRepositoryInput!) { updateRepository(input: $input) { clientMutationId repository { name description homepageUrl hasIssuesEnabled viewerPermission } } }`;
	const idOf = async (token: string, name: string) => {
		const { body } = await graphql(
			token,
			`{ repository(owner: "alice", name: "${name}") { id } }`,
		);
		return body.data.repository.id as string;
	};

	it("edits description and settings, and echoes clientMutationId", async () => {
		const repositoryId = await idOf(alice, "public-one");
		const { body } = await graphql(alice, update, {
			input: {
				clientMutationId: "m1",
				repositoryId,
				description: "  Edited  ",
				homepageUrl: "https://example.com",
				hasIssuesEnabled: false,
			},
		});
		expect(body.errors).toBeUndefined();
		expect(body.data.updateRepository).toEqual({
			clientMutationId: "m1",
			repository: {
				name: "public-one",
				description: "Edited",
				homepageUrl: "https://example.com",
				hasIssuesEnabled: false,
				viewerPermission: "ADMIN",
			},
		});
	});

	it("renames through the same validation as create", async () => {
		const repositoryId = await idOf(alice, "public-one");
		const renamed = await graphql(alice, update, {
			input: { repositoryId, name: "public-two" },
		});
		expect(renamed.body.data.updateRepository.repository.name).toBe(
			"public-two",
		);
		const invalid = await graphql(alice, update, {
			input: { repositoryId, name: "has space" },
		});
		expect(invalid.body.errors[0].type).toBe("UNPROCESSABLE");
		expect(invalid.body.errors[0].message).toMatch(/^Name /);
		await graphql(alice, update, {
			input: { repositoryId, name: "public-one" },
		});
	});

	it("refuses a name another repository of the owner already has", async () => {
		const repositoryId = await idOf(alice, "public-one");
		const { body } = await graphql(alice, update, {
			input: { repositoryId, name: "secret" },
		});
		expect(body.errors[0]).toMatchObject({
			type: "UNPROCESSABLE",
			message: "Name already exists on this account",
		});
	});

	it("bounds the description and homepage", async () => {
		const repositoryId = await idOf(alice, "public-one");
		const long = await graphql(alice, update, {
			input: { repositoryId, description: "x".repeat(501) },
		});
		expect(long.body.errors[0].type).toBe("UNPROCESSABLE");
		const homepage = await graphql(alice, update, {
			input: { repositoryId, homepageUrl: "h".repeat(256) },
		});
		expect(homepage.body.errors[0].type).toBe("UNPROCESSABLE");
	});

	it("needs a repo:write token", async () => {
		const repositoryId = await idOf(alice, "public-one");
		const { body } = await graphql(aliceRead, update, {
			input: { repositoryId, description: "nope" },
		});
		expect(body.errors[0].type).toBe("INSUFFICIENT_SCOPES");
		expect(body.errors[0].message).toMatch(/'updateRepository' field/);
	});

	it("forbids writers who are not admins, and hides repositories they cannot read", async () => {
		const publicId = await idOf(alice, "public-one");
		const notAdmin = await graphql(bob, update, {
			input: { repositoryId: publicId, description: "mine" },
		});
		expect(notAdmin.body.errors[0]).toMatchObject({
			type: "FORBIDDEN",
			message: "Must have admin rights to Repository.",
		});
		const secretId = await idOf(alice, "secret");
		const hidden = await graphql(bob, update, {
			input: { repositoryId: secretId, description: "mine" },
		});
		expect(hidden.body.errors[0].type).toBe("NOT_FOUND");
	});

	it("answers NOT_FOUND for an id that is not a repository", async () => {
		const { body } = await graphql(alice, update, {
			input: {
				repositoryId: encodeNodeId("User", 999_999),
				description: "x",
			},
		});
		expect(body.errors[0].type).toBe("NOT_FOUND");
	});
});

describe("labels", () => {
	const repoId = async (token: string) => {
		const { body } = await graphql(
			token,
			`{ repository(owner: "alice", name: "public-one") { id } }`,
		);
		return body.data.repository.id as string;
	};
	const create = `mutation($input: CreateLabelInput!) { createLabel(input: $input) { clientMutationId label { id name color description } } }`;
	const update = `mutation($input: UpdateLabelInput!) { updateLabel(input: $input) { clientMutationId label { id name color description } } }`;
	const remove = `mutation($input: DeleteLabelInput!) { deleteLabel(input: $input) { clientMutationId } }`;

	it("creates, edits and deletes labels, round-tripping through Repository.labels", async () => {
		const repositoryId = await repoId(alice);
		const created = await graphql(alice, create, {
			input: {
				clientMutationId: "c1",
				repositoryId,
				name: "gql-label",
				color: "#ABCDEF",
				description: "from graphql",
			},
		});
		expect(created.body.errors).toBeUndefined();
		const label = created.body.data.createLabel;
		expect(label.clientMutationId).toBe("c1");
		expect(label.label).toMatchObject({
			name: "gql-label",
			color: "abcdef",
			description: "from graphql",
		});

		const edited = await graphql(alice, update, {
			input: { id: label.label.id, name: "gql-renamed", description: "" },
		});
		expect(edited.body.errors).toBeUndefined();
		expect(edited.body.data.updateLabel.label).toMatchObject({
			name: "gql-renamed",
			description: null,
		});

		const listed = await graphql(
			alice,
			`{ repository(owner: "alice", name: "public-one") { labels(first: 100, query: "gql-") { totalCount nodes { id name } } } }`,
		);
		expect(listed.body.data.repository.labels.nodes).toEqual([
			{ id: label.label.id, name: "gql-renamed" },
		]);
		expect(listed.body.data.repository.labels.totalCount).toBe(1);

		const deleted = await graphql(alice, remove, {
			input: { clientMutationId: "d1", id: label.label.id },
		});
		expect(deleted.body.data.deleteLabel).toEqual({ clientMutationId: "d1" });
		const again = await graphql(alice, remove, {
			input: { id: label.label.id },
		});
		expect(again.body.errors[0].type).toBe("NOT_FOUND");
	});

	it("pages labels with first, after and totalCount", async () => {
		const { body } = await graphql(
			alice,
			`{ repository(owner: "alice", name: "public-one") { labels(first: 2, orderBy: {field: NAME, direction: ASC}) { totalCount pageInfo { hasNextPage endCursor } nodes { name } } } }`,
		);
		const page = body.data.repository.labels;
		expect(page.nodes).toHaveLength(2);
		expect(page.totalCount).toBeGreaterThan(2);
		expect(page.pageInfo.hasNextPage).toBe(true);
		const next = await graphql(
			alice,
			`{ repository(owner: "alice", name: "public-one") { labels(first: 2, after: "${page.pageInfo.endCursor}", orderBy: {field: NAME, direction: ASC}) { nodes { name } } } }`,
		);
		const after = next.body.data.repository.labels.nodes.map(
			(node: { name: string }) => node.name,
		);
		expect(after.length).toBeGreaterThan(0);
		expect(after).not.toContain(page.nodes[0].name);
		expect(after).not.toContain(page.nodes[1].name);
	});

	it("refuses ordering by issue count and over-long searches", async () => {
		const byCount = await graphql(
			alice,
			`{ repository(owner: "alice", name: "public-one") { labels(first: 1, orderBy: {field: ISSUE_COUNT, direction: DESC}) { totalCount } } }`,
		);
		expect(byCount.body.errors[0].type).toBe("UNPROCESSABLE");
		const long = await graphql(
			alice,
			`{ repository(owner: "alice", name: "public-one") { labels(first: 1, query: "${"q".repeat(101)}") { totalCount } } }`,
		);
		expect(long.body.errors[0].type).toBe("UNPROCESSABLE");
	});

	it("rejects duplicate names, bad colors and over-long names", async () => {
		const repositoryId = await repoId(alice);
		const duplicate = await graphql(alice, create, {
			input: { repositoryId, name: "BUG", color: "ff0000" },
		});
		expect(duplicate.body.errors[0]).toMatchObject({
			type: "UNPROCESSABLE",
			message: "Label already exists",
		});
		const color = await graphql(alice, create, {
			input: { repositoryId, name: "bad-color", color: "red" },
		});
		expect(color.body.errors[0].type).toBe("UNPROCESSABLE");
		const name = await graphql(alice, create, {
			input: { repositoryId, name: "n".repeat(51), color: "ff0000" },
		});
		expect(name.body.errors[0].type).toBe("UNPROCESSABLE");
	});

	it("needs a repo:write token and push access", async () => {
		const repositoryId = await repoId(alice);
		const scoped = await graphql(aliceRead, create, {
			input: { repositoryId, name: "nope", color: "ff0000" },
		});
		expect(scoped.body.errors[0].type).toBe("INSUFFICIENT_SCOPES");
		expect(scoped.body.errors[0].message).toMatch(/'createLabel' field/);
		const notWriter = await graphql(bob, create, {
			input: { repositoryId, name: "nope", color: "ff0000" },
		});
		expect(notWriter.body.errors[0]).toMatchObject({
			type: "FORBIDDEN",
			message: "Must have push access to Repository.",
		});
	});

	it("answers NOT_FOUND for an unknown label id", async () => {
		const { body } = await graphql(alice, update, {
			input: { id: encodeNodeId("Label", 999_999), name: "x" },
		});
		expect(body.errors[0].type).toBe("NOT_FOUND");
	});
});

describe("label guards", () => {
	const idOf = async (token: string, name: string) => {
		const { body } = await graphql(
			token,
			`{ repository(owner: "alice", name: "${name}") { id } }`,
		);
		return body.data.repository.id as string;
	};
	const create = `mutation($input: CreateLabelInput!) { createLabel(input: $input) { label { id } } }`;
	const update = `mutation($input: UpdateLabelInput!) { updateLabel(input: $input) { label { id name } } }`;

	it("bounds the description like REST", async () => {
		const repositoryId = await idOf(alice, "public-one");
		const { body } = await graphql(alice, create, {
			input: {
				repositoryId,
				name: "long-desc",
				color: "ff0000",
				description: "d".repeat(101),
			},
		});
		expect(body.errors[0].type).toBe("UNPROCESSABLE");
		expect(body.errors[0].message).toMatch(/^Description /);
	});

	it("refuses a rename onto another label's name", async () => {
		const repositoryId = await idOf(alice, "public-one");
		const made = await graphql(alice, create, {
			input: { repositoryId, name: "guard-target", color: "00ff00" },
		});
		const other = await graphql(alice, create, {
			input: { repositoryId, name: "guard-source", color: "00ff00" },
		});
		expect(made.body.errors).toBeUndefined();
		const { body } = await graphql(alice, update, {
			input: { id: other.body.data.createLabel.label.id, name: "GUARD-target" },
		});
		expect(body.errors[0]).toMatchObject({
			type: "UNPROCESSABLE",
			message: "Label already exists",
		});
	});

	it("refuses label writes on an archived repository, as REST does", async () => {
		const settings = await import("../repository-settings");
		const lookup = await import("../repository-lookup");
		const row = await lookup.findRepositoryByName("alice", "public-one");
		if (!row) throw new Error("fixture repository missing");
		const repositoryId = await idOf(alice, "public-one");
		const { body: before } = await graphql(alice, create, {
			input: { repositoryId, name: "pre-archive", color: "00ff00" },
		});
		expect(before.errors).toBeUndefined();
		await settings.updateRepositorySettings(row, { archived: true });
		try {
			const denied = await graphql(alice, create, {
				input: { repositoryId, name: "post-archive", color: "00ff00" },
			});
			expect(denied.body.errors[0].type).toBe("FORBIDDEN");
			const renamed = await graphql(alice, update, {
				input: { id: before.data.createLabel.label.id, name: "nope" },
			});
			expect(renamed.body.errors[0].type).toBe("FORBIDDEN");
		} finally {
			await settings.updateRepositorySettings(row, { archived: false });
		}
	});
});
