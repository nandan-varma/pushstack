/**
 * @vitest-environment node
 *
 * GraphQL gists: `User.gists` with its privacy filter, the `Gist`, `GistFile`,
 * `GistComment` and `Language` shapes `gh gist list` reads, and `node(id:)` for
 * both the `G_` form and the legacy REST `node_id`.
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
const { call, mintToken, post } = await import("../../test/api-client");
const { graphql } = await import("../../test/graphql-client");
const { decodeNodeId } = await import("../graphql/node-id");

const users = await createUsers("alice", "bob");
let alice: string;
let bob: string;
let publicId: string;
let secretId: string;

const LIST = `query GistList($login: String!, $privacy: GistPrivacy) {
  user(login: $login) {
    gists(first: 2, privacy: $privacy) {
      totalCount
      nodes {
        id
        name
        description
        isPublic
        files(limit: 10) { name text size isTruncated language { name } }
        stargazerCount
        viewerHasStarred
      }
    }
  }
}`;

beforeAll(async () => {
	alice = await mintToken(users.alice, ["gist"]);
	bob = await mintToken(users.bob, ["gist"]);
	const created = await call(
		"/gists",
		post(alice, {
			description: "a public gist",
			public: true,
			files: { "hello.ts": { content: "export const hello = 1;\n" } },
		}),
	);
	publicId = created.body.id;
	await call(
		"/gists",
		post(alice, {
			description: "another public gist",
			public: true,
			files: { "notes.md": { content: "# notes\n" } },
		}),
	);
	const secret = await call(
		"/gists",
		post(alice, {
			description: "a secret gist",
			files: { "hidden.txt": { content: "unlisted\n" } },
		}),
	);
	secretId = secret.body.id;
	await call(`/gists/${publicId}/star`, {
		method: "PUT",
		headers: { authorization: `bearer ${bob}` },
	});
});

describe("User.gists", () => {
	it("lists a user's public gists with files and languages", async () => {
		const { body } = await graphql(
			bob,
			LIST,
			{ login: "alice", privacy: "PUBLIC" },
			"GistList",
		);
		expect(body.errors).toBeUndefined();
		const gists = body.data.user.gists;
		expect(gists.totalCount).toBe(2);
		const gist = gists.nodes.find(
			(node: { name: string }) => node.name === publicId,
		);
		expect(gist).toMatchObject({
			id: expect.stringMatching(/^G_/),
			description: "a public gist",
			isPublic: true,
			files: [
				{
					name: "hello.ts",
					text: "export const hello = 1;\n",
					size: 24,
					isTruncated: false,
					language: { name: "typescript" },
				},
			],
			stargazerCount: 1,
			viewerHasStarred: true,
		});
	});

	it("omits another user's secret gist from an unfiltered connection", async () => {
		const { body } = await graphql(bob, LIST, { login: "alice" }, "GistList");
		expect(body.errors).toBeUndefined();
		const names = body.data.user.gists.nodes.map(
			(node: { name: string }) => node.name,
		);
		expect(names).not.toContain(secretId);
	});

	it("resolves a Gist through node(id:) in both id forms", async () => {
		const listed = await graphql(bob, LIST, { login: "alice" }, "GistList");
		const nodeId: string = listed.body.data.user.gists.nodes.find(
			(node: { name: string }) => node.name === publicId,
		).id;
		const QUERY = `query Node($id: ID!) {
  node(id: $id) { id ... on Gist { name isPublic files(limit: 1) { name } } }
}`;
		const global = await graphql(bob, QUERY, { id: nodeId });
		expect(global.body.errors).toBeUndefined();
		expect(global.body.data.node).toMatchObject({
			id: nodeId,
			name: publicId,
			isPublic: true,
			files: [{ name: "hello.ts" }],
		});

		const rest = await call(`/gists/${publicId}`, {
			headers: { authorization: `bearer ${alice}` },
		});
		expect(decodeNodeId(rest.body.node_id)).toEqual({
			type: "Gist",
			key: publicId,
		});
		const legacy = await graphql(bob, QUERY, { id: rest.body.node_id });
		expect(legacy.body.errors).toBeUndefined();
		expect(legacy.body.data.node).toMatchObject({ name: publicId });
	});
});
