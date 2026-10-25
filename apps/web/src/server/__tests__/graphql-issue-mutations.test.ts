/**
 * @vitest-environment node
 *
 * GraphQL issue mutations: createIssue, updateIssue, closeIssue, reopenIssue,
 * add/removeLabelsFromLabelable, add/removeAssigneesFromAssignable and
 * addComment. Each answers the GitHub payload shape, checks the caller's
 * token scope and repository permission, and refuses bad input before writing.
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
const { db } = await import("#/db");
const { encodeNodeId } = await import("../graphql/node-id");

const users = await createUsers("alice", "bob");
let alice: string;
let bob: string;
let readOnly: string;
let repoNodeId: string;
let bugLabelNodeId: string;
let issueNodeId: string;

const CREATE = `mutation($input: CreateIssueInput!) {
  createIssue(input: $input) { clientMutationId issue { id number title body state labels(first: 10) { nodes { name } } assignees(first: 10) { nodes { login } } } }
}`;

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	bob = await mintToken(users.bob, ["repo:write"]);
	readOnly = await mintToken(users.bob, ["repo:read"]);
	await call("/user/repos", post(alice, { name: "proj", auto_init: true }));
	const repo = await db.query.repositories.findFirst({
		where: { name: "proj" },
	});
	if (!repo) throw new Error("alice/proj missing");
	repoNodeId = encodeNodeId("Repository", repo.id);
	const bugRow = await db.query.labels.findFirst({
		where: { repoId: repo.id, name: "bug" },
	});
	if (!bugRow) throw new Error("bug label missing");
	bugLabelNodeId = encodeNodeId("Label", bugRow.id);
});

describe("createIssue", () => {
	it("creates the issue for a writer with labels and assignees", async () => {
		const { body } = await graphql(alice, CREATE, {
			input: {
				repositoryId: repoNodeId,
				title: "First",
				body: "Body",
				labelIds: [bugLabelNodeId],
				assigneeIds: [encodeNodeId("User", users.alice.id)],
				clientMutationId: "m1",
			},
		});
		expect(body.errors).toBeUndefined();
		const issue = body.data.createIssue.issue;
		expect(body.data.createIssue.clientMutationId).toBe("m1");
		expect(issue).toMatchObject({
			number: 1,
			title: "First",
			body: "Body",
			state: "OPEN",
			labels: { nodes: [{ name: "bug" }] },
			assignees: { nodes: [{ login: "alice" }] },
		});
		issueNodeId = issue.id;
	});

	it("refuses labels from a reader, which opens nothing", async () => {
		const { body } = await graphql(bob, CREATE, {
			input: {
				repositoryId: repoNodeId,
				title: "Reader",
				labelIds: [bugLabelNodeId],
			},
		});
		expect(body.data.createIssue).toBeNull();
		expect(body.errors?.[0]?.type).toBe("FORBIDDEN");
	});

	it("opens a bare issue for a reader without labels", async () => {
		const { body } = await graphql(bob, CREATE, {
			input: { repositoryId: repoNodeId, title: "Reader issue" },
		});
		expect(body.errors).toBeUndefined();
		expect(body.data.createIssue.issue.labels.nodes).toEqual([]);
	});

	it("is all-or-nothing: an unknown label leaves no issue behind", async () => {
		const before = await db.query.issues.findMany({
			where: { title: "Doomed" },
		});
		const ghost = encodeNodeId("Label", 2_000_000_000);
		const { body } = await graphql(alice, CREATE, {
			input: { repositoryId: repoNodeId, title: "Doomed", labelIds: [ghost] },
		});
		expect(body.errors?.[0]?.type).toBe("NOT_FOUND");
		const after = await db.query.issues.findMany({
			where: { title: "Doomed" },
		});
		expect(after.length).toBe(before.length);
	});

	it("needs a repo:write token", async () => {
		const { body } = await graphql(readOnly, CREATE, {
			input: { repositoryId: repoNodeId, title: "Scoped" },
		});
		expect(body.errors?.[0]?.type).toBe("INSUFFICIENT_SCOPES");
	});

	it("refuses titles and bodies over the caps", async () => {
		const { body } = await graphql(alice, CREATE, {
			input: { repositoryId: repoNodeId, title: "x".repeat(300) },
		});
		expect(body.errors?.[0]?.type).toBe("UNPROCESSABLE");
		const big = await graphql(alice, CREATE, {
			input: {
				repositoryId: repoNodeId,
				title: "Big",
				body: "y".repeat(65_537),
			},
		});
		expect(big.body.errors?.[0]?.type).toBe("UNPROCESSABLE");
	});
});

describe("updateIssue, closeIssue and reopenIssue", () => {
	it("lets the author edit title and state, and records the close reason", async () => {
		const { body } = await graphql(
			alice,
			`mutation($id: ID!) { updateIssue(input: {id: $id, title: "Renamed", state: CLOSED}) { issue { title state stateReason } } }`,
			{ id: issueNodeId },
		);
		expect(body.errors).toBeUndefined();
		expect(body.data.updateIssue.issue).toEqual({
			title: "Renamed",
			state: "CLOSED",
			stateReason: "COMPLETED",
		});
	});

	it("refuses an edit from a stranger", async () => {
		const { body } = await graphql(
			bob,
			`mutation($id: ID!) { updateIssue(input: {id: $id, title: "Hijack"}) { issue { title } } }`,
			{ id: issueNodeId },
		);
		expect(body.errors?.[0]?.type).toBe("FORBIDDEN");
	});

	it("reopens with REOPENED and closes as NOT_PLANNED", async () => {
		const reopened = await graphql(
			alice,
			`mutation($id: ID!) { reopenIssue(input: {issueId: $id}) { issue { state stateReason } } }`,
			{ id: issueNodeId },
		);
		expect(reopened.body.data.reopenIssue.issue).toEqual({
			state: "OPEN",
			stateReason: "REOPENED",
		});
		const closed = await graphql(
			alice,
			`mutation($id: ID!) { closeIssue(input: {issueId: $id, stateReason: NOT_PLANNED}) { issue { state stateReason } } }`,
			{ id: issueNodeId },
		);
		expect(closed.body.data.closeIssue.issue).toEqual({
			state: "CLOSED",
			stateReason: "NOT_PLANNED",
		});
	});

	it("refuses duplicate closes, which are not supported yet", async () => {
		const { body } = await graphql(
			alice,
			`mutation($id: ID!) { closeIssue(input: {issueId: $id, duplicateIssueId: $id}) { issue { state } } }`,
			{ id: issueNodeId },
		);
		expect(body.errors?.[0]?.type).toBe("UNPROCESSABLE");
	});
});

describe("labels and assignees", () => {
	it("adds and removes labels on an issue", async () => {
		const added = await graphql(
			alice,
			`mutation($id: ID!, $labels: [ID!]!) { addLabelsToLabelable(input: {labelableId: $id, labelIds: $labels}) { labelable { ... on Issue { labels(first: 10) { nodes { name } } } } } }`,
			{ id: issueNodeId, labels: [bugLabelNodeId] },
		);
		expect(added.body.errors).toBeUndefined();
		expect(added.body.data.addLabelsToLabelable.labelable.labels.nodes).toEqual(
			[{ name: "bug" }],
		);
		const removed = await graphql(
			alice,
			`mutation($id: ID!, $labels: [ID!]!) { removeLabelsFromLabelable(input: {labelableId: $id, labelIds: $labels}) { labelable { ... on Issue { labels(first: 10) { nodes { name } } } } } }`,
			{ id: issueNodeId, labels: [bugLabelNodeId] },
		);
		expect(
			removed.body.data.removeLabelsFromLabelable.labelable.labels.nodes,
		).toEqual([]);
	});

	it("refuses label changes from a reader", async () => {
		const { body } = await graphql(
			bob,
			`mutation($id: ID!, $labels: [ID!]!) { addLabelsToLabelable(input: {labelableId: $id, labelIds: $labels}) { labelable { __typename } } }`,
			{ id: issueNodeId, labels: [bugLabelNodeId] },
		);
		expect(body.errors?.[0]?.type).toBe("FORBIDDEN");
	});

	it("adds and removes assignees", async () => {
		const aliceNode = encodeNodeId("User", users.alice.id);
		const added = await graphql(
			alice,
			`mutation($id: ID!, $who: [ID!]!) { addAssigneesToAssignable(input: {assignableId: $id, assigneeIds: $who}) { assignable { ... on Issue { assignees(first: 10) { nodes { login } } } } } }`,
			{ id: issueNodeId, who: [aliceNode] },
		);
		expect(added.body.errors).toBeUndefined();
		expect(
			added.body.data.addAssigneesToAssignable.assignable.assignees.nodes,
		).toEqual([{ login: "alice" }]);
		const removed = await graphql(
			alice,
			`mutation($id: ID!, $who: [ID!]!) { removeAssigneesFromAssignable(input: {assignableId: $id, assigneeIds: $who}) { assignable { ... on Issue { assignees(first: 10) { nodes { login } } } } } }`,
			{ id: issueNodeId, who: [aliceNode] },
		);
		expect(
			removed.body.data.removeAssigneesFromAssignable.assignable.assignees
				.nodes,
		).toEqual([]);
	});
});

describe("addComment", () => {
	it("comments as the caller and returns the new edge", async () => {
		const { body } = await graphql(
			bob,
			`mutation($id: ID!) { addComment(input: {subjectId: $id, body: "Thanks"}) { commentEdge { cursor node { body authorAssociation } } subject { ... on Issue { number } } } }`,
			{ id: issueNodeId },
		);
		expect(body.errors).toBeUndefined();
		expect(body.data.addComment.commentEdge.node).toEqual({
			body: "Thanks",
			authorAssociation: "NONE",
		});
		expect(body.data.addComment.commentEdge.cursor).toEqual(expect.any(String));
		expect(body.data.addComment.subject).toEqual({ number: 1 });
	});

	it("refuses an empty or over-cap body", async () => {
		const blank = await graphql(
			bob,
			`mutation($id: ID!) { addComment(input: {subjectId: $id, body: "   "}) { commentEdge { node { id } } } }`,
			{ id: issueNodeId },
		);
		expect(blank.body.errors?.[0]?.type).toBe("UNPROCESSABLE");
		const big = await graphql(
			bob,
			`mutation($id: ID!, $body: String!) { addComment(input: {subjectId: $id, body: $body}) { commentEdge { node { id } } } }`,
			{ id: issueNodeId, body: "z".repeat(65_537) },
		);
		expect(big.body.errors?.[0]?.type).toBe("UNPROCESSABLE");
	});
});
