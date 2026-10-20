/**
 * @vitest-environment node
 *
 * Issue assignees: only users with write access are assignable, events are
 * recorded, and the list filters by assignee.
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

const { createUsers, signIn } = await import("../../test/app-harness");
const repositories = await import("../repositories");
const issues = await import("../issues");
const assignees = await import("../assignees");
const labelFns = await import("../labels");
const { getTimeline } = await import("../timeline");

const users = await createUsers("owner", "writer", "reader", "author");
let repoId: number;

beforeAll(async () => {
	signIn(users.owner);
	repoId = (await repositories.createRepository({ data: { name: "t" } })).id;
	await repositories.addCollaboratorByUsername({
		data: { repoId, username: users.writer.username, role: "write" },
	});
	await repositories.addCollaboratorByUsername({
		data: { repoId, username: users.reader.username, role: "read" },
	});
});

describe("assignees", () => {
	it("lists only the owner and write collaborators as assignable", async () => {
		const list = await assignees.getAssignableUsers({ data: { repoId } });
		expect(list.map((u) => u.username).sort()).toEqual(
			[users.owner.username, users.writer.username].sort(),
		);
	});

	it("assigns, ignores ineligible users, records events and filters", async () => {
		signIn(users.author);
		const issue = await issues.createIssue({ data: { repoId, title: "A" } });
		const other = await issues.createIssue({ data: { repoId, title: "B" } });
		signIn(users.owner);
		const set = await assignees.setIssueAssignees({
			data: {
				issueId: issue.id,
				usernames: [users.writer.username, users.reader.username],
			},
		});
		expect(set.map((u) => u.username)).toEqual([users.writer.username]);

		const mine = await issues.getIssues({
			data: { repoId, assignee: users.writer.username },
		});
		expect(mine.map((i) => i.number)).toEqual([issue.number]);
		expect(mine[0]?.assignees[0]?.user.username).toBe(users.writer.username);
		const none = await issues.getIssues({ data: { repoId, assignee: "none" } });
		expect(none.map((i) => i.number)).toEqual([other.number]);

		await assignees.setIssueAssignees({
			data: { issueId: issue.id, usernames: [] },
		});
		const events = await getTimeline({
			data: { repoId, number: issue.number },
		});
		expect(events.map((e) => e.event)).toEqual(["assigned", "unassigned"]);
		expect(events[0]).toMatchObject({
			assignee: { username: users.writer.username },
		});
	});

	it("combines the assignee and label filters", async () => {
		// Two conditions in one `AND`: a list query whose filters are all
		// optional must omit the key when none apply (Drizzle 1.0 rejects an
		// empty `AND` array) and must keep both when they do.
		signIn(users.author);
		const both = await issues.createIssue({
			data: { repoId, title: "Both", labels: [] },
		});
		const labelled = await issues.createIssue({
			data: { repoId, title: "Labelled only" },
		});
		signIn(users.owner);
		await assignees.setIssueAssignees({
			data: { issueId: both.id, usernames: [users.writer.username] },
		});
		await labelFns.setLabels({
			data: { repoId, number: both.number, labels: ["bug"] },
		});
		await labelFns.setLabels({
			data: { repoId, number: labelled.number, labels: ["bug"] },
		});

		const filtered = await issues.getIssues({
			data: {
				repoId,
				assignee: users.writer.username,
				labels: ["bug"],
			},
		});
		expect(filtered.map((i) => i.number)).toEqual([both.number]);

		// A label the issue does not carry, with the same assignee: no rows.
		const none = await issues.getIssues({
			data: {
				repoId,
				assignee: users.writer.username,
				labels: ["question"],
			},
		});
		expect(none).toEqual([]);
	});

	it("needs write access to assign", async () => {
		signIn(users.author);
		const issue = await issues.createIssue({ data: { repoId, title: "C" } });
		await expect(
			assignees.setIssueAssignees({
				data: { issueId: issue.id, usernames: [users.owner.username] },
			}),
		).rejects.toThrow("No write access");
	});
});
