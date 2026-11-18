/**
 * @vitest-environment node
 *
 * Projects v2 writes: createProjectV2, createProjectV2Field,
 * addProjectV2ItemById, addProjectV2DraftIssue, updateProjectV2DraftIssue,
 * updateProjectV2ItemFieldValue and clearProjectV2ItemFieldValue, as
 * `gh project create`, `field-create`, `item-add` and `item-edit` send them.
 * A write needs the project's owner, a closed project is read-only, a value
 * must match its field's type and another user's private project is NOT_FOUND.
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
const { and, eq } = await import("drizzle-orm");
const { db } = await import("#/db");
const { issues, projectV2, pullRequests, repositories } = await import(
	"#/db/app-schema"
);
const { user } = await import("#/db/schema");
const { encodeNodeId } = await import("../graphql/node-id");
const { closeProject, findProjectByNumber } = await import("../project-store");

const users = await createUsers("alice", "bob");
let alice: string;
let bob: string;
let aliceOwnerId: string;
let issueNodeId: string;
let pullNodeId: string;
let hiddenIssueNodeId: string;
let projectId: string;
let textFieldId: string;
let numberFieldId: string;
let dateFieldId: string;
let selectFieldId: string;
let selectOptionId: string;
let issueItemId: string;
let draftItemId: string;
let issueNumber = 0;

const CREATE_PROJECT = `mutation($input: CreateProjectV2Input!) {
  createProjectV2(input: $input) {
    clientMutationId
    projectV2 {
      id number title shortDescription public closed
      owner { ... on User { login } }
      fields(first: 10) { nodes { ... on ProjectV2FieldCommon { name dataType } } }
    }
  }
}`;

const CREATE_FIELD = `mutation($input: CreateProjectV2FieldInput!) {
  createProjectV2Field(input: $input) {
    clientMutationId
    projectV2Field {
      ... on ProjectV2FieldCommon { id name dataType }
      ... on ProjectV2SingleSelectField { options { id name color } }
    }
  }
}`;

const ADD_ITEM = `mutation($input: AddProjectV2ItemByIdInput!) {
  addProjectV2ItemById(input: $input) {
    clientMutationId
    item {
      id
      type
      content {
        ... on Issue { number title }
        ... on PullRequest { number title }
      }
      project { number }
    }
  }
}`;

const ADD_DRAFT = `mutation($input: AddProjectV2DraftIssueInput!) {
  addProjectV2DraftIssue(input: $input) {
    clientMutationId
    projectItem {
      id
      type
      content { ... on DraftIssue { title body } }
    }
  }
}`;

const UPDATE_DRAFT = `mutation($input: UpdateProjectV2DraftIssueInput!) {
  updateProjectV2DraftIssue(input: $input) {
    clientMutationId
    draftIssue { id title body }
  }
}`;

const SET_VALUE = `mutation($input: UpdateProjectV2ItemFieldValueInput!) {
  updateProjectV2ItemFieldValue(input: $input) {
    clientMutationId
    projectV2Item {
      id
      fieldValues(first: 20) {
        totalCount
        nodes {
          ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } }
          ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { name } } }
          ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { name } } }
          ... on ProjectV2ItemFieldSingleSelectValue { name optionId field { ... on ProjectV2FieldCommon { name } } }
        }
      }
    }
  }
}`;

const CLEAR_VALUE = `mutation($input: ClearProjectV2ItemFieldValueInput!) {
  clearProjectV2ItemFieldValue(input: $input) {
    clientMutationId
    projectV2Item {
      id
      fieldValues(first: 20) { totalCount }
    }
  }
}`;

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

/** An issue, or with `pull` a pull request (a thread plus its pull request row). */
async function seedThread(
	repoId: number,
	authorId: string,
	title: string,
	pull = false,
): Promise<number> {
	issueNumber += 1;
	const [row] = await db
		.insert(issues)
		.values({
			repoId,
			number: issueNumber,
			kind: pull ? "pull_request" : "issue",
			authorId,
			title,
		})
		.returning({ id: issues.id });
	if (!row) throw new Error("issue insert failed");
	if (pull) {
		await db.insert(pullRequests).values({
			issueId: row.id,
			sourceBranch: `feature-${issueNumber}`,
			targetBranch: "main",
		});
	}
	return row.id;
}

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	bob = await mintToken(users.bob, ["repo:write"]);
	const [aliceRow] = await db
		.select({ apiId: user.apiId })
		.from(user)
		.where(eq(user.id, users.alice.id));
	if (!aliceRow) throw new Error("alice missing");
	aliceOwnerId = encodeNodeId("User", aliceRow.apiId);

	const repoId = await seedRepo(users.alice.id, "public", "public");
	issueNodeId = encodeNodeId(
		"Issue",
		await seedThread(repoId, users.alice.id, "Issue"),
	);
	pullNodeId = encodeNodeId(
		"PullRequest",
		await seedThread(repoId, users.alice.id, "Pull", true),
	);
	const hiddenRepoId = await seedRepo(users.bob.id, "hidden", "private");
	hiddenIssueNodeId = encodeNodeId(
		"Issue",
		await seedThread(hiddenRepoId, users.bob.id, "Secret"),
	);
});

