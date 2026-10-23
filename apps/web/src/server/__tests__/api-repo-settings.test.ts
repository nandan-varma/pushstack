/**
 * @vitest-environment node
 *
 * Repository settings over REST and the web server functions: PATCH/DELETE,
 * archive, topics, homepage and flags, transfer, templates, `topic:` search.
 * Real dispatcher, pglite and the in-memory git store.
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
const users = await createUsers("alice", "bob", "carol");
const { asToken, call, mintToken, patch, post } = await import(
	"../../test/api-client"
);
const { serveGitRequest } = await import("../git-http");
const { searchRepositories } = await import("../search");
const issues = await import("../issues");
const repositories = await import("../repositories");

const put = (token: string, body: unknown) => ({
	...asToken(token),
	method: "PUT",
	body: JSON.stringify(body),
});
const del = (token: string) => ({ ...asToken(token), method: "DELETE" });

let alice: string;
let bob: string;

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	bob = await mintToken(users.bob, ["repo:write"]);
	await call("/user/repos", post(alice, { name: "proj", auto_init: true }));
});

describe("PATCH /repos/{owner}/{repo}", () => {
	it("updates description, homepage and flags, and clears with null", async () => {
		const response = await call(
			"/repos/alice/proj",
			patch(alice, {
				description: "Hello",
				homepage: "https://example.org",
				has_wiki: false,
				has_issues: false,
				has_projects: false,
				is_template: true,
			}),
		);
		expect(response.status).toBe(200);
		expect(response.body).toMatchObject({
			description: "Hello",
			homepage: "https://example.org",
			has_wiki: false,
			has_issues: false,
			has_projects: false,
			is_template: true,
			archived: false,
			topics: [],
		});
		const cleared = await call(
			"/repos/alice/proj",
			patch(alice, { description: null, homepage: null, has_issues: true }),
		);
		expect(cleared.body).toMatchObject({
			description: null,
			homepage: null,
			has_issues: true,
		});
	});

	it("is for owners and admins only", async () => {
		const anonymous = await call("/repos/alice/proj", {
			method: "PATCH",
			body: "{}",
		});
		expect(anonymous.status).toBe(401);
		const stranger = await call(
			"/repos/alice/proj",
			patch(bob, { homepage: "x" }),
		);
		expect(stranger.status).toBe(403);
		expect(stranger.body.message).toBe("Must have admin rights to Repository.");
	});

	it("renames (moving storage), flips visibility and validates", async () => {
		await call("/user/repos", post(alice, { name: "tmp", auto_init: true }));
		const renamed = await call(
			"/repos/alice/tmp",
			patch(alice, { name: "tmp2", private: true }),
		);
		expect(renamed.status).toBe(200);
		expect(renamed.body).toMatchObject({
			full_name: "alice/tmp2",
			private: true,
			visibility: "private",
		});
		expect((await call("/repos/alice/tmp")).status).toBe(404);
		expect((await call("/repos/alice/tmp2", asToken(alice))).status).toBe(200);
		// The renamed storage still serves its commits.
		expect(
			(await call("/repos/alice/tmp2/branches/main", asToken(alice))).status,
		).toBe(200);

		const taken = await call(
			"/repos/alice/tmp2",
			patch(alice, { name: "proj" }),
		);
		expect(taken.status).toBe(422);
		const badBranch = await call(
			"/repos/alice/tmp2",
			patch(alice, { default_branch: "nope" }),
		);
		expect(badBranch.status).toBe(422);
		const bad = await call("/repos/alice/tmp2", patch(alice, { name: "a/b" }));
		expect(bad.status).toBe(422);
	});
});

describe("topics", () => {
	it("replaces, lists and rejects invalid names", async () => {
		const put1 = await call(
			"/repos/alice/proj/topics",
			put(alice, { names: ["git", "forge", "git"] }),
		);
		expect(put1.status).toBe(200);
		expect(put1.body).toEqual({ names: ["git", "forge"] });
		expect((await call("/repos/alice/proj/topics")).body).toEqual({
			names: ["git", "forge"],
		});
		expect((await call("/repos/alice/proj")).body.topics).toEqual([
			"git",
			"forge",
		]);

		for (const names of [["Upper"], ["has space"], ["-lead"], [""]]) {
			const response = await call(
				"/repos/alice/proj/topics",
				put(alice, { names }),
			);
			expect(response.status).toBe(422);
		}
		const tooMany = await call(
			"/repos/alice/proj/topics",
			put(alice, { names: Array.from({ length: 21 }, (_, i) => `t${i}`) }),
		);
		expect(tooMany.status).toBe(422);
		expect(
			(await call("/repos/alice/proj/topics", put(bob, { names: ["x"] })))
				.status,
		).toBe(403);
	});

	it("are searchable with topic:", async () => {
		signIn(users.carol);
		const hit = await searchRepositories({ data: { query: "topic:forge" } });
		expect(hit.map((repo) => repo.name)).toContain("proj");
		const both = await searchRepositories({
			data: { query: "pro topic:git topic:forge" },
		});
		expect(both.map((repo) => repo.name)).toEqual(["proj"]);
		const none = await searchRepositories({
			data: { query: "topic:git topic:missing" },
		});
		expect(none).toEqual([]);
	});
});

describe("archiving", () => {
	let sourceId: number;

	beforeAll(async () => {
		await call("/user/repos", post(alice, { name: "arch", auto_init: true }));
		const repo = await call("/repos/alice/arch");
		sourceId = repo.body.id;
		await call("/repos/alice/arch/issues", post(alice, { title: "Existing" }));
	});

	it("rejects writes with GitHub's message, but still reads", async () => {
		const archived = await call(
			"/repos/alice/arch",
			patch(alice, { archived: true }),
		);
		expect(archived.status).toBe(200);
		expect(archived.body.archived).toBe(true);

		const newIssue = await call(
			"/repos/alice/arch/issues",
			post(alice, { title: "Nope" }),
		);
		expect(newIssue.status).toBe(403);
		expect(newIssue.body.message).toBe(
			"Repository was archived so is read-only.",
		);
		const comment = await call(
			"/repos/alice/arch/issues/1/comments",
			post(alice, { body: "hi" }),
		);
		expect(comment.status).toBe(403);
		const editOwn = await call(
			"/repos/alice/arch/issues/1",
			patch(alice, { title: "Renamed" }),
		);
		expect(editOwn.status).toBe(403);
		const file = await call("/repos/alice/arch/contents/x.txt", {
			...put(alice, { message: "m", content: btoa("x") }),
		});
		expect(file.status).toBe(403);
		const settings = await call(
			"/repos/alice/arch",
			patch(alice, { description: "changed" }),
		);
		expect(settings.status).toBe(403);
		const topics = await call(
			"/repos/alice/arch/topics",
			put(alice, { names: ["x"] }),
		);
		expect(topics.status).toBe(403);

		expect((await call("/repos/alice/arch/issues/1")).status).toBe(200);
		expect((await call("/repos/alice/arch/branches")).status).toBe(200);
	});

	it("locks web writes too", async () => {
		signIn(users.alice);
		await expect(
			issues.createIssue({
				data: {
					repoId: sourceId,
					title: "Web",
					body: "",
					labels: [],
					assignees: [],
				},
			}),
		).rejects.toThrow("archived");
		await expect(
			issues.updateIssue({ data: { issueId: 1, title: "x" } }),
		).rejects.toThrow();
		await expect(
			repositories.updateRepository({
				data: { id: sourceId, description: "x" },
			}),
		).rejects.toThrow("archived");
	});

	it("refuses pushes but allows clones", async () => {
		const credentials = `Basic ${btoa(`alice:${alice}`)}`;
		const push = await serveGitRequest(
			new Request(
				"http://localhost:3000/alice/arch.git/info/refs?service=git-receive-pack",
				{ headers: { authorization: credentials } },
			),
		);
		expect(push.status).toBe(403);
		expect(await push.text()).toContain("archived");
		const clone = await serveGitRequest(
			new Request(
				"http://localhost:3000/alice/arch.git/info/refs?service=git-upload-pack",
				{ headers: { authorization: credentials } },
			),
		);
		expect(clone.status).toBe(200);
	});

	it("unarchives, restoring writes", async () => {
		const back = await call(
			"/repos/alice/arch",
			patch(alice, { archived: false }),
		);
		expect(back.status).toBe(200);
		expect(back.body.archived).toBe(false);
		const issue = await call(
			"/repos/alice/arch/issues",
			post(alice, { title: "Again" }),
		);
		expect(issue.status).toBe(201);
		const push = await serveGitRequest(
			new Request(
				"http://localhost:3000/alice/arch.git/info/refs?service=git-receive-pack",
				{ headers: { authorization: `Basic ${btoa(`alice:${alice}`)}` } },
			),
		);
		expect(push.status).toBe(200);
	});
});

describe("templates", () => {
	it("generates a new repository from a template without its history", async () => {
		await call(
			"/user/repos",
			post(alice, { name: "tpl", auto_init: true, license_template: "mit" }),
		);
		const plain = await call(
			"/repos/alice/tpl/generate",
			post(bob, { name: "child" }),
		);
		// Not a template yet: indistinguishable from missing.
		expect(plain.status).toBe(404);
		await call("/repos/alice/tpl", patch(alice, { is_template: true }));

		const generated = await call(
			"/repos/alice/tpl/generate",
			post(bob, { name: "child", description: "From tpl" }),
		);
		expect(generated.status).toBe(201);
		expect(generated.body).toMatchObject({
			full_name: "bob/child",
			description: "From tpl",
			is_template: false,
			private: false,
		});
		const readme = await call("/repos/bob/child/contents/README.md");
		expect(readme.status).toBe(200);
		const license = await call("/repos/bob/child/contents/LICENSE");
		expect(license.status).toBe(200);
		const commits = await call("/repos/bob/child/commits");
		expect(commits.body).toHaveLength(1);
		expect(commits.body[0].commit.message).toBe("Initial commit");

		const again = await call(
			"/repos/alice/tpl/generate",
			post(bob, { name: "child" }),
		);
		expect(again.status).toBe(422);
	});

	it("hides a private template from strangers", async () => {
		await call("/repos/alice/tpl", patch(alice, { private: true }));
		const response = await call(
			"/repos/alice/tpl/generate",
			post(bob, { name: "other" }),
		);
		expect(response.status).toBe(404);
		await call("/repos/alice/tpl", patch(alice, { private: false }));
	});
});

describe("transfer", () => {
	it("moves the repository and its git data to another user", async () => {
		await call("/user/repos", post(alice, { name: "mover", auto_init: true }));
		const before = await call("/repos/alice/mover/branches/main");
		const moved = await call(
			"/repos/alice/mover/transfer",
			post(alice, { new_owner: "bob", new_name: "moved" }),
		);
		expect(moved.status).toBe(202);
		expect(moved.body).toMatchObject({ full_name: "bob/moved" });
		expect((await call("/repos/alice/mover")).status).toBe(404);
		const after = await call("/repos/bob/moved/branches/main");
		expect(after.body.commit.sha).toBe(before.body.commit.sha);
		const owned = await call("/repos/bob/moved", asToken(bob));
		expect(owned.body.permissions).toEqual({
			admin: true,
			push: true,
			pull: true,
		});
		expect(
			(await call("/repos/bob/moved", asToken(alice))).body.permissions,
		).toEqual({ admin: false, push: false, pull: true });
	});

	it("validates the target and refuses name clashes and non-owners", async () => {
		await call("/user/repos", post(alice, { name: "clash", auto_init: true }));
		await call("/user/repos", post(bob, { name: "clash", auto_init: true }));
		const clash = await call(
			"/repos/alice/clash/transfer",
			post(alice, { new_owner: "bob" }),
		);
		expect(clash.status).toBe(422);
		const missing = await call(
			"/repos/alice/clash/transfer",
			post(alice, { new_owner: "nobody-here" }),
		);
		expect(missing.status).toBe(422);
		const stranger = await call(
			"/repos/alice/clash/transfer",
			post(bob, { new_owner: "carol" }),
		);
		expect(stranger.status).toBe(403);
	});
});

describe("concurrency", () => {
	it("opposite transfers finish instead of deadlocking on each other's locks", async () => {
		await call("/user/repos", post(alice, { name: "ping", auto_init: true }));
		await call("/user/repos", post(bob, { name: "pong", auto_init: true }));
		const [one, two] = await Promise.all([
			call("/repos/alice/ping/transfer", post(alice, { new_owner: "bob" })),
			call("/repos/bob/pong/transfer", post(bob, { new_owner: "alice" })),
		]);
		expect([one.status, two.status]).toEqual([202, 202]);
		expect((await call("/repos/bob/ping")).status).toBe(200);
		expect((await call("/repos/alice/pong")).status).toBe(200);
	}, 20_000);

	it("a create racing a delete keeps its storage", async () => {
		await call("/user/repos", post(alice, { name: "race", auto_init: true }));
		const removal = call("/repos/alice/race", del(alice));
		const creation = call(
			"/user/repos",
			post(alice, { name: "race", auto_init: true }),
		);
		const [removed, created] = await Promise.all([removal, creation]);
		expect(removed.status).toBe(204);
		// Either the name was still taken or the new repository kept its commit.
		if (created.status === 201) {
			expect((await call("/repos/alice/race/branches/main")).status).toBe(200);
		} else {
			expect(created.status).toBe(422);
		}
	}, 20_000);
});

describe("DELETE /repos/{owner}/{repo}", () => {
	it("deletes for the owner with 204, 403 for others", async () => {
		await call("/user/repos", post(alice, { name: "gone", auto_init: true }));
		expect((await call("/repos/alice/gone", del(bob))).status).toBe(403);
		const removed = await call("/repos/alice/gone", del(alice));
		expect(removed.status).toBe(204);
		expect((await call("/repos/alice/gone")).status).toBe(404);
		expect((await call("/repos/alice/gone", del(alice))).status).toBe(404);
		// The name is free again and starts empty.
		const again = await call("/user/repos", post(alice, { name: "gone" }));
		expect(again.status).toBe(201);
	});

	it("deletes an archived repository", async () => {
		await call("/user/repos", post(alice, { name: "oldie", auto_init: true }));
		await call("/repos/alice/oldie", patch(alice, { archived: true }));
		expect((await call("/repos/alice/oldie", del(alice))).status).toBe(204);
	});
});
