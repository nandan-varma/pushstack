/**
 * @vitest-environment node
 *
 * The notifications REST API (`/notifications`, `/repos/{o}/{r}/notifications`,
 * `/notifications/threads/{id}[/subscription]`) end to end over pglite.
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
const users = await createUsers("alice", "bob", "carol");
const { BASE, asToken, call, mintToken, post } = await import(
	"../../test/api-client"
);

let alice: string;
let bob: string;
let carol: string;

const put = (token: string, body?: unknown) => ({
	...asToken(token),
	method: "PUT",
	...(body !== undefined && { body: JSON.stringify(body) }),
});

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	bob = await mintToken(users.bob, ["repo:write"]);
	carol = await mintToken(users.carol, ["repo:read"]);
	await call("/user/repos", post(alice, { name: "proj", auto_init: true }));
	await call("/user/repos", post(alice, { name: "other", auto_init: true }));
	// Bob opens issues; alice comments (bob, the author, is notified), and
	// mentions him on another repository.
	for (const title of ["First", "Second"]) {
		await call("/repos/alice/proj/issues", post(bob, { title }));
	}
	await call(
		"/repos/alice/proj/issues/1/comments",
		post(alice, { body: "On it" }),
	);
	await call(
		"/repos/alice/proj/issues/2/comments",
		post(alice, { body: "Hmm" }),
	);
	await call(
		"/repos/alice/other/issues",
		post(alice, { title: "Ping", body: "@bob look" }),
	);
});

describe("listing", () => {
	it("lists the caller's unread threads, newest first, in GitHub's shape", async () => {
		const { status, body } = await call("/notifications", asToken(bob));
		expect(status).toBe(200);
		expect(
			body.map((t: { subject: { title: string } }) => t.subject.title),
		).toEqual(["Ping", "Second", "First"]);
		const [ping, second] = body;
		expect(ping).toMatchObject({
			id: expect.stringMatching(/^\d+$/),
			reason: "mention",
			unread: true,
			last_read_at: null,
			repository: { full_name: "alice/other", open_issues_count: 1 },
			subject: {
				type: "Issue",
				url: `${BASE}/repos/alice/other/issues/1`,
				latest_comment_url: `${BASE}/repos/alice/other/issues/1`,
			},
			url: `${BASE}/notifications/threads/${ping.id}`,
			subscription_url: `${BASE}/notifications/threads/${ping.id}/subscription`,
		});
		expect(second.reason).toBe("author");
		expect(second.repository.open_issues_count).toBe(2);
		expect(second.subject.latest_comment_url).toMatch(
			/\/repos\/alice\/proj\/issues\/comments\/\d+$/,
		);
	});

	it("filters by repository, time and page", async () => {
		const repo = await call("/repos/alice/proj/notifications", asToken(bob));
		expect(repo.body).toHaveLength(2);
		const at = (query: string) => call(`/notifications?${query}`, asToken(bob));
		expect((await at("before=2999-01-01T00:00:00Z")).body).toHaveLength(3);
		expect((await at("before=2000-01-01T00:00:00Z")).body).toHaveLength(0);
		expect((await at("since=2000-01-01T00:00:00Z")).body).toHaveLength(3);
		expect((await at("since=2999-01-01T00:00:00Z")).body).toHaveLength(0);
		const paged = await call("/notifications?per_page=1&page=2", asToken(bob));
		expect(paged.body).toHaveLength(1);
		expect(paged.body[0].subject.title).toBe("Second");
		expect(paged.headers.get("link")).toContain('rel="last"');
		expect(
			(await call("/notifications?since=yesterday", asToken(bob))).status,
		).toBe(422);
	});

	it("needs authentication and hides other users' threads", async () => {
		expect((await call("/notifications")).status).toBe(401);
		expect((await call("/notifications", asToken(carol))).body).toEqual([]);
		const [thread] = (await call("/notifications", asToken(bob))).body;
		expect(
			(await call(`/notifications/threads/${thread.id}`, asToken(carol)))
				.status,
		).toBe(404);
		expect(
			(await call(`/notifications/threads/${thread.id}`, asToken(bob))).body.id,
		).toBe(thread.id);
	});
});

describe("marking read and done", () => {
	it("marks one thread read (205), then all of a repository's, then all", async () => {
		const threads = (await call("/notifications", asToken(bob))).body;
		const ping = threads[0];
		const read = await call(`/notifications/threads/${ping.id}`, {
			...asToken(bob),
			method: "PATCH",
		});
		expect(read.status).toBe(205);
		const after = await call(`/notifications/threads/${ping.id}`, asToken(bob));
		expect(after.body.unread).toBe(false);
		expect(after.body.last_read_at).not.toBeNull();
		expect((await call("/notifications", asToken(bob))).body).toHaveLength(2);
		expect(
			(await call("/notifications?all=true", asToken(bob))).body,
		).toHaveLength(3);

		expect(
			(await call("/repos/alice/proj/notifications", put(bob, {}))).status,
		).toBe(205);
		expect((await call("/notifications", asToken(bob))).body).toEqual([]);

		// New activity brings a thread back as unread.
		await call(
			"/repos/alice/proj/issues/1/comments",
			post(alice, { body: "Done" }),
		);
		const back = (await call("/notifications", asToken(bob))).body;
		expect(
			back.map((t: { subject: { title: string } }) => t.subject.title),
		).toEqual(["First"]);
		// last_read_at in the past leaves newer ones unread.
		expect(
			(
				await call(
					"/notifications",
					put(bob, { last_read_at: "2000-01-01T00:00:00Z" }),
				)
			).status,
		).toBe(205);
		expect((await call("/notifications", asToken(bob))).body).toHaveLength(1);
		expect((await call("/notifications", put(bob))).status).toBe(205);
		expect((await call("/notifications", asToken(bob))).body).toEqual([]);
	});

	it("marks a thread done: gone until new activity", async () => {
		const [thread] = (await call("/notifications?all=true", asToken(bob))).body;
		const done = await call(`/notifications/threads/${thread.id}`, {
			...asToken(bob),
			method: "DELETE",
		});
		expect(done.status).toBe(204);
		expect(
			(await call(`/notifications/threads/${thread.id}`, asToken(bob))).status,
		).toBe(404);
	});
});

describe("thread subscriptions", () => {
	it("reads, ignores, resubscribes and deletes a subscription", async () => {
		const [thread] = (await call("/notifications?all=true", asToken(bob))).body;
		const url = `/notifications/threads/${thread.id}/subscription`;
		const current = await call(url, asToken(bob));
		expect(current.status).toBe(200);
		expect(current.body).toMatchObject({
			subscribed: true,
			ignored: false,
			reason: null,
			url: `${BASE}${url}`,
			thread_url: `${BASE}/notifications/threads/${thread.id}`,
		});
		const ignored = await call(url, put(bob, { ignored: true }));
		expect(ignored.body).toMatchObject({ subscribed: false, ignored: true });
		// Muted: alice's next comment doesn't notify bob.
		const issueNumber = Number(thread.subject.url.split("/").pop());
		const repoName = thread.repository.name;
		await call(`/notifications`, put(bob));
		await call(
			`/repos/alice/${repoName}/issues/${issueNumber}/comments`,
			post(alice, { body: "Still there?" }),
		);
		expect((await call("/notifications", asToken(bob))).body).toEqual([]);

		expect((await call(url, put(bob, {}))).body.subscribed).toBe(true);
		const removed = await call(url, { ...asToken(bob), method: "DELETE" });
		expect(removed.status).toBe(204);
		// Forgotten, not muted: 404, and being mentioned subscribes again.
		expect((await call(url, asToken(bob))).status).toBe(404);
		await call(
			`/repos/alice/${repoName}/issues/${issueNumber}/comments`,
			post(alice, { body: "@bob ping" }),
		);
		expect((await call(url, asToken(bob))).body.subscribed).toBe(true);
	});
});

describe("lost access", () => {
	it("hides a private repository's threads once access is gone", async () => {
		const { default: repositories } = await import("../repositories").then(
			(module) => ({ default: module }),
		);
		const { signIn } = await import("../../test/app-harness");
		const created = await call(
			"/user/repos",
			post(alice, { name: "secret", private: true, auto_init: true }),
		);
		signIn(users.alice);
		await repositories.addCollaboratorByUsername({
			data: { repoId: created.body.id, username: "carol", role: "read" },
		});
		await call(
			"/repos/alice/secret/issues",
			post(alice, { title: "Psst", body: "@carol" }),
		);
		const [thread] = (await call("/notifications", asToken(carol))).body;
		expect(thread.subject.title).toBe("Psst");
		const threadPath = `/notifications/threads/${thread.id}`;
		expect(
			(await call(`${threadPath}/subscription`, asToken(carol))).status,
		).toBe(200);

		signIn(users.alice);
		await repositories.removeCollaborator({
			data: { repoId: created.body.id, userId: users.carol.id },
		});
		expect(
			(await call("/notifications?all=true", asToken(carol))).body,
		).toEqual([]);
		for (const [path, method] of [
			[threadPath, "GET"],
			[threadPath, "PATCH"],
			[threadPath, "DELETE"],
			[`${threadPath}/subscription`, "GET"],
			[`${threadPath}/subscription`, "PUT"],
			[`${threadPath}/subscription`, "DELETE"],
		] as const) {
			expect(
				(
					await call(path, {
						...asToken(carol),
						method,
						...(method === "PUT" && { body: "{}" }),
					})
				).status,
				`${method} ${path}`,
			).toBe(404);
		}
		expect(
			(await call("/repos/alice/secret/notifications", asToken(carol))).status,
		).toBe(404);
	});
});
