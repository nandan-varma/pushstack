/**
 * @vitest-environment node
 *
 * GitHub's reactions REST endpoints on issues and issue comments, plus the
 * `reactions` rollup on issue and comment objects, through the real dispatcher.
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
const { asToken, call, mintToken, post } = await import(
	"../../test/api-client"
);

let alice: string;
let aliceRead: string;
let bob: string;
let carol: string;
let commentId: number;

const del = (token: string) => ({ ...asToken(token), method: "DELETE" });

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	aliceRead = await mintToken(users.alice, ["repo:read"]);
	bob = await mintToken(users.bob, ["repo:write"]);
	carol = await mintToken(users.carol, ["repo:write"]);
	expect(
		(await call("/user/repos", post(alice, { name: "pub", auto_init: true })))
			.status,
	).toBe(201);
	expect(
		(
			await call(
				"/user/repos",
				post(alice, { name: "secret", private: true, auto_init: true }),
			)
		).status,
	).toBe(201);
	expect(
		(await call("/repos/alice/pub/issues", post(alice, { title: "One" })))
			.status,
	).toBe(201);
	expect(
		(await call("/repos/alice/pub/issues", post(alice, { title: "Two" })))
			.status,
	).toBe(201);
	const comment = await call(
		"/repos/alice/pub/issues/1/comments",
		post(alice, { body: "Hi" }),
	);
	commentId = comment.body.id;
	expect(
		(await call("/repos/alice/secret/issues", post(alice, { title: "S" })))
			.status,
	).toBe(201);
});

describe("issue reactions", () => {
	it("creates 201, then 200 for the same reaction", async () => {
		const first = await call(
			"/repos/alice/pub/issues/1/reactions",
			post(bob, { content: "heart" }),
		);
		expect(first.status).toBe(201);
		expect(first.body).toMatchObject({
			content: "heart",
			user: { login: "bob" },
		});
		const again = await call(
			"/repos/alice/pub/issues/1/reactions",
			post(bob, { content: "heart" }),
		);
		expect(again.status).toBe(200);
		expect(again.body.id).toBe(first.body.id);
	});

	it("lists, filters by content and paginates", async () => {
		await call(
			"/repos/alice/pub/issues/1/reactions",
			post(alice, { content: "+1" }),
		);
		await call(
			"/repos/alice/pub/issues/1/reactions",
			post(carol, { content: "+1" }),
		);
		const all = await call("/repos/alice/pub/issues/1/reactions");
		expect(all.status).toBe(200);
		expect(all.body.map((r: { content: string }) => r.content)).toEqual([
			"heart",
			"+1",
			"+1",
		]);
		const plus = await call("/repos/alice/pub/issues/1/reactions?content=%2B1");
		expect(plus.body).toHaveLength(2);
		const page = await call(
			"/repos/alice/pub/issues/1/reactions?per_page=1&page=2",
		);
		expect(page.body).toHaveLength(1);
		expect(page.headers.get("Link")).toContain('rel="next"');
		expect(
			(await call("/repos/alice/pub/issues/1/reactions?content=nope")).status,
		).toBe(422);
	});

	it("rolls reactions up on issue objects, single and listed", async () => {
		const one = await call("/repos/alice/pub/issues/1");
		expect(one.body.reactions).toMatchObject({
			url: expect.stringMatching(/\/repos\/alice\/pub\/issues\/1\/reactions$/),
			total_count: 3,
			"+1": 2,
			heart: 1,
			eyes: 0,
		});
		const list = await call("/repos/alice/pub/issues?state=all");
		const byNumber = new Map(
			list.body.map((i: { number: number; reactions: unknown }) => [
				i.number,
				i.reactions,
			]),
		);
		expect(byNumber.get(1)).toMatchObject({ total_count: 3 });
		expect(byNumber.get(2)).toMatchObject({ total_count: 0 });
	});

	it("rejects bad content, missing scope and anonymous callers", async () => {
		const bad = await call(
			"/repos/alice/pub/issues/1/reactions",
			post(bob, { content: "party" }),
		);
		expect(bad.status).toBe(422);
		expect(
			(
				await call(
					"/repos/alice/pub/issues/1/reactions",
					post(aliceRead, { content: "eyes" }),
				)
			).status,
		).toBe(403);
		expect(
			(
				await call("/repos/alice/pub/issues/1/reactions", {
					method: "POST",
					body: JSON.stringify({ content: "eyes" }),
				})
			).status,
		).toBe(401);
	});

	it("hides private repositories' reactions", async () => {
		expect(
			(await call("/repos/alice/secret/issues/1/reactions", asToken(bob)))
				.status,
		).toBe(404);
		expect(
			(
				await call(
					"/repos/alice/secret/issues/1/reactions",
					post(bob, { content: "eyes" }),
				)
			).status,
		).toBe(404);
		expect((await call("/repos/alice/pub/issues/99/reactions")).status).toBe(
			404,
		);
	});

	it("deletes only the caller's own reaction, 204", async () => {
		const list = await call("/repos/alice/pub/issues/1/reactions");
		const bobs = list.body.find(
			(r: { user: { login: string } }) => r.user.login === "bob",
		);
		expect(
			(await call(`/repos/alice/pub/issues/1/reactions/${bobs.id}`, del(carol)))
				.status,
		).toBe(403);
		// Another subject's path does not reach it.
		expect(
			(await call(`/repos/alice/pub/issues/2/reactions/${bobs.id}`, del(bob)))
				.status,
		).toBe(404);
		expect(
			(await call(`/repos/alice/pub/issues/1/reactions/${bobs.id}`, del(bob)))
				.status,
		).toBe(204);
		expect(
			(await call(`/repos/alice/pub/issues/1/reactions/${bobs.id}`, del(bob)))
				.status,
		).toBe(404);
	});
});

describe("issue comment reactions", () => {
	it("creates, lists and rolls up, separate from the issue's", async () => {
		const path = `/repos/alice/pub/issues/comments/${commentId}/reactions`;
		const created = await call(path, post(bob, { content: "rocket" }));
		expect(created.status).toBe(201);
		expect((await call(path, post(bob, { content: "rocket" }))).status).toBe(
			200,
		);
		const list = await call(path);
		expect(list.body).toHaveLength(1);

		const comment = await call(`/repos/alice/pub/issues/comments/${commentId}`);
		expect(comment.body.reactions).toMatchObject({
			url: expect.stringMatching(
				new RegExp(`/issues/comments/${commentId}/reactions$`),
			),
			total_count: 1,
			rocket: 1,
		});
		const comments = await call("/repos/alice/pub/issues/1/comments");
		expect(comments.body[0].reactions.rocket).toBe(1);
		const timeline = await call("/repos/alice/pub/issues/1/timeline");
		const commented = timeline.body.find(
			(item: { event: string }) => item.event === "commented",
		);
		expect(commented.reactions.rocket).toBe(1);
		// The issue's own rollup does not count comment reactions.
		const issue = await call("/repos/alice/pub/issues/1");
		expect(issue.body.reactions.rocket).toBe(0);

		expect((await call(`${path}/${created.body.id}`, del(alice))).status).toBe(
			403,
		);
		expect((await call(`${path}/${created.body.id}`, del(bob))).status).toBe(
			204,
		);
		expect((await call(path)).body).toHaveLength(0);
	});

	it("404s for a comment in another repository", async () => {
		expect(
			(
				await call(
					`/repos/alice/secret/issues/comments/${commentId}/reactions`,
					asToken(alice),
				)
			).status,
		).toBe(404);
	});
});
