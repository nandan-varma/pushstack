/**
 * @vitest-environment node
 *
 * Projects v2 reads: `User.projectsV2`, `ProjectV2` and its items and fields,
 * `fieldValueByName`, `Query.resource`, and the `PVT_`/`PVTI_`/`PVTF_`/
 * `PVTSSF_` node ids, as `gh project list`, `view`, `item-list` and
 * `field-list` ask for them. Another user's private project and an item from a
 * private repository are omitted, never leaked.
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
const { mintToken } = await import("../../test/api-client");
const { graphql } = await import("../../test/graphql-client");
const { db } = await import("#/db");
const { issues, repositories } = await import("#/db/app-schema");
const {
	addProjectItem,
	createProjectField,
	createProjectForUser,
	listFieldOptions,
	listProjectFields,
	setProjectItemFieldValue,
} = await import("../project-store");

const users = await createUsers("alice", "bob");
let alice: string;
let bob: string;
let publicRepoId: number;
let privateRepoId: number;
let issueNumber = 1;

async function seedRepo(
	ownerId: string,
	name: string,
	visibility: "public" | "private",
): Promise<number> {
	const [repo] = await db
		.insert(repositories)
		.values({ ownerId, name, visibility })
		.returning({ id: repositories.id });
	if (!repo) throw new Error("repo insert failed");
	return repo.id;
}

async function seedIssue(repoId: number, title: string): Promise<number> {
	const [row] = await db
		.insert(issues)
		.values({
			repoId,
			number: issueNumber++,
			authorId: users.alice.id,
			title,
			body: `${title} body`,
		})
		.returning({ id: issues.id });
	if (!row) throw new Error("issue insert failed");
	return row.id;
}

interface ProjectFixture {
	project: { id: number; number: number };
	status: { id: number };
	optionId: string;
	text: { id: number };
	draft: { id: number };
	issueItem: { id: number };
}

let fixture: ProjectFixture;
let privateProjectNumber: number;

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	bob = await mintToken(users.bob, ["repo:write"]);
	publicRepoId = await seedRepo(users.alice.id, "shown", "public");
	privateRepoId = await seedRepo(users.alice.id, "hidden", "private");
	const publicIssue = await seedIssue(publicRepoId, "Public issue");
	const privateIssue = await seedIssue(privateRepoId, "Secret issue");

	const project = await createProjectForUser(users.alice.id, {
		title: "Roadmap",
		shortDescription: "What comes next",
		public: true,
	});
	const { fields } = await listProjectFields(project.id, {
		offset: 0,
		limit: 10,
	});
	const status = fields[0];
	if (!status) throw new Error("the Status field is missing");
	const done = (await listFieldOptions(status.id)).at(-1);
	if (!done) throw new Error("the Done option is missing");
	const text = await createProjectField(project.id, users.alice.id, {
		name: "Notes",
		dataType: "TEXT",
	});
	const draft = await addProjectItem(project.id, users.alice.id, {
		draftTitle: "Draft plan",
		draftBody: "Draft body",
	});
	const issueItem = await addProjectItem(project.id, users.alice.id, {
		issueId: publicIssue,
	});
	await addProjectItem(project.id, users.alice.id, { issueId: privateIssue });
	await setProjectItemFieldValue(draft.id, users.alice.id, status.id, {
		type: "SINGLE_SELECT",
		optionId: String(done.id),
	});
	await setProjectItemFieldValue(issueItem.id, users.alice.id, text.id, {
		type: "TEXT",
		text: "Needs review",
	});
	fixture = {
		project,
		status,
		optionId: String(done.id),
		text,
		draft,
		issueItem,
	};

	const privateProject = await createProjectForUser(users.alice.id, {
		title: "Secret",
		public: false,
	});
	privateProjectNumber = privateProject.number;
	await addProjectItem(privateProject.id, users.alice.id, {
		issueId: privateIssue,
	});
});

const LIST = `query ProjectList($owner: String!, $first: Int!) {
  user(login: $owner) {
    projectsV2(first: $first) {
      totalCount
      nodes { id number title shortDescription public closed url resourcePath owner { ... on User { login } } }
    }
  }
}`;

const VIEW = `query ProjectView($owner: String!, $number: Int!) {
  user(login: $owner) {
    projectV2(number: $number) {
      id
      number
      title
      shortDescription
      readme
      public
      closed
      url
      resourcePath
      createdAt
      updatedAt
      owner { ... on User { login } }
      items(first: 10) {
        totalCount
        nodes {
          id
          type
          isArchived
          content {
            ... on Issue { number title repository { nameWithOwner } }
            ... on PullRequest { number title }
            ... on DraftIssue { title body }
          }
          status: fieldValueByName(name: "Status") {
            ... on ProjectV2ItemFieldSingleSelectValue { name optionId color }
          }
          fieldValues(first: 10) {
            totalCount
            nodes {
              ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } }
              ... on ProjectV2ItemFieldSingleSelectValue { name optionId field { ... on ProjectV2FieldCommon { name } } }
            }
          }
        }
      }
      fields(first: 10) {
        totalCount
        nodes {
          ... on ProjectV2FieldCommon { id name dataType }
          ... on ProjectV2SingleSelectField { options { id name color } }
        }
      }
    }
  }
}`;

describe("projects reads", () => {
	it("lists an owner's projects through the connection", async () => {
		const { body } = await graphql(bob, LIST, { owner: "alice", first: 10 });
		expect(body.errors).toBeUndefined();
		const connection = body.data.user.projectsV2;
		// The private project is not Bob's to see.
		expect(connection.totalCount).toBe(1);
		expect(connection.nodes[0]).toMatchObject({
			title: "Roadmap",
			shortDescription: "What comes next",
			public: true,
			closed: false,
			url: expect.stringContaining("/users/alice/projects/"),
			resourcePath: expect.stringMatching(/^\/users\/alice\/projects\/\d+$/),
			owner: { login: "alice" },
		});
	});

	it("answers every selected field of a project, its items and its fields", async () => {
		const { body } = await graphql(bob, VIEW, {
			owner: "alice",
			number: fixture.project.number,
		});
		expect(body.errors).toBeUndefined();
		const project = body.data.user.projectV2;
		expect(project).toMatchObject({
			number: 1,
			title: "Roadmap",
			readme: null,
			owner: { login: "alice" },
		});

		// The private-repository item is omitted; the draft and the public issue remain.
		expect(project.items.totalCount).toBe(2);
		const contents = project.items.nodes.map(
			(node: { content: { title: string } }) => node.content.title,
		);
		expect(contents.sort()).toEqual(["Draft plan", "Public issue"]);
		const draft = project.items.nodes.find(
			(node: { type: string }) => node.type === "DRAFT_ISSUE",
		);
		expect(draft.content.body).toBe("Draft body");
		expect(draft.status).toMatchObject({
			name: "Done",
			optionId: fixture.optionId,
		});
		const issue = project.items.nodes.find(
			(node: { type: string }) => node.type === "ISSUE",
		);
		expect(issue.content.repository.nameWithOwner).toBe("alice/shown");
		expect(issue.fieldValues.totalCount).toBe(1);
		expect(issue.fieldValues.nodes[0]).toMatchObject({
			text: "Needs review",
			field: { name: "Notes" },
		});

		expect(project.fields.totalCount).toBe(2);
		const status = project.fields.nodes.find(
			(node: { name: string }) => node.name === "Status",
		);
		expect(status).toMatchObject({
			dataType: "SINGLE_SELECT",
			options: [
				{ name: "Todo", color: "GRAY" },
				{ name: "In Progress", color: "YELLOW" },
				{ name: "Done", color: "GREEN" },
			],
		});
		const notes = project.fields.nodes.find(
			(node: { name: string }) => node.name === "Notes",
		);
		expect(notes).toMatchObject({ dataType: "TEXT" });
	});

	it("hides another user's private project", async () => {
		const { body } = await graphql(bob, VIEW, {
			owner: "alice",
			number: privateProjectNumber,
		});
		expect(body.data.user.projectV2).toBeNull();
	});

	it("round-trips every project node id", async () => {
		const { body } = await graphql(bob, VIEW, {
			owner: "alice",
			number: fixture.project.number,
		});
		const projectId = body.data.user.projectV2.id;
		const itemId = body.data.user.projectV2.items.nodes[0].id;
		const statusId = body.data.user.projectV2.fields.nodes.find(
			(node: { name: string }) => node.name === "Status",
		).id;
		const textId = body.data.user.projectV2.fields.nodes.find(
			(node: { name: string }) => node.name === "Notes",
		).id;
		expect([
			projectId.slice(0, 4),
			itemId.slice(0, 5),
			statusId.slice(0, 7),
			textId.slice(0, 5),
		]).toEqual(["PVT_", "PVTI_", "PVTSSF_", "PVTF_"]);

		const NODE = `query Node($id: ID!) {
      node(id: $id) { __typename id ... on ProjectV2 { number } ... on ProjectV2Item { type } ... on ProjectV2SingleSelectField { name } ... on ProjectV2Field { name } }
    }`;
		const expected = [
			[projectId, "ProjectV2"],
			[itemId, "ProjectV2Item"],
			[statusId, "ProjectV2SingleSelectField"],
			[textId, "ProjectV2Field"],
		] as const;
		for (const [id, type] of expected) {
			const result = await graphql(bob, NODE, { id });
			expect(result.body.errors).toBeUndefined();
			expect(result.body.data.node.__typename).toBe(type);
			expect(result.body.data.node.id).toBe(id);
		}
	});

	it("refuses an unreadable project item through node(id:)", async () => {
		const { body } = await graphql(
			alice,
			`query PrivateItems($number: Int!) {
        user(login: "alice") {
          projectV2(number: $number) { items(first: 10) { nodes { id } } }
        }
      }`,
			{ number: privateProjectNumber },
		);
		const itemId = body.data.user.projectV2.items.nodes[0].id;
		const hidden = await graphql(
			bob,
			`query Node($id: ID!) { node(id: $id) { id } }`,
			{ id: itemId },
		);
		expect(hidden.body.data.node).toBeNull();
		expect(hidden.body.errors?.[0]?.type).toBe("NOT_FOUND");
	});

	it("lists the projects an issue is on through Issue.projectItems", async () => {
		const { body } = await graphql(
			bob,
			`query IssueProjects {
        repository(owner: "alice", name: "shown") {
          issue(number: 1) {
            projectItems(first: 10) {
              totalCount
              nodes { project { number title } isArchived }
            }
          }
        }
      }`,
		);
		expect(body.errors).toBeUndefined();
		expect(body.data.repository.issue.projectItems).toMatchObject({
			totalCount: 1,
			nodes: [{ project: { number: 1, title: "Roadmap" }, isArchived: false }],
		});
	});

	it("resolves Query.resource for an issue URL", async () => {
		const { body } = await graphql(
			bob,
			`query Resource($url: URI!) {
        resource(url: $url) { ... on Issue { number title } ... on PullRequest { number } }
      }`,
			{ url: "https://example.test/alice/shown/issues/1" },
		);
		expect(body.errors).toBeUndefined();
		expect(body.data.resource).toMatchObject({
			number: 1,
			title: "Public issue",
		});
	});
});
