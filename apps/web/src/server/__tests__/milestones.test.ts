/**
 * @vitest-environment node
 *
 * Milestones end to end: the REST CRUD (`/api/v3/repos/{o}/{r}/milestones`),
 * the `milestone` field on issues and pull requests (create, update, list
 * filter), open and closed counts, `milestoned`/`demilestoned` timeline events,
 * permissions, and the web server functions and search qualifiers.
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
const files = await import("../files");
const issues = await import("../issues");
const milestoneFns = await import("../milestones");
const pulls = await import("../pull-requests");
const repositories = await import("../repositories");
const { getTimeline } = await import("../timeline");
const { BASE, asToken, call, mintToken, patch, post } = await import(
	"../../test/api-client"
);

const del = (token: string) => ({ ...asToken(token), method: "DELETE" });

const users = await createUsers("alice", "bob", "carol");
let alice: string;
let bob: string;
let carol: string;
let repoId: number;

const eventNames = async (number: number) =>
	(await getTimeline({ data: { repoId, number } }))
		.filter((e) => e.event === "milestoned" || e.event === "demilestoned")
		.map((e) => ({
			event: e.event,
			title: "milestone" in e ? e.milestone.title : undefined,
		}));

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	bob = await mintToken(users.bob, ["repo:write"]);
	carol = await mintToken(users.carol, ["repo:write"]);
	const created = await call(
		"/user/repos",
		post(alice, { name: "proj", auto_init: true }),
	);
	repoId = created.body.id;
	signIn(users.alice);
	await repositories.addCollaboratorByUsername({
		data: { repoId, username: "bob", role: "read" },
	});
	await files.createBranch({ data: { repoId, name: "topic" } });
	await files.uploadFile({
		data: {
			repoId,
			branchName: "topic",
			path: "b.txt",
			content: btoa("b\n"),
			commitMessage: "Topic",
		},
	});
});

describe("milestone CRUD", () => {
	it("creates, reads, lists, updates and deletes", async () => {
		const created = await call(
			"/repos/alice/proj/milestones",
			post(alice, {
				title: "v1",
				description: "First release",
				due_on: "2030-01-31T00:00:00Z",
			}),
		);
		expect(created.status).toBe(201);
		expect(created.body).toMatchObject({
			number: 1,
			title: "v1",
			state: "open",
			description: "First release",
			creator: { login: "alice" },
			open_issues: 0,
			closed_issues: 0,
			closed_at: null,
			due_on: "2030-01-31T00:00:00Z",
			url: `${BASE}/repos/alice/proj/milestones/1`,
			html_url: "http://localhost:3000/alice/proj/milestone/1",
		});

		const duplicate = await call(
			"/repos/alice/proj/milestones",
			post(alice, { title: "V1" }),
		);
		expect(duplicate.status).toBe(422);
		expect(duplicate.body.errors).toEqual([
			{ resource: "Milestone", field: "title", code: "already_exists" },
		]);

		const second = await call(
			"/repos/alice/proj/milestones",
			post(alice, { title: "v2", state: "closed" }),
		);
		expect(second.body).toMatchObject({ number: 2, state: "closed" });
		expect(second.body.closed_at).not.toBeNull();

		const open = await call("/repos/alice/proj/milestones");
		expect(open.body.map((m: { title: string }) => m.title)).toEqual(["v1"]);
		const all = await call("/repos/alice/proj/milestones?state=all");
		expect(all.body.map((m: { title: string }) => m.title)).toEqual([
			"v1",
			"v2",
		]);

		const got = await call("/repos/alice/proj/milestones/1");
		expect(got.body.title).toBe("v1");
		expect((await call("/repos/alice/proj/milestones/9")).status).toBe(404);

		const updated = await call(
			"/repos/alice/proj/milestones/2",
			patch(alice, { state: "open", due_on: null, title: "v2.0" }),
		);
		expect(updated.body).toMatchObject({
			title: "v2.0",
			state: "open",
			closed_at: null,
			due_on: null,
		});

		const removed = await call("/repos/alice/proj/milestones/2", del(alice));
		expect(removed.status).toBe(204);
		expect((await call("/repos/alice/proj/milestones/2")).status).toBe(404);
		// Numbers are never reused.
		const third = await call(
			"/repos/alice/proj/milestones",
			post(alice, { title: "v3" }),
		);
		expect(third.body.number).toBe(3);
	});

	it("sorts by due date (undated last) and by completeness", async () => {
		await call(
			"/repos/alice/proj/milestones",
			post(alice, { title: "later", due_on: "2031-01-01T00:00:00Z" }),
		);
		await call(
			"/repos/alice/proj/milestones",
			post(alice, { title: "sooner", due_on: "2029-01-01T00:00:00Z" }),
		);
		const byDue = await call("/repos/alice/proj/milestones");
		expect(byDue.body.map((m: { title: string }) => m.title)).toEqual([
			"sooner",
			"v1",
			"later",
			"v3",
		]);
		const desc = await call("/repos/alice/proj/milestones?direction=desc");
		expect(
			desc.body.map((m: { title: string }) => m.title).slice(0, 3),
		).toEqual(["later", "v1", "sooner"]);
		const byDone = await call(
			"/repos/alice/proj/milestones?sort=completeness&direction=desc",
		);
		expect(byDone.status).toBe(200);
	});

	it("needs write access to change milestones, not to read them", async () => {
		const read = await call(
			"/repos/alice/proj/milestones",
			post(bob, { title: "nope" }),
		);
		expect(read.status).toBe(403);
		const stranger = await call(
			"/repos/alice/proj/milestones/1",
			patch(carol, { title: "nope" }),
		);
		expect(stranger.status).toBe(403);
		expect(
			(await call("/repos/alice/proj/milestones/1", del(bob))).status,
		).toBe(403);
		const anonymous = await call("/repos/alice/proj/milestones/1");
		expect(anonymous.status).toBe(200);
		const invalid = await call(
			"/repos/alice/proj/milestones",
			post(alice, { due_on: "tomorrow", title: "x" }),
		);
		expect(invalid.status).toBe(422);
		expect(
			(await call("/repos/alice/proj/milestones", post(alice, {}))).status,
		).toBe(422);
	});
});

describe("milestones on issues and pull requests", () => {
	let issueNumber: number;
	let prNumber: number;

	it("sets the milestone on create and update, with events and counts", async () => {
		const created = await call(
			"/repos/alice/proj/issues",
			post(alice, { title: "Tracked", milestone: 1 }),
		);
		expect(created.status).toBe(201);
		issueNumber = created.body.number;
		expect(created.body.milestone).toMatchObject({
			number: 1,
			title: "v1",
			open_issues: 1,
			closed_issues: 0,
		});

		const pr = await call(
			"/repos/alice/proj/pulls",
			post(alice, { title: "Add b", head: "topic", base: "main" }),
		);
		prNumber = pr.body.number;
		// A pull request takes its milestone through the issues endpoint.
		const set = await call(
			`/repos/alice/proj/issues/${prNumber}`,
			patch(alice, { milestone: "1" }),
		);
		expect(set.body.milestone.number).toBe(1);
		expect(set.body.milestone.open_issues).toBe(2);
		const pull = await call(`/repos/alice/proj/pulls/${prNumber}`);
		expect(pull.body.milestone).toMatchObject({ number: 1, title: "v1" });
		const pullList = await call("/repos/alice/proj/pulls");
		expect(pullList.body[0].milestone.number).toBe(1);

		const closed = await call(
			`/repos/alice/proj/issues/${issueNumber}`,
			patch(alice, { state: "closed" }),
		);
		expect(closed.body.milestone).toMatchObject({
			open_issues: 1,
			closed_issues: 1,
		});
		expect(await eventNames(issueNumber)).toEqual([
			{ event: "milestoned", title: "v1" },
		]);
		const events = await call(`/repos/alice/proj/issues/${issueNumber}/events`);
		expect(events.body.map((e: { event: string }) => e.event)).toContain(
			"milestoned",
		);
		expect(
			events.body.find((e: { event: string }) => e.event === "milestoned")
				.milestone,
		).toEqual({ title: "v1" });
	});

	it("moves and clears the milestone, recording demilestoned then milestoned", async () => {
		await call(
			`/repos/alice/proj/issues/${issueNumber}`,
			patch(alice, { milestone: 3 }),
		);
		expect(await eventNames(issueNumber)).toEqual([
			{ event: "milestoned", title: "v1" },
			{ event: "demilestoned", title: "v1" },
			{ event: "milestoned", title: "v3" },
		]);
		// Setting the same milestone again records nothing.
		await call(
			`/repos/alice/proj/issues/${issueNumber}`,
			patch(alice, { milestone: 3 }),
		);
		expect(await eventNames(issueNumber)).toHaveLength(3);
		const cleared = await call(
			`/repos/alice/proj/issues/${issueNumber}`,
			patch(alice, { milestone: null }),
		);
		expect(cleared.body.milestone).toBeNull();
		expect((await eventNames(issueNumber)).at(-1)).toEqual({
			event: "demilestoned",
			title: "v3",
		});
	});

	it("422s an unknown milestone and ignores it from non-writers", async () => {
		const unknown = await call(
			`/repos/alice/proj/issues/${issueNumber}`,
			patch(alice, { milestone: 99 }),
		);
		expect(unknown.status).toBe(422);
		expect(unknown.body.errors).toEqual([
			{ resource: "Issue", field: "milestone", code: "invalid" },
		]);
		const create = await call(
			"/repos/alice/proj/issues",
			post(alice, { title: "Bad", milestone: 99 }),
		);
		expect(create.status).toBe(422);
		const byReader = await call(
			"/repos/alice/proj/issues",
			post(carol, { title: "Carol's", milestone: 1 }),
		);
		expect(byReader.status).toBe(201);
		expect(byReader.body.milestone).toBeNull();
	});

	it("filters the issue list by milestone number, none and *", async () => {
		await call(
			`/repos/alice/proj/issues/${issueNumber}`,
			patch(alice, { milestone: 1 }),
		);
		const numbers = async (query: string) =>
			(await call(`/repos/alice/proj/issues?state=all&${query}`)).body.map(
				(i: { number: number }) => i.number,
			);
		expect(await numbers("milestone=1")).toEqual(
			expect.arrayContaining([issueNumber, prNumber]),
		);
		expect(await numbers("milestone=1")).toHaveLength(2);
		expect(await numbers("milestone=3")).toEqual([]);
		expect(await numbers("milestone=*")).toHaveLength(2);
		const none = await numbers("milestone=none");
		expect(none).not.toContain(issueNumber);
		expect(none.length).toBeGreaterThan(0);
	});

	it("deleting a milestone clears it from its threads", async () => {
		const extra = await call(
			"/repos/alice/proj/milestones",
			post(alice, { title: "temp" }),
		);
		const issue = await call(
			"/repos/alice/proj/issues",
			post(alice, { title: "Temp", milestone: extra.body.number }),
		);
		await call(`/repos/alice/proj/milestones/${extra.body.number}`, del(alice));
		const after = await call(`/repos/alice/proj/issues/${issue.body.number}`);
		expect(after.body.milestone).toBeNull();
	});
});

describe("web milestones", () => {
	it("lists with counts, pages threads and edits through server functions", async () => {
		signIn(users.alice);
		const page = await milestoneFns.getMilestones({
			data: { repoId, state: "open" },
		});
		expect(page.counts.open).toBeGreaterThanOrEqual(1);
		expect(page.viewer.canWrite).toBe(true);
		const v1 = page.milestones.find((m) => m.title === "v1");
		expect(v1?.openIssues).toBe(1);
		expect(v1?.closedIssues).toBe(1);

		const threads = await milestoneFns.getMilestoneThreads({
			data: { repoId, number: 1, state: "open" },
		});
		expect(threads.map((t) => t.kind)).toEqual(["pull_request"]);

		const made = await milestoneFns.createMilestone({
			data: { repoId, title: "web", dueOn: new Date("2032-05-05") },
		});
		await expect(
			milestoneFns.createMilestone({ data: { repoId, title: "WEB" } }),
		).rejects.toThrow(/already exists/);
		const edited = await milestoneFns.updateMilestone({
			data: { repoId, number: made.number, state: "closed", title: "web2" },
		});
		expect(edited).toMatchObject({ title: "web2", state: "closed" });
		await milestoneFns.setThreadMilestone({
			data: { repoId, number: 1, milestone: made.number },
		});
		await milestoneFns.deleteMilestone({
			data: { repoId, number: made.number },
		});
		await expect(
			milestoneFns.getMilestoneByNumber({
				data: { repoId, number: made.number },
			}),
		).rejects.toBeDefined();
	});

	it("rejects web writes without write access", async () => {
		signIn(users.carol);
		await expect(
			milestoneFns.createMilestone({ data: { repoId, title: "nope" } }),
		).rejects.toThrow();
		await expect(
			milestoneFns.setThreadMilestone({
				data: { repoId, number: 1, milestone: 1 },
			}),
		).rejects.toThrow();
	});

	it("searches with milestone: and no:milestone", async () => {
		signIn(users.alice);
		const tracked = await issues.createIssue({
			data: { repoId, title: "Searchable" },
		});
		await milestoneFns.setThreadMilestone({
			data: { repoId, number: tracked.number, milestone: 1 },
		});
		const list = async (query: string) =>
			(
				await issues.getIssues({ data: { repoId, query: `is:all ${query}` } })
			).map((i) => i.number);
		expect(await list('milestone:"V1"')).toContain(tracked.number);
		expect(await list("no:milestone")).not.toContain(tracked.number);
		expect(await list('milestone:"nothing"')).toEqual([]);
		const prs = await pulls.getPullRequests({
			data: { repoId, query: "is:all milestone:v1" },
		});
		expect(prs).toHaveLength(1);
	});
});
