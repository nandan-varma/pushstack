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
const { createDiscussionForUser, listDiscussionCategories } = await import(
	"../discussion-store"
);

const users = await createUsers("alice", "bob");
let alice: string;
let bob: string;
let repoId: number;
let generalCategoryId: number;

const CATEGORIES = `query Categories($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    id
    discussionCategories(first: 10) { nodes { id slug isAnswerable } }
  }
}`;

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

const CREATE = `mutation Create($input: CreateDiscussionInput!) {
  createDiscussion(input: $input) {
    clientMutationId
    discussion { id number isAnswered title category { slug } author { login } }
  }
}`;

const COMMENT = `mutation Comment($input: AddDiscussionCommentInput!) {
  addDiscussionComment(input: $input) {
    comment {
      id body isAnswer
      replyTo { id }
      replies(first: 10) { totalCount nodes { id body } }
    }
  }
}`;

async function created(input: {
	repositoryId: string;
	categoryId: string;
	title: string;
	body: string;
}) {
	const { body } = await graphql(alice, CREATE, { input });
	expect(body.errors).toBeUndefined();
	return body.data.createDiscussion.discussion;
}

describe("discussion mutations", () => {
	it("creates a discussion with the next #N and isAnswered false", async () => {
		const categories = await graphql(alice, CATEGORIES, {
			owner: "alice",
			name: "proj",
		});
		const nodes = categories.body.data.repository.discussionCategories.nodes;
		const qa = nodes.find((node: { slug: string }) => node.slug === "q-a");
		const discussion = await created({
			repositoryId: categories.body.data.repository.id,
			categoryId: qa.id,
			title: "question",
			body: "how?",
		});
		expect(discussion).toMatchObject({
			isAnswered: false,
			title: "question",
			category: { slug: "q-a" },
			author: { login: "alice" },
		});
		expect(discussion.number).toBe(3);
	});

	it("adds a top-level comment and one reply level", async () => {
		const categories = await graphql(alice, CATEGORIES, {
			owner: "alice",
			name: "proj",
		});
		const nodes = categories.body.data.repository.discussionCategories.nodes;
		const qa = nodes.find((node: { slug: string }) => node.slug === "q-a");
		const discussion = await created({
			repositoryId: categories.body.data.repository.id,
			categoryId: qa.id,
			title: "answered question",
			body: "how?",
		});
		const top = await graphql(alice, COMMENT, {
			input: { discussionId: discussion.id, body: "an answer" },
		});
		expect(top.body.errors).toBeUndefined();
		const comment = top.body.data.addDiscussionComment.comment;
		const reply = await graphql(alice, COMMENT, {
			input: {
				discussionId: discussion.id,
				body: "a reply",
				replyToId: comment.id,
			},
		});
		expect(reply.body.errors).toBeUndefined();
		const node = reply.body.data.addDiscussionComment.comment;
		expect(node).toMatchObject({
			body: "a reply",
			isAnswer: false,
			replyTo: { id: comment.id },
		});
		const repliesToTop = await graphql(
			alice,
			`query Replies($id: ID!) {
				node(id: $id) { ... on DiscussionComment { replies(first: 10) { totalCount } } }
			}`,
			{ id: comment.id },
		);
		expect(repliesToTop.body.data.node.replies.totalCount).toBe(1);
		const nested = await graphql(alice, COMMENT, {
			input: {
				discussionId: discussion.id,
				body: "too deep",
				replyToId: node.id,
			},
		});
		expect(nested.body.errors?.[0]?.type).toBe("UNPROCESSABLE");
	});

	it("marks a reply as the answer in Q&A, and refuses elsewhere", async () => {
		const categories = await graphql(alice, CATEGORIES, {
			owner: "alice",
			name: "proj",
		});
		const nodes = categories.body.data.repository.discussionCategories.nodes;
		const qa = nodes.find((node: { slug: string }) => node.slug === "q-a");
		const general = nodes.find(
			(node: { slug: string }) => node.slug === "general",
		);
		const repositoryId = categories.body.data.repository.id;
		const discussion = await created({
			repositoryId,
			categoryId: qa.id,
			title: "mark me",
			body: "how?",
		});
		const comment = (
			await graphql(alice, COMMENT, {
				input: { discussionId: discussion.id, body: "the answer" },
			})
		).body.data.addDiscussionComment.comment;
		const answer = await graphql(
			alice,
			`mutation Mark($input: MarkDiscussionCommentAsAnswerInput!) {
				markDiscussionCommentAsAnswer(input: $input) {
					discussion { isAnswered answer { id } }
				}
			}`,
			{ input: { id: comment.id } },
		);
		expect(answer.body.errors).toBeUndefined();
		expect(
			answer.body.data.markDiscussionCommentAsAnswer.discussion,
		).toMatchObject({ isAnswered: true, answer: { id: comment.id } });
		// Someone who can read the public repository but is neither its author
		// nor a writer cannot choose the answer.
		const denied = await graphql(
			bob,
			`mutation Mark($input: MarkDiscussionCommentAsAnswerInput!) {
				markDiscussionCommentAsAnswer(input: $input) { discussion { isAnswered } }
			}`,
			{ input: { id: comment.id } },
		);
		expect(denied.body.errors?.[0]?.type).toBe("FORBIDDEN");

		const open = await created({
			repositoryId,
			categoryId: general.id,
			title: "not a question",
			body: "chat",
		});
		const openComment = (
			await graphql(alice, COMMENT, {
				input: { discussionId: open.id, body: "hi" },
			})
		).body.data.addDiscussionComment.comment;
		const refused = await graphql(
			alice,
			`mutation Mark($input: MarkDiscussionCommentAsAnswerInput!) {
				markDiscussionCommentAsAnswer(input: $input) { discussion { isAnswered } }
			}`,
			{ input: { id: openComment.id } },
		);
		expect(refused.body.errors?.[0]?.type).toBe("UNPROCESSABLE");
	});

	it("counts a repeated upvote once and removes it", async () => {
		const categories = await graphql(alice, CATEGORIES, {
			owner: "alice",
			name: "proj",
		});
		const nodes = categories.body.data.repository.discussionCategories.nodes;
		const general = nodes.find(
			(node: { slug: string }) => node.slug === "general",
		);
		const discussion = await created({
			repositoryId: categories.body.data.repository.id,
			categoryId: general.id,
			title: "upvote me",
			body: "please",
		});
		const upvote = `mutation Up($input: AddUpvoteInput!) {
			addUpvote(input: $input) {
				subject { ... on Discussion { upvoteCount viewerHasUpvoted } }
			}
		}`;
		await graphql(alice, upvote, { input: { subjectId: discussion.id } });
		const twice = await graphql(alice, upvote, {
			input: { subjectId: discussion.id },
		});
		expect(twice.body.data.addUpvote.subject).toMatchObject({
			upvoteCount: 1,
			viewerHasUpvoted: true,
		});
		const removed = await graphql(
			alice,
			`mutation Down($input: RemoveUpvoteInput!) {
				removeUpvote(input: $input) {
					subject { ... on Discussion { upvoteCount viewerHasUpvoted } }
				}
			}`,
			{ input: { subjectId: discussion.id } },
		);
		expect(removed.body.data.removeUpvote.subject).toMatchObject({
			upvoteCount: 0,
			viewerHasUpvoted: false,
		});
	});

	it("closes with GitHub's reason and reopens", async () => {
		const categories = await graphql(alice, CATEGORIES, {
			owner: "alice",
			name: "proj",
		});
		const nodes = categories.body.data.repository.discussionCategories.nodes;
		const general = nodes.find(
			(node: { slug: string }) => node.slug === "general",
		);
		const discussion = await created({
			repositoryId: categories.body.data.repository.id,
			categoryId: general.id,
			title: "close me",
			body: "",
		});
		const closed = await graphql(
			alice,
			`mutation Close($input: CloseDiscussionInput!) {
				closeDiscussion(input: $input) {
					discussion { closed stateReason }
				}
			}`,
			{ input: { discussionId: discussion.id, reason: "OUTDATED" } },
		);
		expect(closed.body.data.closeDiscussion.discussion).toEqual({
			closed: true,
			stateReason: "OUTDATED",
		});
		const reopened = await graphql(
			alice,
			`mutation Reopen($input: ReopenDiscussionInput!) {
				reopenDiscussion(input: $input) {
					discussion { closed stateReason }
				}
			}`,
			{ input: { discussionId: discussion.id } },
		);
		expect(reopened.body.data.reopenDiscussion.discussion).toEqual({
			closed: false,
			stateReason: "REOPENED",
		});
	});

	it("updates and deletes a discussion", async () => {
		const categories = await graphql(alice, CATEGORIES, {
			owner: "alice",
			name: "proj",
		});
		const nodes = categories.body.data.repository.discussionCategories.nodes;
		const general = nodes.find(
			(node: { slug: string }) => node.slug === "general",
		);
		const ideas = nodes.find((node: { slug: string }) => node.slug === "ideas");
		const discussion = await created({
			repositoryId: categories.body.data.repository.id,
			categoryId: general.id,
			title: "edit me",
			body: "old",
		});
		const updated = await graphql(
			alice,
			`mutation Update($input: UpdateDiscussionInput!) {
				updateDiscussion(input: $input) {
					discussion { title body category { slug } }
				}
			}`,
			{
				input: {
					discussionId: discussion.id,
					title: "edited",
					body: "new",
					categoryId: ideas.id,
				},
			},
		);
		expect(updated.body.data.updateDiscussion.discussion).toMatchObject({
			title: "edited",
			body: "new",
			category: { slug: "ideas" },
		});
		const deleted = await graphql(
			alice,
			`mutation Delete($input: DeleteDiscussionInput!) {
				deleteDiscussion(input: $input) { discussion { number } }
			}`,
			{ input: { id: discussion.id } },
		);
		expect(deleted.body.errors).toBeUndefined();
		const missing = await graphql(alice, LIST, {
			owner: "alice",
			name: "proj",
			first: 100,
		});
		expect(
			missing.body.data.repository.discussions.nodes.map(
				(node: { number: number }) => node.number,
			),
		).not.toContain(discussion.number);
	});

	it("refuses a comment in a locked discussion", async () => {
		const categories = await graphql(alice, CATEGORIES, {
			owner: "alice",
			name: "proj",
		});
		const nodes = categories.body.data.repository.discussionCategories.nodes;
		const general = nodes.find(
			(node: { slug: string }) => node.slug === "general",
		);
		const discussion = await created({
			repositoryId: categories.body.data.repository.id,
			categoryId: general.id,
			title: "locked",
			body: "",
		});
		await db.execute("update discussions set locked = true");
		const refused = await graphql(alice, COMMENT, {
			input: { discussionId: discussion.id, body: "hello" },
		});
		expect(refused.body.errors?.[0]?.type).toBe("UNPROCESSABLE");
		await db.execute("update discussions set locked = false");
	});

	it("edits and deletes a comment", async () => {
		const categories = await graphql(alice, CATEGORIES, {
			owner: "alice",
			name: "proj",
		});
		const nodes = categories.body.data.repository.discussionCategories.nodes;
		const general = nodes.find(
			(node: { slug: string }) => node.slug === "general",
		);
		const discussion = await created({
			repositoryId: categories.body.data.repository.id,
			categoryId: general.id,
			title: "comments",
			body: "",
		});
		const comment = (
			await graphql(alice, COMMENT, {
				input: { discussionId: discussion.id, body: "before" },
			})
		).body.data.addDiscussionComment.comment;
		const updated = await graphql(
			alice,
			`mutation Edit($input: UpdateDiscussionCommentInput!) {
				updateDiscussionComment(input: $input) { comment { id body } }
			}`,
			{ input: { commentId: comment.id, body: "after" } },
		);
		expect(updated.body.data.updateDiscussionComment.comment.body).toBe(
			"after",
		);
		const deleted = await graphql(
			alice,
			`mutation Remove($input: DeleteDiscussionCommentInput!) {
				deleteDiscussionComment(input: $input) { comment { id } }
			}`,
			{ input: { id: comment.id } },
		);
		expect(deleted.body.errors).toBeUndefined();
		const gone = await graphql(
			alice,
			`query One($id: ID!) { node(id: $id) { id } }`,
			{ id: comment.id },
		);
		expect(gone.body.errors?.[0]?.type).toBe("NOT_FOUND");
	});

	it("needs a token", async () => {
		const categories = await graphql(alice, CATEGORIES, {
			owner: "alice",
			name: "proj",
		});
		const general =
			categories.body.data.repository.discussionCategories.nodes[0];
		const { status } = await graphql(null, CREATE, {
			input: {
				repositoryId: categories.body.data.repository.id,
				categoryId: general.id,
				title: "anonymous",
				body: "",
			},
		});
		expect(status).toBe(401);
	});

	it("needs a readable repository", async () => {
		// bob cannot read alice's private repository: the repository is null.
		const categories = await graphql(bob, CATEGORIES, {
			owner: "alice",
			name: "hidden",
		});
		expect(categories.body.data.repository).toBeNull();
		expect(categories.body.errors?.[0]?.type).toBe("NOT_FOUND");
	});
});
