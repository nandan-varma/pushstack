/**
 * @vitest-environment node
 *
 * Watching repositories and following users over the REST API: repository
 * subscriptions, watchers, `subscribers_count`, the repositories a user
 * watches, followers and following, auto-watching on create, the
 * notifications watchers get, and that private repositories never leak.
 * The real dispatcher over pglite.
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
const users = await createUsers("alice", "bob", "carol", "dave");
const { BASE, asToken, call, mintToken, post } = await import(
	"../../test/api-client"
);
const { db } = await import("../../db");
const { repositoryCollaborators, repositories } = await import(
	"../../db/app-schema"
);
const { eq } = await import("drizzle-orm");

let alice: string;
let bob: string;
let carol: string;
let dave: string;

const send = (method: string, token: string, body?: unknown) => ({
	...asToken(token),
	method,
	...(body !== undefined && { body: JSON.stringify(body) }),
});
const logins = (list: { login: string }[]) => list.map((u) => u.login);

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	bob = await mintToken(users.bob, ["repo:write"]);
	carol = await mintToken(users.carol, ["repo:read"]);
	dave = await mintToken(users.dave, ["repo:write"]);
	await call("/user/repos", post(alice, { name: "pub" }));
	await call("/user/repos", post(alice, { name: "priv", private: true }));
	const [priv] = await db
		.select({ id: repositories.id })
		.from(repositories)
		.where(eq(repositories.name, "priv"));
	await db.insert(repositoryCollaborators).values({
		repoId: priv?.id ?? 0,
		userId: users.bob.id,
		role: "read",
	});
});

describe("repository subscriptions", () => {
	it("watches a repository you create, like GitHub", async () => {
		const { status, body } = await call(
			"/repos/alice/pub/subscription",
			asToken(alice),
		);
		expect(status).toBe(200);
		expect(body).toMatchObject({
			subscribed: true,
			ignored: false,
			reason: null,
			url: `${BASE}/repos/alice/pub/subscription`,
			repository_url: `${BASE}/repos/alice/pub`,
		});
		const repo = await call("/repos/alice/pub", asToken(alice));
		expect(repo.body.subscribers_count).toBe(1);
		// `watchers` and `watchers_count` are stars, as on GitHub.
		expect(repo.body.watchers_count).toBe(repo.body.stargazers_count);
		expect(repo.body.watchers).toBe(repo.body.stargazers_count);
	});

	it("is 404 until you subscribe, and needs a token", async () => {
		expect(
			(await call("/repos/alice/pub/subscription", asToken(bob))).status,
		).toBe(404);
		expect((await call("/repos/alice/pub/subscription")).status).toBe(401);
	});

	it("watches, ignores, and unsubscribes", async () => {
		const put = await call(
			"/repos/alice/pub/subscription",
			send("PUT", bob, { subscribed: true }),
		);
		expect(put.status).toBe(200);
		expect(put.body).toMatchObject({ subscribed: true, ignored: false });
		const created = put.body.created_at;

		const repo = await call("/repos/alice/pub", asToken(bob));
		expect(repo.body.subscribers_count).toBe(2);

		const ignored = await call(
			"/repos/alice/pub/subscription",
			send("PUT", bob, { ignored: true }),
		);
		expect(ignored.body).toMatchObject({ subscribed: false, ignored: true });
		// Changing the level keeps the first subscription time.
		expect(ignored.body.created_at).toBe(created);
		const after = await call("/repos/alice/pub", asToken(bob));
		expect(after.body.subscribers_count).toBe(1);
		const watchers = await call("/repos/alice/pub/subscribers");
		expect(logins(watchers.body)).toEqual(["alice"]);

		const del = await call(
			"/repos/alice/pub/subscription",
			send("DELETE", bob),
		);
		expect(del.status).toBe(204);
		expect(
			(await call("/repos/alice/pub/subscription", asToken(bob))).status,
		).toBe(404);
	});

	it("accepts an empty body, and subscribed:false removes the subscription", async () => {
		const empty = await call("/repos/alice/pub/subscription", send("PUT", bob));
		expect(empty.status).toBe(200);
		expect(empty.body).toMatchObject({ subscribed: true, ignored: false });
		const off = await call(
			"/repos/alice/pub/subscription",
			send("PUT", bob, { subscribed: false }),
		);
		expect(off.body).toMatchObject({ subscribed: false, ignored: false });
		expect(
			(await call("/repos/alice/pub/subscription", asToken(bob))).status,
		).toBe(404);
	});

	it("needs a write token to change a subscription", async () => {
		const put = await call(
			"/repos/alice/pub/subscription",
			send("PUT", carol, {}),
		);
		expect(put.status).toBe(403);
		const del = await call(
			"/repos/alice/pub/subscription",
			send("DELETE", carol),
		);
		expect(del.status).toBe(403);
	});

	it("lists watchers with GitHub's pagination", async () => {
		await call("/repos/alice/pub/subscription", send("PUT", bob, {}));
		await call("/repos/alice/pub/subscription", send("PUT", dave, {}));
		const page = await call("/repos/alice/pub/subscribers?per_page=2");
		expect(logins(page.body)).toEqual(["alice", "bob"]);
		expect(page.headers.get("link")).toContain('rel="next"');
		const next = await call("/repos/alice/pub/subscribers?per_page=2&page=2");
		expect(logins(next.body)).toEqual(["dave"]);
		await call("/repos/alice/pub/subscription", send("DELETE", dave));
		await call("/repos/alice/pub/subscription", send("DELETE", bob));
	});
});

describe("private repositories", () => {
	it("hides the repository's subscriptions from people who can't read it", async () => {
		for (const [method, body] of [
			["GET", undefined],
			["PUT", {}],
			["DELETE", undefined],
		] as const) {
			const response = await call(
				"/repos/alice/priv/subscription",
				send(method, dave, body),
			);
			expect(response.status).toBe(404);
		}
		expect(
			(await call("/repos/alice/priv/subscribers", asToken(dave))).status,
		).toBe(404);
		expect((await call("/repos/alice/priv/subscribers")).status).toBe(404);
	});

	it("counts and lists only watchers who can still read it", async () => {
		await call("/repos/alice/priv/subscription", send("PUT", bob, {}));
		const both = await call("/repos/alice/priv", asToken(alice));
		expect(both.body.subscribers_count).toBe(2);
		expect(
			logins(
				(await call("/repos/alice/priv/subscribers", asToken(alice))).body,
			),
		).toEqual(["alice", "bob"]);

		// Bob loses access: he is neither counted nor listed, and his own list drops it.
		await db
			.delete(repositoryCollaborators)
			.where(eq(repositoryCollaborators.userId, users.bob.id));
		const after = await call("/repos/alice/priv", asToken(alice));
		expect(after.body.subscribers_count).toBe(1);
		expect(
			logins(
				(await call("/repos/alice/priv/subscribers", asToken(alice))).body,
			),
		).toEqual(["alice"]);
		const mine = await call("/user/subscriptions", asToken(bob));
		expect(mine.body.map((r: { full_name: string }) => r.full_name)).toEqual(
			[],
		);
		expect(
			(await call("/repos/alice/priv/subscription", asToken(bob))).status,
		).toBe(404);
		await db.insert(repositoryCollaborators).values({
			repoId: after.body.id,
			userId: users.bob.id,
			role: "read",
		});
	});

	it("lists a user's watched repositories only to people who can read them", async () => {
		await call("/repos/alice/pub/subscription", send("PUT", bob, {}));
		const names = (list: { full_name: string }[]) =>
			list.map((r) => r.full_name).sort();
		// Bob can read both; he watches both.
		expect(
			names((await call("/user/subscriptions", asToken(bob))).body),
		).toEqual(["alice/priv", "alice/pub"]);
		// The owner sees what bob watches that she can read.
		expect(
			names((await call("/users/bob/subscriptions", asToken(alice))).body),
		).toEqual(["alice/priv", "alice/pub"]);
		// Anonymous and unrelated users see only public ones.
		expect(names((await call("/users/bob/subscriptions")).body)).toEqual([
			"alice/pub",
		]);
		expect(
			names((await call("/users/bob/subscriptions", asToken(dave))).body),
		).toEqual(["alice/pub"]);
		expect((await call("/users/nobody/subscriptions")).status).toBe(404);
		// Ignored repositories aren't watched.
		await call(
			"/repos/alice/pub/subscription",
			send("PUT", bob, { ignored: true }),
		);
		expect(
			names((await call("/user/subscriptions", asToken(bob))).body),
		).toEqual(["alice/priv"]);
		await call("/repos/alice/pub/subscription", send("DELETE", bob));
		await call("/repos/alice/priv/subscription", send("DELETE", bob));
	});
});

describe("notifications for watchers", () => {
	const titles = async (token: string) =>
		(await call("/notifications?all=true", asToken(token))).body.map(
			(t: { subject: { title: string }; reason: string }) =>
				`${t.subject.title}:${t.reason}`,
		);

	it("tells watchers about new issues, and ignorers only about mentions", async () => {
		await call("/repos/alice/pub/subscription", send("PUT", bob, {}));
		await call(
			"/repos/alice/pub/subscription",
			send("PUT", dave, { ignored: true }),
		);
		await call("/repos/alice/pub/issues", post(alice, { title: "Watched" }));
		expect(await titles(bob)).toEqual(["Watched:subscribed"]);
		expect(await titles(dave)).toEqual([]);
		// The author isn't told about their own issue, and carol never subscribed.
		expect(await titles(carol)).toEqual([]);

		// Watching follows the thread: a comment reaches bob, not the ignorer.
		await call(
			"/repos/alice/pub/issues/1/comments",
			post(alice, { body: "More" }),
		);
		const bobThread = (await call("/notifications?all=true", asToken(bob)))
			.body;
		expect(bobThread).toHaveLength(1);

		await call(
			"/repos/alice/pub/issues",
			post(alice, { title: "Direct", body: "@dave look" }),
		);
		expect(await titles(dave)).toEqual(["Direct:mention"]);
		await call("/repos/alice/pub/subscription", send("DELETE", bob));
		await call("/repos/alice/pub/subscription", send("DELETE", dave));
		await call("/repos/alice/pub/issues", post(alice, { title: "Quiet" }));
		// Bob stopped watching: he heard about "Direct" (still watching) but not "Quiet".
		expect(await titles(bob)).toEqual([
			"Direct:subscribed",
			"Watched:subscribed",
		]);
	});
});

describe("following", () => {
	it("follows and unfollows idempotently", async () => {
		const first = await call("/user/following/alice", send("PUT", bob));
		expect(first.status).toBe(204);
		expect((await call("/user/following/alice", send("PUT", bob))).status).toBe(
			204,
		);
		expect((await call("/user/following/alice", asToken(bob))).status).toBe(
			204,
		);
		expect((await call("/user/following/bob", asToken(alice))).status).toBe(
			404,
		);
		expect((await call("/users/bob/following/alice")).status).toBe(204);
		expect((await call("/users/alice/following/bob")).status).toBe(404);

		await call("/user/following/alice", send("PUT", dave));
		await call("/user/following/bob", send("PUT", alice));
		expect(logins((await call("/users/alice/followers")).body)).toEqual([
			"dave",
			"bob",
		]);
		expect(
			logins((await call("/user/followers", asToken(alice))).body),
		).toEqual(["dave", "bob"]);
		expect(logins((await call("/user/following", asToken(bob))).body)).toEqual([
			"alice",
		]);
		expect(logins((await call("/users/alice/following")).body)).toEqual([
			"bob",
		]);

		const paged = await call("/users/alice/followers?per_page=1");
		expect(logins(paged.body)).toEqual(["dave"]);
		expect(paged.headers.get("link")).toContain('rel="next"');

		expect(
			(await call("/user/following/alice", send("DELETE", dave))).status,
		).toBe(204);
		expect(
			(await call("/user/following/alice", send("DELETE", dave))).status,
		).toBe(204);
		expect(logins((await call("/users/alice/followers")).body)).toEqual([
			"bob",
		]);
	});

	it("reports followers and following on user resources", async () => {
		const alicePublic = await call("/users/alice");
		expect(alicePublic.body).toMatchObject({ followers: 1, following: 1 });
		const me = await call("/user", asToken(bob));
		expect(me.body).toMatchObject({ followers: 1, following: 1 });
	});

	it("refuses to follow yourself or an unknown user, and needs a write token", async () => {
		const self = await call("/user/following/alice", send("PUT", alice));
		expect(self.status).toBe(422);
		expect(self.body.message).toBe("You cannot follow yourself.");
		expect(
			(await call("/user/following/nobody", send("PUT", alice))).status,
		).toBe(404);
		expect(
			(await call("/user/following/alice", send("PUT", carol))).status,
		).toBe(403);
		expect(
			(await call("/user/following/alice", { method: "PUT" })).status,
		).toBe(401);
		expect((await call("/users/nobody/followers")).status).toBe(404);
	});
});
