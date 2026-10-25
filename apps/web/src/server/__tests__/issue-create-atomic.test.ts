/**
 * @vitest-environment node
 *
 * Issue creation is all-or-nothing: when an assignee write fails after the
 * issue row exists, no half-made issue is left behind, so a retry does not
 * duplicate it.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

let failAssignees = false;

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));
vi.mock("@tanstack/react-start", () => import("../../test/server-test-utils"));
vi.mock(
	"#/server/session",
	async () => (await import("../../test/app-harness")).sessionModule,
);
vi.mock("../assignees-store", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../assignees-store")>();
	return {
		...actual,
		replaceThreadAssignees: (
			...args: Parameters<typeof actual.replaceThreadAssignees>
		) => {
			if (failAssignees) throw new Error("assignee write failed");
			return actual.replaceThreadAssignees(...args);
		},
	};
});

const { createUsers, signIn } = await import("../../test/app-harness");
const repositories = await import("../repositories");
const issues = await import("../issues");

const users = await createUsers("atomic-owner", "atomic-writer");
let repoId: number;

beforeAll(async () => {
	signIn(users["atomic-owner"]);
	repoId = (await repositories.createRepository({ data: { name: "atomic" } }))
		.id;
	await repositories.addCollaboratorByUsername({
		data: { repoId, username: users["atomic-writer"].username, role: "write" },
	});
});

describe("issue creation atomicity", () => {
	it("leaves no issue behind when assigning fails, and a retry creates exactly one", async () => {
		const count = async () =>
			(
				await issues.getIssues({
					data: { repoId, limit: 100, skip: 0, query: "is:all" },
				})
			).length;
		const before = await count();
		failAssignees = true;
		await expect(
			issues.createIssue({
				data: {
					repoId,
					title: "Retried",
					assignees: [users["atomic-writer"].username],
				},
			}),
		).rejects.toThrow("assignee write failed");
		expect(await count()).toBe(before);

		failAssignees = false;
		const created = await issues.createIssue({
			data: {
				repoId,
				title: "Retried",
				assignees: [users["atomic-writer"].username],
			},
		});
		expect(created.number).toBeGreaterThan(0);
		expect(await count()).toBe(before + 1);
	});
});
