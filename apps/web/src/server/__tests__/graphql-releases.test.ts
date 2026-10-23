/**
 * @vitest-environment node
 *
 * GraphQL releases: `Repository.releases`/`release`/`latestRelease`,
 * `Release`, `ReleaseAsset` and `node(id:)`, as `gh release list` and `view`
 * ask for them. Drafts are visible to writers only.
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

const users = await createUsers("alice", "bob");
let alice: string;
let bob: string;

const LIST = `query ReleaseList($owner: String!, $name: String!, $first: Int!, $orderBy: ReleaseOrder) {
  repository(owner: $owner, name: $name) {
    releases(first: $first, orderBy: $orderBy) {
      totalCount
      nodes { name tagName isDraft isLatest isPrerelease immutable createdAt publishedAt }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	bob = await mintToken(users.bob, ["repo:write"]);
	await call("/user/repos", post(alice, { name: "proj", auto_init: true }));
	await call(
		"/repos/alice/proj/releases",
		post(alice, { tag_name: "v1.0.0", name: "One", body: "first" }),
	);
	const second = await call(
		"/repos/alice/proj/releases",
		post(alice, { tag_name: "v2.0.0-rc", prerelease: true }),
	);
	await call(`/repos/alice/proj/releases/${second.body.id}/assets?name=a.txt`, {
		...asToken(alice),
		method: "POST",
		body: new TextEncoder().encode("hello"),
		headers: { "content-type": "text/plain" },
	});
	await call(
		"/repos/alice/proj/releases",
		post(alice, { tag_name: "v3.0.0", draft: true }),
	);
});

describe("Repository.releases", () => {
	it("lists newest first with isLatest, and hides drafts from readers", async () => {
		const { body } = await graphql(bob, LIST, {
			owner: "alice",
			name: "proj",
			first: 10,
		});
		expect(body.errors).toBeUndefined();
		const connection = body.data.repository.releases;
		expect(connection.totalCount).toBe(2);
		expect(connection.nodes.map((n: { tagName: string }) => n.tagName)).toEqual(
			["v2.0.0-rc", "v1.0.0"],
		);
		expect(connection.nodes[1]).toMatchObject({
			name: "One",
			isLatest: true,
			isDraft: false,
			isPrerelease: false,
			immutable: false,
		});
		expect(connection.nodes[0]).toMatchObject({
			isLatest: false,
			isPrerelease: true,
		});
		expect(connection.pageInfo.hasNextPage).toBe(false);
	});

	it("shows drafts to writers and honors orderBy and paging", async () => {
		const all = await graphql(alice, LIST, {
			owner: "alice",
			name: "proj",
			first: 10,
		});
		expect(all.body.data.repository.releases.totalCount).toBe(3);
		const oldest = await graphql(alice, LIST, {
			owner: "alice",
			name: "proj",
			first: 1,
			orderBy: { field: "CREATED_AT", direction: "ASC" },
		});
		expect(oldest.body.data.repository.releases.nodes[0].tagName).toBe(
			"v1.0.0",
		);
		expect(oldest.body.data.repository.releases.pageInfo.hasNextPage).toBe(
			true,
		);
	});
});

describe("Repository.release and latestRelease", () => {
	const VIEW = `query($tag: String!) {
	  repository(owner: "alice", name: "proj") {
	    release(tagName: $tag) {
	      id databaseId name tagName description url resourcePath isLatest
	      author { login }
	      repository { nameWithOwner }
	      releaseAssets(first: 10) {
	        totalCount
	        nodes { id name size contentType downloadCount downloadUrl url uploadedBy { login } release { tagName } }
	      }
	    }
	    latestRelease { tagName }
	  }
	}`;

	it("reads a release with its assets", async () => {
		const { body } = await graphql(bob, VIEW, { tag: "v2.0.0-rc" });
		expect(body.errors).toBeUndefined();
		const release = body.data.repository.release;
		expect(release).toMatchObject({
			tagName: "v2.0.0-rc",
			resourcePath: "/alice/proj/releases/tag/v2.0.0-rc",
			author: { login: "alice" },
			repository: { nameWithOwner: "alice/proj" },
		});
		expect(release.releaseAssets.totalCount).toBe(1);
		expect(release.releaseAssets.nodes[0]).toMatchObject({
			name: "a.txt",
			size: 5,
			contentType: "text/plain",
			downloadCount: 0,
			uploadedBy: { login: "alice" },
			release: { tagName: "v2.0.0-rc" },
			downloadUrl: expect.stringContaining(
				"/alice/proj/releases/download/v2.0.0-rc/a.txt",
			),
		});
		expect(body.data.repository.latestRelease.tagName).toBe("v1.0.0");
	});

	it("answers null for an unknown tag and for a draft's tag", async () => {
		expect(
			(await graphql(bob, VIEW, { tag: "nope" })).body.data.repository.release,
		).toBeNull();
		expect(
			(await graphql(alice, VIEW, { tag: "v3.0.0" })).body.data.repository
				.release,
		).toBeNull();
	});

	it("resolves Release and ReleaseAsset ids through node(id:)", async () => {
		const view = await graphql(bob, VIEW, { tag: "v2.0.0-rc" });
		const release = view.body.data.repository.release;
		const asset = release.releaseAssets.nodes[0];
		const { body } = await graphql(
			bob,
			`query($ids: [ID!]!) { nodes(ids: $ids) { __typename ... on Release { tagName } ... on ReleaseAsset { name } } }`,
			{ ids: [release.id, asset.id] },
		);
		expect(body.errors).toBeUndefined();
		expect(body.data.nodes).toEqual([
			{ __typename: "Release", tagName: "v2.0.0-rc" },
			{ __typename: "ReleaseAsset", name: "a.txt" },
		]);
		// The REST node_id is the same id.
		const rest = await call("/repos/alice/proj/releases/tags/v2.0.0-rc");
		expect(rest.body.node_id).toBe(release.id);
	});
});
