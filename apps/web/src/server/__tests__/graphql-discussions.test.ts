/**
 * @vitest-environment node
 *
 * GraphQL discussions: `Repository.discussion` and `discussions`,
 * `discussionCategories`, the `Discussion`/`DiscussionComment` types,
 * `node(id:)` and the write mutations. GitHub's shapes: connections with
 * `nodes`/`edges`/`pageInfo`/`totalCount`, ISO `DateTime`s, opaque cursors.
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
const { call, mintToken, patch, post } = await import("../../test/api-client");
const { graphql } = await import("../../test/graphql-client");
const { db } = await import("#/db");
const { createDiscussionForUser, findDiscussion, listDiscussionCategories } =
	await import("../discussion-store");

const users = await createUsers("alice", "bob");
let alice: string;
let bob: string;
let repoId: number;
let qaCategoryId: number;
let generalCategoryId: number;

const LIST = `query Discussions($owner: String!, $name: String!, $first: Int, $after: String) {
  repository(owner: $owner, name: $name) {
    hasDiscussionsEnabled
    discussionCategories(first: 10) {
      totalCount
      nodes { id name slug emoji isAnswerable }
    }
    discussions(first: $first, after: $after, orderBy: {field: UPDATED_AT, direction: DESC}) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        id number title body locked upvoteCount isAnswered
        category { slug isAnswerable }
        author { login }
        comments(first: 5) {
          totalCount
          nodes { id body }
        }
      }
    }
  }
}`;

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	bob = await mintToken(users.bob, ["repo:write"]);
	const created = await call("/user/repos", post(alice, { name: "proj" }));
	expect(created.status).toBe(201);
	repoId = created.body.id;
	const categories = await listDiscussionCategories(repoId);
	qaCategoryId = categories.find((row) => row.format === "q_and_a")?.id ?? 0;
	generalCategoryId = categories.find((row) => row.format === "open")?.id ?? 0;
	for (const title of ["first", "second"]) {
		await createDiscussionForUser(repoId, users.alice.id, {
			title,
			body: `${title} body`,
			categoryId: generalCategoryId,
		});
	}
});

describe("Repository.discussions", () => {
	it("lists newest first with categories and counts", async () => {
		const { body } = await graphql(alice, LIST, {
			owner: "alice",
			name: "proj",
			first: 1,
		});
		expect(body.errors).toBeUndefined();
		const repo = body.data.repository;
		expect(repo.hasDiscussionsEnabled).toBe(true);
		expect(repo.discussionCategories.totalCount).toBe(5);
		expect(
			repo.discussionCategories.nodes.map((n: { slug: string }) => n.slug),
		).toEqual(["general", "ideas", "q-a", "announcements", "show-and-tell"]);
		const connection = repo.discussions;
		expect(connection.totalCount).toBe(2);
		expect(connection.nodes.map((n: { title: string }) => n.title)).toEqual([
			"second",
		]);
		expect(connection.nodes[0]).toMatchObject({
			body: "second body",
			locked: false,
			upvoteCount: 0,
			isAnswered: false,
			category: { slug: "general", isAnswerable: false },
			author: { login: "alice" },
			comments: { totalCount: 0, nodes: [] },
		});
		expect(connection.pageInfo.hasNextPage).toBe(true);
	});

	it("pages the same way twice", async () => {
		const first = await graphql(alice, LIST, {
			owner: "alice",
			name: "proj",
			first: 1,
		});
		const cursor = first.body.data.repository.discussions.pageInfo.endCursor;
		const next = await graphql(alice, LIST, {
			owner: "alice",
			name: "proj",
			first: 1,
			after: cursor,
		});
		const again = await graphql(alice, LIST, {
			owner: "alice",
			name: "proj",
			first: 1,
			after: cursor,
		});
		expect(next.body.data.repository.discussions.nodes).toEqual(
			again.body.data.repository.discussions.nodes,
		);
		expect(
			next.body.data.repository.discussions.nodes.map(
				(n: { title: string }) => n.title,
			),
		).toEqual(["first"]);
	});

	it("refuses a page larger than 100", async () => {
		const { body } = await graphql(alice, LIST, {
			owner: "alice",
			name: "proj",
			first: 101,
		});
		expect(body.errors?.[0]?.type).toBe("EXCESSIVE_PAGINATION");
	});

	it("answers an unreadable repository with null and NOT_FOUND", async () => {
		await call("/user/repos", post(alice, { name: "hidden", private: true }));
		const { body } = await graphql(bob, LIST, {
			owner: "alice",
			name: "hidden",
			first: 1,
		});
		expect(body.data.repository).toBeNull();
		expect(body.errors?.[0]?.type).toBe("NOT_FOUND");
	});

	it("reads one discussion, and NOT_FOUND for an unknown number", async () => {
		const query = `query One($owner: String!, $name: String!, $number: Int!) {
			repository(owner: $owner, name: $name) {
				discussion(number: $number) { number title url resourcePath }
			}
		}`;
		const found = await graphql(alice, query, {
			owner: "alice",
			name: "proj",
			number: 2,
		});
		expect(found.body.data.repository.discussion).toMatchObject({
			number: 2,
			title: "second",
			resourcePath: "/alice/proj/discussions/2",
		});
		const missing = await graphql(alice, query, {
			owner: "alice",
			name: "proj",
			number: 99,
		});
		expect(missing.body.data.repository.discussion).toBeNull();
		expect(missing.body.errors?.[0]?.type).toBe("NOT_FOUND");
	});

	it("resolves a discussion, its category and comments through node(id:)", async () => {
		const list = await graphql(alice, LIST, {
			owner: "alice",
			name: "proj",
			first: 1,
		});
		const discussionId = list.body.data.repository.discussions.nodes[0].id;
		const categoryId =
			list.body.data.repository.discussionCategories.nodes[0].id;
		const query = `query Node($id: ID!) {
			node(id: $id) {
				__typename
				... on Discussion { number category { slug } }
				... on DiscussionCategory { slug }
			}
		}`;
		const discussion = await graphql(alice, query, { id: discussionId });
		expect(discussion.body.data.node).toMatchObject({
			__typename: "Discussion",
			number: 2,
			category: { slug: "general" },
		});
		const category = await graphql(alice, query, { id: categoryId });
		expect(category.body.data.node).toMatchObject({
			__typename: "DiscussionCategory",
			slug: "general",
		});
	});

	it("is an empty connection when discussions are disabled, not an error", async () => {
		const created = await call("/user/repos", post(alice, { name: "quiet" }));
		expect(created.status).toBe(201);
		const changed = await call(
			"/repos/alice/quiet",
			patch(alice, { has_discussions: false }),
		);
		expect(changed.status).toBe(200);
		const { body } = await graphql(alice, LIST, {
			owner: "alice",
			name: "quiet",
			first: 10,
		});
		expect(body.data.repository.hasDiscussionsEnabled).toBe(false);
		expect(body.data.repository.discussions).toMatchObject({
			totalCount: 0,
			nodes: [],
		});
		expect(body.data.repository.discussionCategories).toMatchObject({
			totalCount: 0,
			nodes: [],
		});
	});
});
