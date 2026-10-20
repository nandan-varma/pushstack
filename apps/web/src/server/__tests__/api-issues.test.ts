/**
 * @vitest-environment node
 *
 * The GitHub-compatible REST API's issues surface (`/api/v3`), end to end: the
 * real dispatcher over real Postgres (pglite) and git-fs.ts's in-memory store.
 * Requests carry real personal access tokens; only the web session (used here
 * to mint tokens and seed commits) is faked.
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
const pulls = await import("../pull-requests");
const repositories = await import("../repositories");

const users = await createUsers("alice", "bob", "carol", "dave");
const { BASE, asToken, call, mintToken, patch, post } = await import(
	"../../test/api-client"
);

let alice: string;
let aliceRead: string;
let bob: string;
let carol: string;
let dave: string;
let repoId: number;

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	aliceRead = await mintToken(users.alice, ["repo:read"]);
	bob = await mintToken(users.bob, ["repo:write"]);
	carol = await mintToken(users.carol, ["repo:write"]);
	dave = await mintToken(users.dave, ["repo:write"]);

	const created = await call(
		"/user/repos",
		post(alice, { name: "proj", auto_init: true }),
	);
	expect(created.status).toBe(201);
	repoId = created.body.id;

	// bob reads, dave writes.
	signIn(users.alice);
	await repositories.addCollaboratorByUsername({
		data: { repoId, username: "bob", role: "read" },
	});
	await repositories.addCollaboratorByUsername({
		data: { repoId, username: "dave", role: "write" },
	});

	// Two branches, so a pull request can be opened from one into the other.
	signIn(users.alice);
	await files.uploadFile({
		data: {
			repoId,
			branchName: "main",
			path: "a.txt",
			content: btoa("a\n"),
			commitMessage: "Second",
		},
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

describe("creating issues", () => {
	it("creates an issue with labels and assignees, 201 with Location", async () => {
		const { status, headers, body } = await call(
			"/repos/alice/proj/issues",
			post(alice, {
				title: "Broken",
				body: "It broke",
				labels: ["bug", "question"],
				assignees: ["alice"],
			}),
		);
		expect(status).toBe(201);
		expect(headers.get("location")).toBe(
			`${BASE}/repos/alice/proj/issues/${body.number}`,
		);
		expect(body).toMatchObject({
			number: 1,
			state: "open",
			title: "Broken",
			body: "It broke",
			user: { login: "alice", type: "User" },
			labels: [
				{ name: "bug", color: "d73a4a", default: true },
				{ name: "question" },
			],
			assignees: [{ login: "alice" }],
			assignee: { login: "alice" },
			locked: false,
			comments: 0,
			milestone: null,
			closed_at: null,
			state_reason: null,
			url: `${BASE}/repos/alice/proj/issues/1`,
			repository_url: `${BASE}/repos/alice/proj`,
			html_url: "http://localhost:3000/repo/alice/proj/issues/1",
		});
		expect(body.created_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
		expect(body).not.toHaveProperty("pull_request");
	});

	it("422s a missing or invalid title", async () => {
		const missing = await call("/repos/alice/proj/issues", post(alice, {}));
		expect(missing.status).toBe(422);
		expect(missing.body).toMatchObject({
			message: "Validation Failed",
			errors: [{ resource: "Issue", field: "title", code: "missing_field" }],
		});
		const invalid = await call(
			"/repos/alice/proj/issues",
			post(alice, { title: "" }),
		);
		expect(invalid.status).toBe(422);
		expect(invalid.body.errors).toEqual([
			{ resource: "Issue", field: "title", code: "invalid" },
		]);
	});

	it("lets any signed-in reader open an issue on a public repository", async () => {
		const { status, body } = await call(
			"/repos/alice/proj/issues",
			post(carol, { title: "From carol" }),
		);
		expect(status).toBe(201);
		expect(body.user.login).toBe("carol");
		// As on GitHub, every write needs a write-scoped token, even one that
		// only needs participation (opening an issue, commenting).
		const readScoped = await call(
			"/repos/alice/proj/issues",
			post(aliceRead, { title: "From a read-scoped token" }),
		);
		expect(readScoped.status).toBe(403);
		const readScopedComment = await call(
			"/repos/alice/proj/issues/1/comments",
			post(aliceRead, { body: "From a read-scoped token" }),
		);
		expect(readScopedComment.status).toBe(403);
		const readScopedLabel = await call(
			"/repos/alice/proj/labels",
			post(aliceRead, { name: "read-scoped", color: "ffffff" }),
		);
		expect(readScopedLabel.status).toBe(403);
	});

	it("requires authentication", async () => {
		const anonymous = await call("/repos/alice/proj/issues", {
			method: "POST",
			body: JSON.stringify({ title: "Nope" }),
		});
		expect(anonymous.status).toBe(401);
		expect(anonymous.body.message).toBe("Requires authentication");
	});

	it("404s an unreadable repository, never 403", async () => {
		const { status } = await call(
			"/repos/alice/nope/issues",
			post(alice, { title: "x" }),
		);
		expect(status).toBe(404);
	});
});

describe("listing issues", () => {
	let openNumber: number;
	let closedNumber: number;

	beforeAll(async () => {
		const open = await call(
			"/repos/alice/proj/issues",
			post(alice, { title: "Open one", labels: ["enhancement"] }),
		);
		openNumber = open.body.number;
		const closed = await call(
			"/repos/alice/proj/issues",
			post(alice, { title: "Closed one" }),
		);
		closedNumber = closed.body.number;
		await call(
			`/repos/alice/proj/issues/${closedNumber}`,
			patch(alice, { state: "closed" }),
		);
	});

	it("lists open issues by default, anonymously", async () => {
		const { status, body } = await call("/repos/alice/proj/issues");
		expect(status).toBe(200);
		const numbers = body.map((issue: { number: number }) => issue.number);
		expect(numbers).toContain(openNumber);
		expect(numbers).not.toContain(closedNumber);
	});

	it("filters by state, labels, assignee and sorts", async () => {
		const closed = await call("/repos/alice/proj/issues?state=closed");
		expect(closed.body.map((i: { number: number }) => i.number)).toEqual([
			closedNumber,
		]);

		const all = await call("/repos/alice/proj/issues?state=all");
		expect(all.body.length).toBeGreaterThanOrEqual(2);

		const labeled = await call("/repos/alice/proj/issues?labels=enhancement");
		expect(labeled.body.map((i: { number: number }) => i.number)).toEqual([
			openNumber,
		]);

		const assigned = await call("/repos/alice/proj/issues?assignee=alice");
		expect(assigned.body.map((i: { title: string }) => i.title)).toEqual([
			"Broken",
		]);

		const none = await call("/repos/alice/proj/issues?assignee=none");
		expect(
			none.body.some((i: { assignees: unknown[] }) => i.assignees.length === 0),
		).toBe(true);

		const ascending = await call(
			"/repos/alice/proj/issues?state=all&sort=created&direction=asc",
		);
		const ascendingNumbers = ascending.body.map(
			(i: { number: number }) => i.number,
		);
		expect(ascendingNumbers).toEqual(
			[...ascendingNumbers].sort((a: number, b: number) => a - b),
		);

		const byComments = await call(
			"/repos/alice/proj/issues?state=all&sort=comments",
		);
		expect(byComments.status).toBe(200);
		expect(byComments.body.length).toBeGreaterThanOrEqual(2);

		// An invalid state is 422 with GitHub's `value` field; sort/direction fall back.
		const badState = await call("/repos/alice/proj/issues?state=bogus");
		expect(badState.status).toBe(422);
		expect(badState.body.errors).toEqual([
			{ resource: "Issue", field: "state", code: "invalid", value: "bogus" },
		]);
		expect(
			(await call("/repos/alice/proj/issues?sort=bogus&direction=nope")).status,
		).toBe(200);
	});

	it("paginates with a Link header", async () => {
		const { status, headers, body } = await call(
			"/repos/alice/proj/issues?state=all&per_page=1",
		);
		expect(status).toBe(200);
		expect(body).toHaveLength(1);
		const link = headers.get("link") ?? "";
		expect(link).toContain('rel="next"');
		expect(link).toContain('rel="last"');
		expect(link).not.toContain('rel="prev"');

		const last = await call(
			`/repos/alice/proj/issues?state=all&per_page=1&page=${body.length + 1}`,
		);
		expect(last.status).toBe(200);
	});

	it("returns both issues and pull requests, PRs carrying pull_request", async () => {
		signIn(users.alice);
		const pr = await pulls.createPullRequest({
			data: {
				repoId,
				title: "A pull request",
				body: "please review",
				sourceBranchName: "topic",
				targetBranchName: "main",
			},
		});
		const { body } = await call("/repos/alice/proj/issues");
		const pullRequest = body.find(
			(i: { number: number }) => i.number === pr.number,
		);
		expect(pullRequest).toMatchObject({
			number: pr.number,
			title: "A pull request",
			state: "open",
			html_url: `http://localhost:3000/repo/alice/proj/pulls/${pr.number}`,
			pull_request: {
				url: `${BASE}/repos/alice/proj/pulls/${pr.number}`,
				html_url: `http://localhost:3000/repo/alice/proj/pulls/${pr.number}`,
				merged_at: null,
			},
		});
		// A pull request is fetchable through the issues endpoint too.
		const one = await call(`/repos/alice/proj/issues/${pr.number}`);
		expect(one.status).toBe(200);
		expect(one.body).toHaveProperty("pull_request");
	});

	it("reports a merged pull request as closed, at its merge time", async () => {
		signIn(users.alice);
		await files.createBranch({ data: { repoId, name: "to-merge" } });
		await files.uploadFile({
			data: {
				repoId,
				branchName: "to-merge",
				path: "merged.txt",
				content: btoa("m\n"),
				commitMessage: "To merge",
			},
		});
		const pr = await pulls.createPullRequest({
			data: {
				repoId,
				title: "Merged",
				body: "",
				sourceBranchName: "to-merge",
				targetBranchName: "main",
			},
		});
		await pulls.mergePullRequest({ data: { prId: pr.id } });

		// GitHub's issues surface has no "merged" state: a merged pull request
		// is closed, and ?state=closed lists it.
		const closed = await call("/repos/alice/proj/issues?state=closed");
		expect(closed.body.map((i: { number: number }) => i.number)).toContain(
			pr.number,
		);
		const one = await call(`/repos/alice/proj/issues/${pr.number}`);
		expect(one.body.state).toBe("closed");
		expect(one.body.closed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(one.body.pull_request.merged_at).toBe(one.body.closed_at);
	});
});

describe("getting and updating an issue", () => {
	let number: number;

	beforeAll(async () => {
		const created = await call(
			"/repos/alice/proj/issues",
			post(alice, { title: "Editable", body: "before" }),
		);
		number = created.body.number;
	});

	it("returns one issue, 404 for a missing one", async () => {
		const { status, body } = await call(`/repos/alice/proj/issues/${number}`);
		expect(status).toBe(200);
		expect(body).toMatchObject({
			number,
			title: "Editable",
			body: "before",
			comments_url: `${BASE}/repos/alice/proj/issues/${number}/comments`,
		});
		expect((await call("/repos/alice/proj/issues/99999")).status).toBe(404);
		expect((await call("/repos/alice/proj/issues/abc")).status).toBe(404);
	});

	it("updates title, body, state, labels and assignees", async () => {
		const { status, body } = await call(
			`/repos/alice/proj/issues/${number}`,
			patch(alice, {
				title: "Edited",
				body: "after",
				state: "closed",
				labels: ["bug"],
				assignees: ["dave"],
			}),
		);
		expect(status).toBe(200);
		expect(body).toMatchObject({
			title: "Edited",
			body: "after",
			state: "closed",
			labels: [{ name: "bug" }],
			assignees: [{ login: "dave" }],
		});
		expect(body.closed_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);

		const reopened = await call(
			`/repos/alice/proj/issues/${number}`,
			patch(alice, { state: "open" }),
		);
		expect(reopened.body).toMatchObject({ state: "open", closed_at: null });
	});

	it("422s an invalid state and a bad body", async () => {
		const invalidState = await call(
			`/repos/alice/proj/issues/${number}`,
			patch(alice, { state: "merged" }),
		);
		expect(invalidState.status).toBe(422);
		expect(invalidState.body.errors).toEqual([
			{ resource: "Issue", field: "state", code: "invalid" },
		]);
		const badBody = await call(`/repos/alice/proj/issues/${number}`, {
			...asToken(alice),
			method: "PATCH",
			body: "{nope",
		});
		expect(badBody.status).toBe(400);
	});

	it("lets a writer edit another's issue but 403s a reader", async () => {
		const writer = await call(
			`/repos/alice/proj/issues/${number}`,
			patch(dave, { title: "By a writer" }),
		);
		expect(writer.status).toBe(200);
		const reader = await call(
			`/repos/alice/proj/issues/${number}`,
			patch(bob, { title: "By a reader" }),
		);
		expect(reader.status).toBe(403);
		const anonymous = await call(`/repos/alice/proj/issues/${number}`, {
			method: "PATCH",
			body: JSON.stringify({ title: "anon" }),
		});
		expect(anonymous.status).toBe(401);
	});
});

describe("issue comments", () => {
	let number: number;
	let commentId: number;

	beforeAll(async () => {
		const created = await call(
			"/repos/alice/proj/issues",
			post(alice, { title: "Talk" }),
		);
		number = created.body.number;
	});

	it("creates, lists and reads comments", async () => {
		const created = await call(
			`/repos/alice/proj/issues/${number}/comments`,
			post(carol, { body: "Me too" }),
		);
		expect(created.status).toBe(201);
		commentId = created.body.id;
		expect(created.body).toMatchObject({
			body: "Me too",
			user: { login: "carol" },
			issue_url: `${BASE}/repos/alice/proj/issues/${number}`,
			url: `${BASE}/repos/alice/proj/issues/comments/${commentId}`,
			html_url: `http://localhost:3000/repo/alice/proj/issues/${number}#issuecomment-${commentId}`,
		});

		const list = await call(`/repos/alice/proj/issues/${number}/comments`);
		expect(list.status).toBe(200);
		expect(list.body).toHaveLength(1);
		expect(list.body[0].id).toBe(commentId);
		expect(list.body[0].body).not.toContain("issuecomment");

		const single = await call(`/repos/alice/proj/issues/comments/${commentId}`);
		expect(single.status).toBe(200);
		expect(single.body.id).toBe(commentId);
	});

	it("counts comments on the issue", async () => {
		const { body } = await call(`/repos/alice/proj/issues/${number}`);
		expect(body.comments).toBe(1);
	});

	it("422s a missing body and requires authentication", async () => {
		const missing = await call(
			`/repos/alice/proj/issues/${number}/comments`,
			post(carol, {}),
		);
		expect(missing.status).toBe(422);
		expect(missing.body.errors).toEqual([
			{ resource: "IssueComment", field: "body", code: "missing_field" },
		]);
		const anonymous = await call(
			`/repos/alice/proj/issues/${number}/comments`,
			{ method: "POST", body: JSON.stringify({ body: "hi" }) },
		);
		expect(anonymous.status).toBe(401);
	});

	it("lets the author edit and delete; a writer moderates; a reader cannot", async () => {
		const edited = await call(
			`/repos/alice/proj/issues/comments/${commentId}`,
			patch(carol, { body: "Me too, edited" }),
		);
		expect(edited.status).toBe(200);
		expect(edited.body.body).toBe("Me too, edited");

		const reader = await call(
			`/repos/alice/proj/issues/comments/${commentId}`,
			patch(bob, { body: "moderated" }),
		);
		expect(reader.status).toBe(403);

		const writer = await call(
			`/repos/alice/proj/issues/comments/${commentId}`,
			patch(dave, { body: "moderated" }),
		);
		expect(writer.status).toBe(200);

		const readerDelete = await call(
			`/repos/alice/proj/issues/comments/${commentId}`,
			{ ...asToken(bob), method: "DELETE" },
		);
		expect(readerDelete.status).toBe(403);

		const deleted = await call(
			`/repos/alice/proj/issues/comments/${commentId}`,
			{ ...asToken(dave), method: "DELETE" },
		);
		expect(deleted.status).toBe(204);
		expect(deleted.body).toBeNull();
		const list = await call(`/repos/alice/proj/issues/${number}/comments`);
		expect(list.body).toEqual([]);
	});

	it("404s a comment of another repository or a missing one", async () => {
		expect((await call("/repos/alice/proj/issues/comments/99999")).status).toBe(
			404,
		);
		expect((await call("/repos/alice/proj/issues/99999/comments")).status).toBe(
			404,
		);
	});
});

describe("timeline and events", () => {
	let number: number;

	beforeAll(async () => {
		const created = await call(
			"/repos/alice/proj/issues",
			post(alice, { title: "History" }),
		);
		number = created.body.number;
		await call(
			`/repos/alice/proj/issues/${number}/comments`,
			post(alice, { body: "hello" }),
		);
		await call(
			`/repos/alice/proj/issues/${number}`,
			patch(alice, { labels: ["bug"] }),
		);
		await call(
			`/repos/alice/proj/issues/${number}`,
			patch(alice, { state: "closed" }),
		);
	});

	it("returns events and comments interleaved, oldest first", async () => {
		const { status, body } = await call(
			`/repos/alice/proj/issues/${number}/timeline`,
		);
		expect(status).toBe(200);
		const events = body.map((item: { event: string }) => item.event);
		expect(events).toContain("commented");
		expect(events).toContain("labeled");
		expect(events).toContain("closed");
		const times = body.map((item: { created_at: string }) =>
			Date.parse(item.created_at),
		);
		expect(times).toEqual([...times].sort((a: number, b: number) => a - b));

		const commented = body.find(
			(item: { event: string }) => item.event === "commented",
		);
		expect(commented).toMatchObject({
			body: "hello",
			user: { login: "alice" },
			actor: { login: "alice" },
		});
		const labeled = body.find(
			(item: { event: string }) => item.event === "labeled",
		);
		expect(labeled.label).toEqual({ name: "bug", color: "d73a4a" });
		expect(labeled.actor).toMatchObject({ login: "alice" });
		const closed = body.find(
			(item: { event: string }) => item.event === "closed",
		);
		expect(closed).toMatchObject({ state_reason: null });
	});

	it("returns only events from /events", async () => {
		const { status, body } = await call(
			`/repos/alice/proj/issues/${number}/events`,
		);
		expect(status).toBe(200);
		const events = body.map((item: { event: string }) => item.event);
		expect(events).not.toContain("commented");
		expect(events).toContain("labeled");
		expect(body[0]).toHaveProperty("created_at");
		expect(body[0]).toHaveProperty("actor");
	});

	it("404s a timeline of a missing thread", async () => {
		expect((await call("/repos/alice/proj/issues/99999/timeline")).status).toBe(
			404,
		);
		expect((await call("/repos/alice/proj/issues/99999/events")).status).toBe(
			404,
		);
	});
});

describe("repository labels", () => {
	it("lists the default labels with GitHub's shape", async () => {
		const { status, body } = await call("/repos/alice/proj/labels");
		expect(status).toBe(200);
		const bug = body.find((l: { name: string }) => l.name === "bug");
		expect(bug).toMatchObject({
			name: "bug",
			color: "d73a4a",
			default: true,
			description: "Something isn't working",
			url: `${BASE}/repos/alice/proj/labels/bug`,
		});
		expect(bug).toHaveProperty("id");
	});

	it("creates, reads, updates and deletes a label", async () => {
		const created = await call(
			"/repos/alice/proj/labels",
			post(dave, { name: "P0", color: "#FF0000", description: "urgent" }),
		);
		expect(created.status).toBe(201);
		expect(created.body).toMatchObject({
			name: "P0",
			color: "ff0000",
			description: "urgent",
			default: false,
		});

		const duplicate = await call(
			"/repos/alice/proj/labels",
			post(dave, { name: "p0", color: "00ff00" }),
		);
		expect(duplicate.status).toBe(422);
		expect(duplicate.body.errors).toEqual([
			{ resource: "Label", field: "name", code: "already_exists" },
		]);

		// The color is optional, as on GitHub.
		const noColor = await call(
			"/repos/alice/proj/labels",
			post(dave, { name: "no-color" }),
		);
		expect(noColor.status).toBe(201);
		expect(noColor.body.color).toBe("ededed");

		const fetched = await call("/repos/alice/proj/labels/P0");
		expect(fetched.status).toBe(200);
		expect(fetched.body.name).toBe("P0");

		const updated = await call(
			"/repos/alice/proj/labels/P0",
			patch(dave, { new_name: "priority", color: "00ff00" }),
		);
		expect(updated.status).toBe(200);
		expect(updated.body).toMatchObject({ name: "priority", color: "00ff00" });
		expect((await call("/repos/alice/proj/labels/P0")).status).toBe(404);

		const renamedDuplicate = await call(
			"/repos/alice/proj/labels/priority",
			patch(dave, { new_name: "bug" }),
		);
		expect(renamedDuplicate.status).toBe(422);

		const deleted = await call("/repos/alice/proj/labels/priority", {
			...asToken(dave),
			method: "DELETE",
		});
		expect(deleted.status).toBe(204);
		expect((await call("/repos/alice/proj/labels/priority")).status).toBe(404);
		expect((await call("/repos/alice/proj/labels/missing")).status).toBe(404);
	});

	it("needs write access: 403 for a reader, 401 anonymous", async () => {
		const reader = await call(
			"/repos/alice/proj/labels",
			post(bob, { name: "mine", color: "000000" }),
		);
		expect(reader.status).toBe(403);
		const anonymous = await call("/repos/alice/proj/labels", {
			method: "POST",
			body: JSON.stringify({ name: "anon", color: "000000" }),
		});
		expect(anonymous.status).toBe(401);
		expect(
			(
				await call("/repos/alice/proj/labels/bug", {
					method: "DELETE",
				})
			).status,
		).toBe(401);
	});
});

describe("issue labels", () => {
	let number: number;

	beforeAll(async () => {
		const created = await call(
			"/repos/alice/proj/issues",
			post(alice, { title: "Label me" }),
		);
		number = created.body.number;
	});

	it("sets, adds and lists labels; removes one and all", async () => {
		const set = await call(`/repos/alice/proj/issues/${number}/labels`, {
			...asToken(dave),
			method: "PUT",
			body: JSON.stringify({ labels: ["bug", "question"] }),
		});
		expect(set.status).toBe(200);
		expect(set.body.map((l: { name: string }) => l.name)).toEqual([
			"bug",
			"question",
		]);

		const listed = await call(`/repos/alice/proj/issues/${number}/labels`);
		expect(listed.status).toBe(200);
		expect(listed.body.map((l: { name: string }) => l.name)).toEqual([
			"bug",
			"question",
		]);

		const added = await call(`/repos/alice/proj/issues/${number}/labels`, {
			...asToken(dave),
			method: "POST",
			body: JSON.stringify({ labels: ["enhancement"] }),
		});
		expect(added.status).toBe(200);
		expect(added.body.map((l: { name: string }) => l.name)).toEqual([
			"bug",
			"enhancement",
			"question",
		]);

		const removed = await call(
			`/repos/alice/proj/issues/${number}/labels/bug`,
			{ ...asToken(dave), method: "DELETE" },
		);
		expect(removed.status).toBe(200);
		expect(removed.body.map((l: { name: string }) => l.name)).toEqual([
			"enhancement",
			"question",
		]);

		const cleared = await call(`/repos/alice/proj/issues/${number}/labels`, {
			...asToken(dave),
			method: "DELETE",
		});
		expect(cleared.status).toBe(204);
		expect(
			(await call(`/repos/alice/proj/issues/${number}/labels`)).body,
		).toEqual([]);
	});

	it("422s an unknown label", async () => {
		const { status, body } = await call(
			`/repos/alice/proj/issues/${number}/labels`,
			{
				...asToken(dave),
				method: "PUT",
				body: JSON.stringify({ labels: ["nope"] }),
			},
		);
		expect(status).toBe(422);
		expect(body.errors[0]).toMatchObject({
			resource: "Label",
			field: "name",
			code: "custom",
		});
	});

	it("needs write access and an existing thread", async () => {
		const reader = await call(`/repos/alice/proj/issues/${number}/labels`, {
			...asToken(bob),
			method: "PUT",
			body: JSON.stringify({ labels: ["bug"] }),
		});
		expect(reader.status).toBe(403);
		const missing = await call("/repos/alice/proj/issues/99999/labels");
		expect(missing.status).toBe(404);
	});
});
