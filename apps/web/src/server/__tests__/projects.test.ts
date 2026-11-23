/**
 * @vitest-environment node
 *
 * The web project pages' reads: an owner's project list, a project's header,
 * fields, item table and filter. A public project shows only items whose
 * repository the viewer can read; a private or missing one is NOT_FOUND.
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

const { createUsers, signIn, signOut } = await import("../../test/app-harness");
const { getUserProject, getUserProjects } = await import("../projects");
const { db } = await import("#/db");
const { issues, repositories, projectV2Items, projectV2ItemFieldValues } =
	await import("#/db/app-schema");
const {
	addProjectItem,
	createProjectField,
	createProjectForUser,
	listFieldOptions,
	listProjectFields,
	listProjectItems,
	setProjectItemFieldValue,
} = await import("../project-store");

const users = await createUsers("alice", "bob");
let publicNumber = 0;
let privateNumber = 0;
let issueNumber = 0;

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
	issueNumber += 1;
	const [row] = await db
		.insert(issues)
		.values({
			repoId,
			number: issueNumber,
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
	const publicIssue = await seedIssue(publicRepo, "Visible work");
	const privateIssue = await seedIssue(privateRepo, "Secret work");

	const project = await createProjectForUser(users.alice.id, {
		title: "Roadmap",
		shortDescription: "What comes next",
		public: true,
	});
	publicNumber = project.number;
	const { fields } = await listProjectFields(project.id, {
		offset: 0,
		limit: 10,
	});
	const status = fields[0];
	if (!status) throw new Error("Status field missing");
	const todo = (await listFieldOptions(status.id))[0];
	if (!todo) throw new Error("Todo option missing");
	const notes = await createProjectField(project.id, users.alice.id, {
		name: "Notes",
		dataType: "TEXT",
	});
	const points = await createProjectField(project.id, users.alice.id, {
		name: "Points",
		dataType: "NUMBER",
	});
	const team = await createProjectField(project.id, users.alice.id, {
		name: "Team",
		dataType: "SINGLE_SELECT",
		options: [{ name: "Core" }, { name: "Docs" }],
	});
	const [core] = await listFieldOptions(team.id);
	const visible = await addProjectItem(project.id, users.alice.id, {
		issueId: publicIssue,
	});
	await addProjectItem(project.id, users.alice.id, { issueId: privateIssue });
	const draft = await addProjectItem(project.id, users.alice.id, {
		draftTitle: "Draft plan",
		draftBody: "**Soon**",
	});
	await setProjectItemFieldValue(visible.id, users.alice.id, status.id, {
		type: "SINGLE_SELECT",
		optionId: String(todo.id),
	});
	await setProjectItemFieldValue(visible.id, users.alice.id, notes.id, {
		type: "TEXT",
		text: "Needs review",
	});
	await setProjectItemFieldValue(visible.id, users.alice.id, points.id, {
		type: "NUMBER",
		number: 3,
	});
	if (!core) throw new Error("Core option missing");
	await setProjectItemFieldValue(draft.id, users.alice.id, team.id, {
		type: "SINGLE_SELECT",
		optionId: String(core.id),
	});

	const hidden = await createProjectForUser(users.alice.id, {
		title: "Secret",
		public: false,
	});
	privateNumber = hidden.number;
	await addProjectItem(hidden.id, users.alice.id, { draftTitle: "Hidden" });
});

describe("getUserProjects", () => {
	it("lists only the projects the viewer can read", async () => {
		signIn(users.bob);
		const seen = await getUserProjects({
			data: { login: "alice", page: 1 },
		});
		expect(seen.total).toBe(1);
		expect(seen.projects.map((project) => project.title)).toEqual(["Roadmap"]);
		expect(seen.projects[0]).toMatchObject({
			number: publicNumber,
			shortDescription: "What comes next",
			public: true,
			closed: false,
		});
		expect(seen.viewerIsOwner).toBe(false);
		signOut();
	});

	it("shows the owner their private projects too", async () => {
		signIn(users.alice);
		const seen = await getUserProjects({
			data: { login: "alice", page: 1 },
		});
		expect(seen.total).toBe(2);
		expect(seen.viewerIsOwner).toBe(true);
		signOut();
	});

	it("answers an unknown login as not found", async () => {
		await expect(
			getUserProjects({ data: { login: "nobody", page: 1 } }),
		).rejects.toThrow();
	});
});

describe("getUserProject", () => {
	it("shows fields, values and only the items the viewer can read", async () => {
		signIn(users.bob);
		const page = await getUserProject({
			data: { login: "alice", number: publicNumber, page: 1 },
		});
		expect(page.project).toMatchObject({
			number: publicNumber,
			title: "Roadmap",
			shortDescription: "What comes next",
			public: true,
			ownerLogin: "alice",
		});
		expect(page.canWrite).toBe(false);
		expect(page.fields.map((field) => field.name)).toEqual([
			"Status",
			"Notes",
			"Points",
			"Team",
		]);
		expect(page.itemCount).toBe(2);
		const [issue, draft] = page.items;
		expect(issue).toMatchObject({
			title: "Visible work",
			kind: "issue",
			repoOwner: "alice",
			repoName: "shown",
			values: {
				status: "Todo",
				notes: "Needs review",
				points: "3",
				team: null,
			},
		});
		expect(draft).toMatchObject({
			title: "Draft plan",
			kind: "draft",
			body: "**Soon**",
			repoOwner: null,
			values: { team: "Core", status: null },
		});
		signOut();
	});

	it("404s a private project for anyone else", async () => {
		signIn(users.bob);
		await expect(
			getUserProject({
				data: { login: "alice", number: privateNumber, page: 1 },
			}),
		).rejects.toThrow();
		signOut();
		signIn(users.alice);
		const own = await getUserProject({
			data: { login: "alice", number: privateNumber, page: 1 },
		});
		expect(own.canWrite).toBe(true);
		expect(own.items.map((item) => item.title)).toEqual(["Hidden"]);
		signOut();
	});

	it("narrows the rows with a URL filter", async () => {
		signIn(users.bob);
		const drafts = await getUserProject({
			data: { login: "alice", number: publicNumber, q: "is:draft", page: 1 },
		});
		expect(drafts.items.map((item) => item.title)).toEqual(["Draft plan"]);
		expect(drafts.total).toBe(1);
		const status = await getUserProject({
			data: {
				login: "alice",
				number: publicNumber,
				q: "status:todo",
				page: 1,
			},
		});
		expect(status.items.map((item) => item.title)).toEqual(["Visible work"]);
		const none = await getUserProject({
			data: {
				login: "alice",
				number: publicNumber,
				q: "team:docs",
				page: 1,
			},
		});
		expect(none.items).toEqual([]);
		expect(none.total).toBe(0);
		signOut();
	});

	it("pages the filtered rows", async () => {
		signIn(users.bob);
		const page = await getUserProject({
			data: { login: "alice", number: publicNumber, page: 2 },
		});
		expect(page.pageCount).toBe(1);
		expect(page.items).toEqual([]);
		signOut();
	});
});

describe("projects larger than the client board budget", () => {
	let number: number;
	let projectId: number;
	beforeAll(async () => {
		const project = await createProjectForUser(users.alice.id, {
			title: "Large project",
			public: true,
		});
		number = project.number;
		projectId = project.id;
		const points = await createProjectField(projectId, users.alice.id, {
			name: "Points",
			dataType: "NUMBER",
		});
		const due = await createProjectField(projectId, users.alice.id, {
			name: "Due",
			dataType: "DATE",
		});
		const rows = await db
			.insert(projectV2Items)
			.values(
				Array.from({ length: 501 }, (_, index) => ({
					projectId,
					draftTitle: `Task${String(index + 1).padStart(4, "0")}`,
					updatedAt: new Date(Date.UTC(2020, 0, index + 1)),
				})),
			)
			.returning({ id: projectV2Items.id });
		await db.insert(projectV2ItemFieldValues).values(
			rows.flatMap((row, index) => [
				{ itemId: row.id, fieldId: points.id, valueNumber: 501 - index },
				{
					itemId: row.id,
					fieldId: due.id,
					valueDate: new Date(Date.UTC(2020, 0, index + 1))
						.toISOString()
						.slice(0, 10),
				},
			]),
		);
	});

	it("finds an exact title and field value beyond item 500", async () => {
		signIn(users.bob);
		for (const q of ["Task0501", "points:1", "due:2021-05-15"]) {
			const page = await getUserProject({
				data: { login: "alice", number, q, page: 1 },
			});
			expect(page.total).toBe(1);
			expect(page.items.map((row) => row.title)).toEqual(["Task0501"]);
			expect(page.itemCount).toBe(501);
		}
	});

	it("sorts all rows before selecting a page for title, updated, number and date", async () => {
		for (const [sort, dir] of [
			["title", "desc"],
			["updated", "desc"],
			["points", "asc"],
			["due", "desc"],
		] as const) {
			const first = await getUserProject({
				data: { login: "alice", number, page: 1, sort, dir },
			});
			const next = await getUserProject({
				data: { login: "alice", number, page: 2, sort, dir },
			});
			expect(first.items[0].title).toBe("Task0501");
			expect(next.items[0].title).toBe("Task0451");
			expect(first.pageCount).toBe(11);
			expect(first.items).toHaveLength(50);
		}
		const last = await getUserProject({
			data: { login: "alice", number, page: 11, sort: "title", dir: "desc" },
		});
		expect(last.items.map((row) => row.title)).toEqual(["Task0001"]);
	});

	it("uses the same field and kind qualifiers on GraphQL item reads", async () => {
		const result = await listProjectItems(projectId, users.bob.id, {
			query: "is:draft points:1",
			offset: 0,
			limit: 50,
		});
		expect(result.total).toBe(1);
		expect(result.items[0].draftTitle).toBe("Task0501");
	});

	it("sorts unset field values after set ones when descending", async () => {
		await db
			.insert(projectV2Items)
			.values({ projectId, draftTitle: "Task0999" });
		const last = await getUserProject({
			data: {
				login: "alice",
				number,
				sort: "points",
				dir: "desc",
				page: 11,
			},
		});
		expect(last.items.map((row) => row.title)).toEqual([
			"Task0501",
			"Task0999",
		]);
	});
});
