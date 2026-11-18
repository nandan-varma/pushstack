/**
 * @vitest-environment node
 *
 * Projects v2 at the store: per-owner numbers claim atomically, a new project
 * carries the built-in Status field, caps and wrong-typed values refuse with a
 * 422-shaped error, and a public project never exposes an item from a
 * repository the viewer cannot read.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));

const { createUsers } = await import("../../test/app-harness");
const { db } = await import("#/db");
const { issues, repositories } = await import("#/db/app-schema");
const {
	addProjectItem,
	clearProjectItemFieldValue,
	createProjectField,
	createProjectForUser,
	findProjectByNumber,
	findProjectItemFieldValueByName,
	findReadableProjectItem,
	listFieldOptions,
	listProjectFields,
	listProjectItems,
	listProjectItemFieldValues,
	ProjectValidationError,
	setProjectItemFieldValue,
	updateProjectField,
} = await import("../project-store");
const { sql } = await import("drizzle-orm");

const users = await createUsers("alice", "bob");
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

async function seedIssue(repoId: number, title = "An issue"): Promise<number> {
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

async function rejectsWith422(promise: Promise<unknown>): Promise<void> {
	const error = await promise.then(
		() => null,
		(caught: unknown) => caught,
	);
	expect(error).toBeInstanceOf(ProjectValidationError);
	expect((error as { status?: number }).status).toBe(422);
}

beforeAll(async () => {
	// The store tests seed repositories and issues directly: git storage and
	// the issue store are not what this suite exercises.
});

describe("project numbering", () => {
	it("gives concurrent creates distinct per-owner numbers", async () => {
		const created = await Promise.all(
			Array.from({ length: 4 }, (_, index) =>
				createProjectForUser(users.alice.id, { title: `Concurrent ${index}` }),
			),
		);
		expect(created.map((project) => project.number).sort()).toEqual([
			1, 2, 3, 4,
		]);
		const again = await createProjectForUser(users.alice.id, { title: "Next" });
		expect(again.number).toBe(5);
		expect((await findProjectByNumber(users.alice.id, 1))?.number).toBe(1);
	});

	it("starts each owner's sequence at 1", async () => {
		const project = await createProjectForUser(users.bob.id, { title: "Bob" });
		expect(project.number).toBe(1);
	});
});

describe("a new project", () => {
	it("carries Status with Todo, In Progress and Done", async () => {
		const project = await createProjectForUser(users.alice.id, {
			title: "Statused",
		});
		const { fields, total } = await listProjectFields(project.id, {
			offset: 0,
			limit: 10,
		});
		expect(total).toBe(1);
		expect(fields[0]).toMatchObject({
			name: "Status",
			dataType: "SINGLE_SELECT",
		});
		const options = await listFieldOptions(fields[0]!.id);
		expect(options.map((option) => option.name)).toEqual([
			"Todo",
			"In Progress",
			"Done",
		]);
	});
});

describe("project items", () => {
	it("refuses the same issue twice in one project", async () => {
		const repoId = await seedRepo(users.alice.id, "dup-items", "public");
		const issueId = await seedIssue(repoId);
		const project = await createProjectForUser(users.alice.id, {
			title: "Duplicates",
		});
		await addProjectItem(project.id, users.alice.id, { issueId });
		await rejectsWith422(
			addProjectItem(project.id, users.alice.id, { issueId }),
		);
	});

	it("refuses a value of the wrong field type", async () => {
		const project = await createProjectForUser(users.alice.id, {
			title: "Types",
		});
		const text = await createProjectField(project.id, users.alice.id, {
			name: "Notes",
			dataType: "TEXT",
		});
		const item = await addProjectItem(project.id, users.alice.id, {
			draftTitle: "Draft",
		});
		await rejectsWith422(
			setProjectItemFieldValue(item.id, users.alice.id, text.id, {
				type: "NUMBER",
				number: 1,
			}),
		);
	});

	it("sets, reads by name and clears a value", async () => {
		const project = await createProjectForUser(users.alice.id, {
			title: "Values",
		});
		const [status] = (
			await listProjectFields(project.id, {
				offset: 0,
				limit: 1,
			})
		).fields;
		const [done] = (await listFieldOptions(status!.id)).slice(-1);
		const item = await addProjectItem(project.id, users.alice.id, {
			draftTitle: "Draft",
			draftBody: "Body",
		});
		await setProjectItemFieldValue(item.id, users.alice.id, status!.id, {
			type: "SINGLE_SELECT",
			optionId: String(done!.id),
		});
		const value = await findProjectItemFieldValueByName(item.id, "status");
		expect(value?.value.optionId).toBe(done!.id);
		expect(value?.field.name).toBe("Status");
		expect(await listProjectItemFieldValues(item.id)).toHaveLength(1);
		expect(
			await clearProjectItemFieldValue(item.id, users.alice.id, status!.id),
		).toBe(true);
		expect(await findProjectItemFieldValueByName(item.id, "Status")).toBeNull();
	});

	it("hides an item from a private repository behind a public project", async () => {
		const privateRepo = await seedRepo(users.alice.id, "hidden", "private");
		const publicRepo = await seedRepo(users.alice.id, "shown", "public");
		const hiddenIssue = await seedIssue(privateRepo, "Secret");
		const shownIssue = await seedIssue(publicRepo, "Visible");
		const project = await createProjectForUser(users.alice.id, {
			title: "Mixed",
			public: true,
		});
		const hidden = await addProjectItem(project.id, users.alice.id, {
			issueId: hiddenIssue,
		});
		await addProjectItem(project.id, users.alice.id, {
			issueId: shownIssue,
		});
		await addProjectItem(project.id, users.alice.id, {
			draftTitle: "A draft",
		});

		const mine = await listProjectItems(project.id, users.alice.id, {
			offset: 0,
			limit: 10,
		});
		expect(mine.total).toBe(3);

		const theirs = await listProjectItems(project.id, users.bob.id, {
			offset: 0,
			limit: 10,
		});
		expect(theirs.total).toBe(2);
		expect(theirs.items.some((item) => item.issueId === hiddenIssue)).toBe(
			false,
		);
		expect(await findReadableProjectItem(hidden.id, users.bob.id)).toBeNull();
		expect(
			await findReadableProjectItem(hidden.id, users.alice.id),
		).not.toBeNull();
	});
});

describe("caps", () => {
	it("refuses a project past the per-user cap", async () => {
		const owner = await createUsers("capped");
		await db.execute(sql`
			insert into project_v2 (owner_id, number, title)
			select ${owner.capped.id}, n, 'Project ' || n
			from generate_series(1, 100) as n
		`);
		await rejectsWith422(
			createProjectForUser(owner.capped.id, { title: "Over" }),
		);
	});

	it("refuses an item past the per-project cap", async () => {
		const project = await createProjectForUser(users.alice.id, {
			title: "Full",
		});
		await db.execute(sql`
			insert into project_v2_items (project_id, draft_title)
			select ${project.id}, 'Draft ' || n
			from generate_series(1, 10000) as n
		`);
		await rejectsWith422(
			addProjectItem(project.id, users.alice.id, { draftTitle: "One more" }),
		);
	});

	it("refuses a field past the per-project cap", async () => {
		const project = await createProjectForUser(users.alice.id, {
			title: "Many fields",
		});
		for (let index = 1; index < 50; index++) {
			await createProjectField(project.id, users.alice.id, {
				name: `Field ${index}`,
				dataType: "TEXT",
			});
		}
		await rejectsWith422(
			createProjectField(project.id, users.alice.id, {
				name: "One too many",
				dataType: "TEXT",
			}),
		);
	});

	it("refuses options past the single-select cap", async () => {
		const project = await createProjectForUser(users.alice.id, {
			title: "Many options",
		});
		await rejectsWith422(
			createProjectField(project.id, users.alice.id, {
				name: "Too many",
				dataType: "SINGLE_SELECT",
				options: Array.from({ length: 51 }, (_, index) => ({
					name: `Option ${index}`,
				})),
			}),
		);
		const field = await createProjectField(project.id, users.alice.id, {
			name: "Sized",
			dataType: "SINGLE_SELECT",
			options: [{ name: "Todo" }],
		});
		await rejectsWith422(
			updateProjectField(field.id, users.alice.id, {
				options: Array.from({ length: 51 }, (_, index) => ({
					name: `Option ${index}`,
				})),
			}),
		);
	});

	it("refuses strings past their caps", async () => {
		await rejectsWith422(
			createProjectForUser(users.alice.id, { title: "x".repeat(257) }),
		);
		await rejectsWith422(
			createProjectForUser(users.alice.id, {
				title: "Descriptions",
				shortDescription: "x".repeat(501),
			}),
		);
		const project = await createProjectForUser(users.alice.id, {
			title: "Capped strings",
		});
		await rejectsWith422(
			createProjectField(project.id, users.alice.id, {
				name: "x".repeat(51),
				dataType: "TEXT",
			}),
		);
		await rejectsWith422(
			createProjectField(project.id, users.alice.id, {
				name: "Options",
				dataType: "SINGLE_SELECT",
				options: [{ name: "x".repeat(51) }],
			}),
		);
		const text = await createProjectField(project.id, users.alice.id, {
			name: "Text",
			dataType: "TEXT",
		});
		const item = await addProjectItem(project.id, users.alice.id, {
			draftTitle: "Draft",
		});
		await rejectsWith422(
			setProjectItemFieldValue(item.id, users.alice.id, text.id, {
				type: "TEXT",
				text: "x".repeat(1025),
			}),
		);
		await rejectsWith422(
			addProjectItem(project.id, users.alice.id, {
				draftTitle: "x".repeat(257),
			}),
		);
	});
});