describe("createProjectV2", () => {
	it("creates a private project with the built-in Status field", async () => {
		const { body } = await graphql(alice, CREATE_PROJECT, {
			input: {
				ownerId: aliceOwnerId,
				title: "Roadmap",
				clientMutationId: "c1",
			},
		});
		expect(body.errors).toBeUndefined();
		const created = body.data.createProjectV2;
		expect(created.clientMutationId).toBe("c1");
		expect(created.projectV2).toMatchObject({
			number: 1,
			title: "Roadmap",
			shortDescription: null,
			public: false,
			closed: false,
			owner: { login: "alice" },
		});
		expect(created.projectV2.fields.nodes).toEqual([
			{ name: "Status", dataType: "SINGLE_SELECT" },
		]);
		projectId = created.projectV2.id;
	});

	it("refuses an empty title and another user's owner id", async () => {
		const empty = await graphql(alice, CREATE_PROJECT, {
			input: { ownerId: aliceOwnerId, title: "  " },
		});
		expect(empty.body.errors?.[0]?.type).toBe("UNPROCESSABLE");

		const other = await graphql(alice, CREATE_PROJECT, {
			input: { ownerId: encodeNodeId("User", 2_000_000_000), title: "Theirs" },
		});
		expect(other.body.errors?.[0]?.type).toBe("NOT_FOUND");
	});
});

describe("createProjectV2Field", () => {
	it("creates a field of each supported type", async () => {
		const created: Record<string, string> = {};
		for (const [name, dataType] of [
			["Notes", "TEXT"],
			["Points", "NUMBER"],
			["Due", "DATE"],
		] as const) {
			const { body } = await graphql(alice, CREATE_FIELD, {
				input: { projectId, name, dataType },
			});
			expect(body.errors).toBeUndefined();
			expect(body.data.createProjectV2Field.projectV2Field).toMatchObject({
				name,
				dataType,
			});
			created[dataType] = body.data.createProjectV2Field.projectV2Field.id;
		}
		textFieldId = created.TEXT ?? "";
		numberFieldId = created.NUMBER ?? "";
		dateFieldId = created.DATE ?? "";

		const { body } = await graphql(alice, CREATE_FIELD, {
			input: {
				projectId,
				name: "Team",
				dataType: "SINGLE_SELECT",
				singleSelectOptions: [
					{ name: "Core", color: "BLUE", description: "" },
					{ name: "Docs", color: "GREEN", description: "" },
				],
			},
		});
		expect(body.errors).toBeUndefined();
		const field = body.data.createProjectV2Field.projectV2Field;
		expect(
			field.options.map((option: { name: string }) => option.name),
		).toEqual(["Core", "Docs"]);
		selectFieldId = field.id;
		selectOptionId = field.options[0].id;
	});

	it("refuses an unsupported type and a duplicate name", async () => {
		const iteration = await graphql(alice, CREATE_FIELD, {
			input: { projectId, name: "Sprint", dataType: "ITERATION" },
		});
		expect(iteration.body.errors?.[0]?.type).toBe("UNPROCESSABLE");

		const duplicate = await graphql(alice, CREATE_FIELD, {
			input: { projectId, name: "notes", dataType: "TEXT" },
		});
		expect(duplicate.body.errors?.[0]?.type).toBe("UNPROCESSABLE");
	});
});

