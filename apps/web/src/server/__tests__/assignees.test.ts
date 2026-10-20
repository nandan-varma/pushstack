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

const { createUsers, signIn, signOut } = await import("../../test/app-harness");
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
			data: { repoId, query: `assignee:${users.writer.username}` },
		});
		expect(mine.map((i) => i.number)).toEqual([issue.number]);
		expect(mine[0]?.assignees[0]?.user.username).toBe(users.writer.username);
		const none = await issues.getIssues({
			data: { repoId, query: "no:assignee" },
		});
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

	it("combines the assignee and label qualifiers", async () => {
		// Two conditions in one `AND`: with both present, neither filter may be
		// dropped (Drizzle 1.0 rejects an empty `AND` array, and the helper that
		// omits it must not swallow the conditions themselves).
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
				query: `assignee:${users.writer.username} label:"bug"`,
			},
		});
		expect(filtered.map((i) => i.number)).toEqual([both.number]);

		const none = await issues.getIssues({
			data: {
				repoId,
				query: `assignee:${users.writer.username} label:"question"`,
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

describe("shared thread assignments", () => {
	it("assigns at creation only for writers", async () => {
		signIn(users.owner);
		const created = await issues.createIssue({
			data: {
				repoId,
				title: "Assigned at creation",
				assignees: [users.writer.username, users.reader.username],
			},
		});
		const detail = await issues.getIssueByNumber({
			data: { owner: users.owner.username, name: "t", number: created.number },
		});
		expect(detail.assignees.map((a) => a.user.username)).toEqual([
			users.writer.username,
		]);
		signIn(users.author);
		const unassigned = await issues.createIssue({
			data: { repoId, title: "Participant", assignees: [users.owner.username] },
		});
		const participant = await issues.getIssueByNumber({
			data: {
				owner: users.owner.username,
				name: "t",
				number: unassigned.number,
			},
		});
		expect(participant.assignees).toEqual([]);
	});

	it("shares PR assignees, filters and events without issue id collisions", async () => {
		const { insertPullRequest } = await import("../pull-request-store");
		const pulls = await import("../pull-requests");
		const pr = await insertPullRequest(repoId, users.owner.id, {
			title: "Assigned PR",
			sourceBranch: "topic",
			targetBranch: "main",
		});
		signIn(users.reader);
		await expect(
			assignees.setPullRequestAssignees({
				data: { pullRequestId: pr.id, usernames: [users.writer.username] },
			}),
		).rejects.toThrow("No write access");
		signIn(users.owner);
		await assignees.setPullRequestAssignees({
			data: {
				pullRequestId: pr.id,
				usernames: [users.writer.username, users.reader.username],
			},
		});
		const filtered = await pulls.getPullRequests({
			data: { repoId, query: `assignee:${users.writer.username}` },
		});
		expect(filtered.map((row) => row.number)).toEqual([pr.number]);
		expect(filtered[0]?.assignees[0]?.user.username).toBe(
			users.writer.username,
		);
		expect(
			await pulls.getPullRequests({ data: { repoId, query: "no:assignee" } }),
		).toEqual([]);
		const detail = await pulls.getPullRequestByNumber({
			data: { owner: users.owner.username, name: "t", number: pr.number },
		});
		expect(detail.assignees.map((row) => row.user.username)).toEqual([
			users.writer.username,
		]);
		signIn(users.writer);
		expect(
			(await assignees.getAssignedThreads()).find(
				(thread) => thread.number === pr.number && thread.name === "t",
			),
		).toMatchObject({ kind: "pull_request", title: "Assigned PR" });
		signIn(users.owner);
		await assignees.setPullRequestAssignees({
			data: { pullRequestId: pr.id, usernames: [] },
		});
		expect(
			(await getTimeline({ data: { repoId, number: pr.number } })).map(
				(event) => event.event,
			),
		).toEqual(["assigned", "unassigned"]);
	});

	it("shows only open readable assignments and hides a private repo after access removal", async () => {
		signIn(users.owner);
		const privateRepo = await repositories.createRepository({
			data: { name: "private-assigned", visibility: "private" },
		});
		await repositories.addCollaboratorByUsername({
			data: {
				repoId: privateRepo.id,
				username: users.writer.username,
				role: "write",
			},
		});
		const issue = await issues.createIssue({
			data: {
				repoId: privateRepo.id,
				title: "Private assignment",
				assignees: [users.writer.username],
			},
		});
		signIn(users.writer);
		expect(
			(await assignees.getAssignedThreads()).some(
				(thread) => thread.name === privateRepo.name,
			),
		).toBe(true);
		signIn(users.owner);
		await issues.updateIssue({ data: { issueId: issue.id, status: "closed" } });
		signIn(users.writer);
		expect(
			(await assignees.getAssignedThreads()).some(
				(thread) => thread.name === privateRepo.name,
			),
		).toBe(false);
		signIn(users.owner);
		await issues.updateIssue({ data: { issueId: issue.id, status: "open" } });
		await repositories.removeCollaborator({
			data: { repoId: privateRepo.id, userId: users.writer.id },
		});
		signIn(users.writer);
		expect(
			(await assignees.getAssignedThreads()).some(
				(thread) => thread.name === privateRepo.name,
			),
		).toBe(false);
		signOut();
		await expect(assignees.getAssignedThreads()).rejects.toThrow();
	});
});

it("serializes concurrent replacements instead of combining assignment sets", async () => {
	signIn(users.owner);
	const issue = await issues.createIssue({
		data: { repoId, title: "Concurrent assignment" },
	});
	await Promise.all([
		assignees.setIssueAssignees({
			data: { issueId: issue.id, usernames: [users.owner.username] },
		}),
		assignees.setIssueAssignees({
			data: { issueId: issue.id, usernames: [users.writer.username] },
		}),
	]);
	const detail = await issues.getIssueByNumber({
		data: { owner: users.owner.username, name: "t", number: issue.number },
	});
	expect(detail.assignees).toHaveLength(1);
	const events = await getTimeline({ data: { repoId, number: issue.number } });
	expect(events.filter((event) => event.event === "assigned")).toHaveLength(2);
	expect(events.filter((event) => event.event === "unassigned")).toHaveLength(
		1,
	);
});

it("bounds the dashboard and orders latest assignments before limiting", async () => {
	const { db } = await import("#/db");
	const { issues: table, threadAssignees } = await import("#/db/app-schema");
	const rows = await db
		.insert(table)
		.values(
			Array.from({ length: 25 }, (_, i) => ({
				repoId,
				number: 10000 + i,
				authorId: users.owner.id,
				title: `Bounded ${i}`,
				updatedAt: new Date(Date.UTC(2030, 0, 1, 0, i)),
			})),
		)
		.returning();
	await db
		.insert(threadAssignees)
		.values(rows.map((row) => ({ issueId: row.id, userId: users.owner.id })));
	signIn(users.owner);
	const assigned = await assignees.getAssignedThreads();
	expect(assigned).toHaveLength(20);
	expect(assigned[0]?.title).toBe("Bounded 24");
	expect(assigned[19]?.title).toBe("Bounded 5");
});
