/**
 * @vitest-environment node
 *
 * The web project pages' writes: creating a project, managing fields and
 * their options, adding issues or drafts, and setting, clearing and editing
 * values. Only the project's owner may write; anyone else gets a 404 for a
 * private project or a 403 for someone else's public one, with no partial
 * row left behind.
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

const { createUsers, rejectsNotFound, signIn, signOut } = await import(
	"../../test/app-harness"
);
const {
	addUserProjectItem,
	clearUserProjectItemFieldValue,
	createUserProject,
	createUserProjectField,
	getUserProject,
	searchUserProjectAddableItems,
	setUserProjectItemFieldValue,
	updateUserProjectDraft,
	updateUserProjectField,
} = await import("../projects");
const { db } = await import("#/db");
const { issues, repositories } = await import("#/db/app-schema");

const users = await createUsers("alice", "bob");
let number = 0;
let repoIssueNumber = 0;
const issueIds: Record<string, number> = {};

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
	repoIssueNumber += 1;
	const [row] = await db
		.insert(issues)
		.values({
			repoId,
			number: repoIssueNumber,
			authorId: users.alice.id,
			title,
			body: `${title} body`,
		})
		.returning({ id: issues.id });
	if (!row) throw new Error("issue insert failed");
	return row.id;
}

beforeAll(async () => {
	const publicRepo = await seedRepo(users.alice.id, "shown", "public");
	const privateRepo = await seedRepo(users.alice.id, "hidden", "private");
	issueIds.visible = await seedIssue(publicRepo, "Visible work");
	issueIds.secret = await seedIssue(privateRepo, "Secret work");
	issueIds.other = await seedIssue(publicRepo, "Second task");

	signIn(users.alice);
	const project = await createUserProject({
		data: { title: "Roadmap", shortDescription: "Plan", public: true },
	});
	number = project.number;
});

describe("createUserProject", () => {
	it("claims the owner's next number and seeds the Status field", async () => {
		const second = await createUserProject({
			data: { title: "Second", shortDescription: null, public: false },
		});
		expect(second.number).toBe(number + 1);
		const page = await getUserProject({
			data: { login: "alice", number: second.number, page: 1 },
		});
		expect(page.project.title).toBe("Second");
		expect(page.canWrite).toBe(true);
		expect(page.fields).toEqual([
			expect.objectContaining({
				name: "Status",
				dataType: "SINGLE_SELECT",
				options: [
					expect.objectContaining({ name: "Todo" }),
					expect.objectContaining({ name: "In Progress" }),
					expect.objectContaining({ name: "Done" }),
				],
			}),
		]);
	});

	it("refuses a blank or oversized title", async () => {
		await expect(
			createUserProject({ data: { title: "  ", shortDescription: null, public: true } }),
		).rejects.toThrow(/title/i);
		await expect(
			createUserProject({
				data: { title: "x".repeat(257), shortDescription: null, public: true },
			}),
		).rejects.toThrow();
	});

	it("requires a signed-in viewer", async () => {
		signOut();
		await expect(
			createUserProject({ data: { title: "Nope", shortDescription: null, public: true } }),
		).rejects.toThrow(/Unauthorized/i);
		signIn(users.alice);
	});
});

describe("createUserProjectField", () => {
	it("creates a single-select field with options", async () => {
		const field = await createUserProjectField({
			data: {
				login: "alice",
				number,
				name: "Priority",
				dataType: "SINGLE_SELECT",
				options: [{ name: "Low" }, { name: "High" }],
			},
		});
		const page = await getUserProject({
			data: { login: "alice", number, page: 1 },
		});
		const created = page.fields.find((entry) => entry.id === field.id);
		expect(created).toMatchObject({ name: "Priority" });
		expect(created?.options.map((option) => option.name)).toEqual([
			"Low",
			"High",
		]);
	});

	it("refuses a duplicate field name and options on a plain type", async () => {
		await expect(
			createUserProjectField({
				data: {
					login: "alice",
					number,
					name: "priority",
					dataType: "TEXT",
				},
			}),
		).rejects.toThrow(/already exists/i);
		await expect(
			createUserProjectField({
				data: {
					login: "alice",
					number,
					name: "Notes",
					dataType: "TEXT",
					options: [{ name: "Bad" }],
				},
			}),
		).rejects.toThrow(/single-select/i);
	});

	it("refuses anyone but the owner", async () => {
		signIn(users.bob);
		await expect(
			createUserProjectField({
				data: { login: "alice", number, name: "X", dataType: "TEXT" },
			}),
		).rejects.toThrow(/Access denied/i);
		signOut();
		await rejectsNotFound(
			createUserProjectField({
				data: { login: "alice", number, name: "X", dataType: "TEXT" },
			}),
		);
		signIn(users.alice);
	});
});

describe("updateUserProjectField", () => {
	it("renames a field and appends an option that keeps existing values", async () => {
		const item = await addUserProjectItem({
			data: { login: "alice", number, issueId: issueIds.visible },
		});
		const page = await getUserProject({
			data: { login: "alice", number, page: 1 },
		});
		const status = page.fields.find((field) => field.name === "Status");
		if (!status) throw new Error("Status missing");
		await setUserProjectItemFieldValue({
			data: {
				login: "alice",
				number,
				itemId: item.id,
				fieldId: status.id,
				value: {
					type: "SINGLE_SELECT",
					optionId: status.options[0]?.id ?? "",
				},
			},
		});
		await updateUserProjectField({
			data: {
				login: "alice",
				number,
				fieldId: status.id,
				options: [
					...status.options.map((option) => ({
						id: option.id,
						name: option.name,
					})),
					{ name: "Blocked" },
				],
			},
		});
		const next = await getUserProject({
			data: { login: "alice", number, page: 1 },
		});
		const renamed = next.fields.find((field) => field.id === status.id);
		expect(renamed?.options.map((option) => option.name)).toContain("Blocked");
		const renamedRow = next.items.find((row) => row.id === item.id);
		expect(renamedRow?.values.status).toBe("Todo");
	});

	it("404s a field that is not this project's", async () => {
		await rejectsNotFound(
			updateUserProjectField({
				data: {
					login: "alice",
					number,
					fieldId: 999_999,
					name: "Nope",
				},
			}),
		);
	});
});

describe("addUserProjectItem", () => {
	it("adds an issue and a draft, and both persist", async () => {
		await addUserProjectItem({
			data: { login: "alice", number, issueId: issueIds.other },
		});
		await addUserProjectItem({
			data: { login: "alice", number, draftTitle: "Write docs", draftBody: "Soon" },
		});
		const page = await getUserProject({
			data: { login: "alice", number, page: 1 },
		});
		expect(page.items.map((item) => item.title)).toEqual([
			"Visible work",
			"Second task",
			"Write docs",
		]);
		expect(page.items[2]).toMatchObject({ kind: "draft", body: "Soon" });
	});

	it("refuses a duplicate issue and an unreadable one", async () => {
		await expect(
			addUserProjectItem({
				data: { login: "alice", number, issueId: issueIds.other },
			}),
		).rejects.toThrow(/already/i);
		signIn(users.bob);
		await expect(
			addUserProjectItem({
				data: { login: "alice", number, issueId: issueIds.secret },
			}),
		).rejects.toThrow(/Access denied/i);
		signOut();
		await rejectsNotFound(
			addUserProjectItem({
				data: { login: "alice", number, issueId: issueIds.secret },
			}),
		);
		signIn(users.alice);
	});
});

describe("set and clear field values", () => {
	it("sets a text, number, date and select value, and clears one", async () => {
		const created = await createUserProjectField({
			data: { login: "alice", number, name: "Notes", dataType: "TEXT" },
		});
		const points = await createUserProjectField({
			data: { login: "alice", number, name: "Points", dataType: "NUMBER" },
		});
		const due = await createUserProjectField({
			data: { login: "alice", number, name: "Due", dataType: "DATE" },
		});
		const page = await getUserProject({
			data: { login: "alice", number, page: 1 },
		});
		const item = page.items.find((entry) => entry.title === "Visible work");
		if (!item) throw new Error("item missing");
		const call = (
			fieldId: number,
			value:
				| { type: "TEXT"; text: string }
				| { type: "NUMBER"; number: number }
				| { type: "DATE"; date: string }
				| { type: "SINGLE_SELECT"; optionId: string },
		) =>
			setUserProjectItemFieldValue({
				data: {
					login: "alice",
					number,
					itemId: item.id,
					fieldId,
					value,
				},
			});
		await call(created.id, { type: "TEXT", text: "hello" });
		await call(points.id, { type: "NUMBER", number: 5 });
		await call(due.id, { type: "DATE", date: "2026-01-31" });
		const status = page.fields.find((field) => field.name === "Status");
		if (!status) throw new Error("status missing");
		await call(status.id, {
			type: "SINGLE_SELECT",
			optionId: status.options[1]?.id ?? "",
		});
		const updated = await getUserProject({
			data: { login: "alice", number, page: 1 },
		});
		const row = updated.items.find((entry) => entry.id === item.id);
		expect(row?.values).toMatchObject({
			notes: "hello",
			points: "5",
			due: "2026-01-31",
			status: "In Progress",
		});
		await clearUserProjectItemFieldValue({
			data: { login: "alice", number, itemId: item.id, fieldId: created.id },
		});
		const cleared = await getUserProject({
			data: { login: "alice", number, page: 1 },
		});
		expect(
			cleared.items.find((entry) => entry.id === item.id)?.values.notes,
		).toBeNull();
	});

	it("refuses a value of the wrong type", async () => {
		const page = await getUserProject({
			data: { login: "alice", number, page: 1 },
		});
		const item = page.items[0];
		const status = page.fields.find((field) => field.name === "Status");
		if (!item || !status) throw new Error("missing");
		await expect(
			setUserProjectItemFieldValue({
				data: {
					login: "alice",
					number,
					itemId: item.id,
					fieldId: status.id,
					value: { type: "TEXT", text: "no" },
				},
			}),
		).rejects.toThrow(/takes a/i);
	});

	it("refuses a non-owner with no partial row", async () => {
		const before = await getUserProject({
			data: { login: "alice", number, page: 1 },
		});
		signIn(users.bob);
		const item = before.items[0];
		const field = before.fields[0];
		await expect(
			setUserProjectItemFieldValue({
				data: {
					login: "alice",
					number,
					itemId: item?.id ?? 0,
					fieldId: field?.id ?? 0,
					value: { type: "SINGLE_SELECT", optionId: field?.options[0]?.id ?? "" },
				},
			}),
		).rejects.toThrow(/Access denied/i);
		signOut();
		await rejectsNotFound(
			clearUserProjectItemFieldValue({
				data: {
					login: "alice",
					number,
					itemId: item?.id ?? 0,
					fieldId: field?.id ?? 0,
				},
			}),
		);
		signIn(users.alice);
		const after = await getUserProject({
			data: { login: "alice", number, page: 1 },
		});
		expect(after.items.find((entry) => entry.id === item?.id)?.values).toEqual(
			before.items.find((entry) => entry.id === item?.id)?.values,
		);
	});
});

describe("updateUserProjectDraft", () => {
	it("edits a draft's title and body", async () => {
		const page = await getUserProject({
			data: { login: "alice", number, page: 1 },
		});
		const draft = page.items.find((entry) => entry.kind === "draft");
		if (!draft) throw new Error("draft missing");
		await updateUserProjectDraft({
			data: {
				login: "alice",
				number,
				itemId: draft.id,
				title: "Write the docs",
				body: "Now",
			},
		});
		const updated = await getUserProject({
			data: { login: "alice", number, page: 1 },
		});
		expect(updated.items.find((entry) => entry.id === draft.id)).toMatchObject({
			title: "Write the docs",
			body: "Now",
		});
	});

	it("refuses an issue item and a non-owner", async () => {
		const page = await getUserProject({
			data: { login: "alice", number, page: 1 },
		});
		const issue = page.items.find((entry) => entry.kind === "issue");
		if (!issue) throw new Error("issue missing");
		await rejectsNotFound(
			updateUserProjectDraft({
				data: {
					login: "alice",
					number,
					itemId: issue.id,
					title: "Nope",
					body: null,
				},
			}),
		);
		signIn(users.bob);
		await expect(
			updateUserProjectDraft({
				data: {
					login: "alice",
					number,
					itemId: issue.id,
					title: "Nope",
					body: null,
				},
			}),
		).rejects.toThrow(/Access denied/i);
		signIn(users.alice);
	});
});

describe("searchUserProjectAddableItems", () => {
	it("shows readable unadded items and matches by number", async () => {
		const found = await searchUserProjectAddableItems({
			data: { login: "alice", number, query: "work" },
		});
		expect(found.items.map((item) => item.title)).toEqual(["Secret work"]);
		expect(found.items[0]).toMatchObject({
			repoOwner: "alice",
			repoName: "hidden",
			kind: "issue",
		});
		const byNumber = await searchUserProjectAddableItems({
			data: { login: "alice", number, query: "2" },
		});
		expect(byNumber.items.map((item) => item.title)).toEqual(["Secret work"]);
	});

	it("never shows a private repository's issues to another viewer", async () => {
		signIn(users.bob);
		const own = await createUserProject({
			data: { title: "Bob's board", shortDescription: null, public: true },
		});
		const found = await searchUserProjectAddableItems({
			data: { login: "bob", number: own.number, query: "work" },
		});
		expect(found.items.map((item) => item.title)).toEqual(["Visible work"]);
		signOut();
		await expect(
			searchUserProjectAddableItems({
				data: { login: "bob", number: own.number, query: "work" },
			}),
		).rejects.toThrow(/Unauthorized/i);
	});

	it("refuses a viewer who cannot write the project", async () => {
		signIn(users.bob);
		await rejectsNotFound(
			searchUserProjectAddableItems({
				data: { login: "alice", number, query: "" },
			}),
		);
		signOut();
		await expect(
			searchUserProjectAddableItems({
				data: { login: "alice", number, query: "" },
			}),
		).rejects.toThrow(/Unauthorized/i);
		signIn(users.alice);
	});
});