describe("project items", () => {
	it("adds an issue and a pull request", async () => {
		for (const [contentId, title] of [
			[issueNodeId, "Issue"],
			[pullNodeId, "Pull"],
		] as const) {
			const { body } = await graphql(alice, ADD_ITEM, {
				input: { projectId, contentId },
			});
			expect(body.errors).toBeUndefined();
			const item = body.data.addProjectV2ItemById.item;
			expect(item.content.title).toBe(title);
			expect(item.project.number).toBe(1);
			if (title === "Issue") issueItemId = item.id;
		}
	});

	it("adds and updates a draft issue", async () => {
		const { body } = await graphql(alice, ADD_DRAFT, {
			input: { projectId, title: "Draft", body: "Sketch" },
		});
		expect(body.errors).toBeUndefined();
		expect(body.data.addProjectV2DraftIssue.projectItem).toMatchObject({
			type: "DRAFT_ISSUE",
			content: { title: "Draft", body: "Sketch" },
		});
		draftItemId = body.data.addProjectV2DraftIssue.projectItem.id;

		const updated = await graphql(alice, UPDATE_DRAFT, {
			input: { draftIssueId: draftItemId, title: "Draft 2", body: "Refined" },
		});
		expect(updated.body.errors).toBeUndefined();
		expect(
			updated.body.data.updateProjectV2DraftIssue.draftIssue,
		).toMatchObject({ title: "Draft 2", body: "Refined" });
	});

	it("keeps a draft's body when the update omits it", async () => {
		const { body } = await graphql(alice, UPDATE_DRAFT, {
			input: { draftIssueId: draftItemId, title: "Draft 3" },
		});
		expect(body.errors).toBeUndefined();
		expect(body.data.updateProjectV2DraftIssue.draftIssue).toMatchObject({
			title: "Draft 3",
			body: "Refined",
		});
	});

	it("refuses an item from a repository the caller cannot read", async () => {
		const { body } = await graphql(alice, ADD_ITEM, {
			input: { projectId, contentId: hiddenIssueNodeId },
		});
		expect(body.errors?.[0]?.type).toBe("UNPROCESSABLE");
	});

	it("refuses a duplicate issue item", async () => {
		const { body } = await graphql(alice, ADD_ITEM, {
			input: { projectId, contentId: issueNodeId },
		});
		expect(body.errors?.[0]?.type).toBe("UNPROCESSABLE");
	});
});

describe("field values", () => {
	it("sets a text, number, date and single-select value", async () => {
		const values = [
			[textFieldId, { text: "Needs review" }],
			[numberFieldId, { number: 3.5 }],
			[dateFieldId, { date: "2024-01-31" }],
			[selectFieldId, { singleSelectOptionId: selectOptionId }],
		] as const;
		for (const [fieldId, value] of values) {
			const { body } = await graphql(alice, SET_VALUE, {
				input: { projectId, itemId: issueItemId, fieldId, value },
			});
			expect(body.errors).toBeUndefined();
		}
		const { body } = await graphql(alice, SET_VALUE, {
			input: {
				projectId,
				itemId: issueItemId,
				fieldId: textFieldId,
				value: { text: "Ready" },
			},
		});
		const fieldValues =
			body.data.updateProjectV2ItemFieldValue.projectV2Item.fieldValues;
		expect(fieldValues.totalCount).toBe(4);
		expect(fieldValues.nodes).toEqual(
			expect.arrayContaining([
				{ text: "Ready", field: { name: "Notes" } },
				{ number: 3.5, field: { name: "Points" } },
				{ date: "2024-01-31", field: { name: "Due" } },
				{
					name: "Core",
					optionId: selectOptionId,
					field: { name: "Team" },
				},
			]),
		);
	});

	it("refuses a value of the wrong type", async () => {
		const { body } = await graphql(alice, SET_VALUE, {
			input: {
				projectId,
				itemId: issueItemId,
				fieldId: numberFieldId,
				value: { text: "not a number" },
			},
		});
		expect(body.errors?.[0]?.type).toBe("UNPROCESSABLE");
	});

	it("clears a value", async () => {
		const { body } = await graphql(alice, CLEAR_VALUE, {
			input: { projectId, itemId: issueItemId, fieldId: numberFieldId },
		});
		expect(body.errors).toBeUndefined();
		expect(
			body.data.clearProjectV2ItemFieldValue.projectV2Item.fieldValues
				.totalCount,
		).toBe(3);
	});
});

describe("access", () => {
	it("hides a private project from another user", async () => {
		const notFound = await graphql(bob, ADD_ITEM, {
			input: { projectId, contentId: issueNodeId },
		});
		expect(notFound.body.errors?.[0]?.type).toBe("NOT_FOUND");

		const draft = await graphql(bob, ADD_DRAFT, {
			input: { projectId, title: "Theirs" },
		});
		expect(draft.body.errors?.[0]?.type).toBe("NOT_FOUND");
	});

	it("refuses writes to a public project someone else owns", async () => {
		const { body: created } = await graphql(alice, CREATE_PROJECT, {
			input: { ownerId: aliceOwnerId, title: "Public" },
		});
		const publicProject = created.data.createProjectV2.projectV2;
		await db
			.update(projectV2)
			.set({ public: true })
			.where(
				and(
					eq(projectV2.ownerId, users.alice.id),
					eq(projectV2.number, publicProject.number),
				),
			);
		const { body } = await graphql(bob, ADD_DRAFT, {
			input: { projectId: publicProject.id, title: "Theirs" },
		});
		expect(body.errors?.[0]?.type).toBe("FORBIDDEN");
	});

	it("refuses writes to a closed project", async () => {
		const project = await findProjectByNumber(users.alice.id, 1);
		if (!project) throw new Error("project missing");
		await closeProject(project.id, users.alice.id, true);
		const { body } = await graphql(alice, ADD_DRAFT, {
			input: { projectId, title: "Too late" },
		});
		expect(body.errors?.[0]?.type).toBe("UNPROCESSABLE");
	});
});
