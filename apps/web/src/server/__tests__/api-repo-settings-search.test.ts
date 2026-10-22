/**
 * @vitest-environment node
 *
 * `/api/v3` repository settings (`PATCH`/`DELETE /repos/{owner}/{repo}`),
 * search (`/search/repositories`, `/search/issues`) and `GET /meta`, through
 * the real dispatcher over pglite and the in-memory git store.
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
const repositories = await import("../repositories");
const { asToken, call, mintToken, patch, post } = await import(
	"../../test/api-client"
);

const users = await createUsers("alice", "bob", "carol");
const del = (token: string) => ({ ...asToken(token), method: "DELETE" });

let alice: string;
let aliceRead: string;
let bob: string;
let carol: string;
let projId: number;

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	aliceRead = await mintToken(users.alice, ["repo:read"]);
	bob = await mintToken(users.bob, ["repo:write"]);
	carol = await mintToken(users.carol, ["repo:write"]);

	const proj = await call(
		"/user/repos",
		post(alice, { name: "proj", description: "Widgets", auto_init: true }),
	);
	projId = proj.body.id;
	await call("/user/repos", post(alice, { name: "secret", private: true }));
	await call("/user/repos", post(bob, { name: "gadgets", auto_init: true }));

	signIn(users.alice);
	await files.createBranch({ data: { repoId: projId, name: "dev" } });
	// Bob administers proj (still not its owner).
	await repositories.addCollaboratorByUsername({
		data: { repoId: projId, username: "bob", role: "admin" },
	});

	await call(
		"/repos/alice/proj/issues",
		post(alice, { title: "Crash on start", body: "A bug", labels: ["bug"] }),
	);
	await call(
		"/repos/alice/proj/issues",
		post(alice, { title: "Docs typo", body: "Minor" }),
	);
	await call(
		"/repos/alice/proj/pulls",
		post(alice, { title: "Fix the crash", head: "dev", base: "main" }),
	);
	await call(
		"/repos/bob/gadgets/issues",
		post(bob, { title: "Crash in gadgets" }),
	);
});

describe("GET /meta", () => {
	it("answers as GitHub Enterprise Server, without password auth", async () => {
		const res = await call("/meta");
		expect(res.status).toBe(200);
		expect(res.body).toEqual({
			verifiable_password_authentication: false,
			installed_version: expect.stringMatching(/^3\.\d+\.\d+$/),
		});
	});
});

describe("PATCH /repos/{owner}/{repo}", () => {
	it("updates the description, default branch and visibility", async () => {
		const res = await call(
			"/repos/alice/proj",
			patch(alice, {
				description: "Better widgets",
				default_branch: "dev",
				private: true,
				has_wiki: false,
			}),
		);
		expect(res.status).toBe(200);
		expect(res.body).toMatchObject({
			description: "Better widgets",
			default_branch: "dev",
			private: true,
			visibility: "private",
			permissions: { admin: true, push: true, pull: true },
		});
		// Private now: anonymous readers get 404.
		expect((await call("/repos/alice/proj")).status).toBe(404);

		const back = await call(
			"/repos/alice/proj",
			patch(alice, { default_branch: "main", visibility: "public" }),
		);
		expect(back.body).toMatchObject({
			default_branch: "main",
			private: false,
		});
		expect((await call("/repos/alice/proj")).status).toBe(200);
	});

	it("clears the description with null", async () => {
		await call("/repos/alice/proj", patch(alice, { description: "x" }));
		const res = await call(
			"/repos/alice/proj",
			patch(alice, { description: null }),
		);
		expect(res.body.description).toBeNull();
		await call("/repos/alice/proj", patch(alice, { description: "Widgets" }));
	});

	it("renames, moving the git data with the repository", async () => {
		await call("/user/repos", post(alice, { name: "before", auto_init: true }));
		const res = await call(
			"/repos/alice/before",
			patch(alice, { name: "after" }),
		);
		expect(res.status).toBe(200);
		expect(res.body).toMatchObject({
			name: "after",
			full_name: "alice/after",
		});
		expect((await call("/repos/alice/before", asToken(alice))).status).toBe(
			404,
		);
		const branches = await call("/repos/alice/after/branches", asToken(alice));
		expect(branches.body.map((b: { name: string }) => b.name)).toEqual([
			"main",
		]);
	});

	it("rejects a name the owner already uses", async () => {
		const res = await call(
			"/repos/alice/proj",
			patch(alice, { name: "secret" }),
		);
		expect(res.status).toBe(422);
		expect(res.body.errors).toEqual([
			expect.objectContaining({ field: "name", code: "custom" }),
		]);
	});

	it.each([
		[{ default_branch: "missing" }, "default_branch"],
		[{ default_branch: "../x" }, "default_branch"],
		[{ visibility: "internal" }, "visibility"],
		[{ homepage: "https://example.org" }, "homepage"],
		[{ archived: true }, "archived"],
		[{ is_template: true }, "is_template"],
	])("rejects %j with a 422 naming %s", async (body, field) => {
		const res = await call("/repos/alice/proj", patch(alice, body));
		expect(res.status).toBe(422);
		expect(res.body.errors).toEqual([
			{ resource: "Repository", field, code: "invalid" },
		]);
	});

	it("accepts unsupported fields at the values PushStack has", async () => {
		const res = await call(
			"/repos/alice/proj",
			patch(alice, { homepage: "", archived: false, is_template: false }),
		);
		expect(res.status).toBe(200);
	});

	it("is the owner's: an admin collaborator gets 403, a stranger 404", async () => {
		const admin = await call("/repos/alice/proj", patch(bob, { name: "x" }));
		expect(admin.status).toBe(403);
		expect(admin.body.message).toBe("Must have admin rights to Repository.");
		expect(
			(await call("/repos/alice/secret", patch(carol, { name: "x" }))).status,
		).toBe(404);
		expect(
			(await call("/repos/alice/proj", patch(aliceRead, { name: "x" }))).status,
		).toBe(403);
		expect(
			(await call("/repos/alice/proj", { method: "PATCH", body: "{}" })).status,
		).toBe(401);
	});
});

describe("DELETE /repos/{owner}/{repo}", () => {
	it("deletes the owner's repository with 204", async () => {
		await call("/user/repos", post(alice, { name: "doomed", auto_init: true }));
		expect((await call("/repos/alice/doomed", del(carol))).status).toBe(403);
		const res = await call("/repos/alice/doomed", del(alice));
		expect(res.status).toBe(204);
		expect((await call("/repos/alice/doomed", asToken(alice))).status).toBe(
			404,
		);
		// The name is free again, storage included.
		const again = await call(
			"/user/repos",
			post(alice, { name: "doomed", auto_init: true }),
		);
		expect(again.status).toBe(201);
	});

	it("is the owner's", async () => {
		const res = await call("/repos/alice/proj", del(bob));
		expect(res.status).toBe(403);
	});
});

describe("GET /search/repositories", () => {
	const names = (body: { items: { full_name: string }[] }) =>
		body.items.map((item) => item.full_name).sort();

	it("requires q", async () => {
		const res = await call("/search/repositories");
		expect(res.status).toBe(422);
		expect(res.body.errors).toEqual([
			{ resource: "Search", field: "q", code: "missing" },
		]);
	});

	it("finds readable repositories by name or description", async () => {
		const res = await call("/search/repositories?q=widgets");
		expect(res.status).toBe(200);
		expect(res.body).toMatchObject({
			total_count: 1,
			incomplete_results: false,
		});
		expect(res.body.items[0]).toMatchObject({
			full_name: "alice/proj",
			score: 1,
		});
		expect(names((await call("/search/repositories?q=gad")).body)).toEqual([
			"bob/gadgets",
		]);
	});

	it("scopes by user and visibility, private only for those who can read", async () => {
		expect(
			names((await call("/search/repositories?q=user:alice")).body),
		).toEqual(["alice/after", "alice/doomed", "alice/proj"]);
		expect(
			names(
				(
					await call(
						"/search/repositories?q=user:alice+is:private",
						asToken(alice),
					)
				).body,
			),
		).toEqual(["alice/secret"]);
		expect(
			names(
				(
					await call(
						"/search/repositories?q=user:alice+is:private",
						asToken(carol),
					)
				).body,
			),
		).toEqual([]);
		expect(
			names((await call("/search/repositories?q=repo:bob/gadgets")).body),
		).toEqual(["bob/gadgets"]);
		expect(
			names(
				(await call("/search/repositories?q=user:alice+archived:true")).body,
			),
		).toEqual([]);
	});

	it("pages with total_count and Link", async () => {
		const res = await call("/search/repositories?q=user:alice&per_page=1");
		expect(res.body.total_count).toBe(3);
		expect(res.body.items).toHaveLength(1);
		expect(res.headers.get("Link")).toMatch(/rel="next"/);
	});
});

describe("GET /search/issues", () => {
	const found = (body: { items: { title: string }[] }) =>
		body.items.map((item) => item.title).sort();

	it("searches issues and pull requests across readable repositories", async () => {
		const res = await call("/search/issues?q=crash");
		expect(res.status).toBe(200);
		expect(found(res.body)).toEqual([
			"Crash in gadgets",
			"Crash on start",
			"Fix the crash",
		]);
		const pr = res.body.items.find(
			(item: { title: string }) => item.title === "Fix the crash",
		);
		expect(pr).toMatchObject({
			score: 1,
			repository_url: expect.stringMatching(/\/repos\/alice\/proj$/),
			pull_request: expect.any(Object),
		});
	});

	it("reads gh's query: grouping parentheses, repo: and type:", async () => {
		const q = encodeURIComponent("( crash ) repo:alice/proj type:issue");
		expect(found((await call(`/search/issues?q=${q}`)).body)).toEqual([
			"Crash on start",
		]);
		const prs = encodeURIComponent("repo:alice/proj type:pr state:open");
		expect(found((await call(`/search/issues?q=${prs}`)).body)).toEqual([
			"Fix the crash",
		]);
		const closed = encodeURIComponent("repo:alice/proj is:closed");
		expect(found((await call(`/search/issues?q=${closed}`)).body)).toEqual([]);
		const label = encodeURIComponent("label:bug user:alice");
		expect(found((await call(`/search/issues?q=${label}`)).body)).toEqual([
			"Crash on start",
		]);
	});

	it("hides private repositories' threads", async () => {
		await call(
			"/repos/alice/secret/issues",
			post(alice, { title: "Secret crash" }),
		);
		const q = encodeURIComponent("secret crash");
		expect((await call(`/search/issues?q=${q}`, asToken(carol))).body).toEqual({
			total_count: 0,
			incomplete_results: false,
			items: [],
		});
		expect(
			found((await call(`/search/issues?q=${q}`, asToken(alice))).body),
		).toEqual(["Secret crash"]);
	});

	it("sorts by GitHub's sort and order", async () => {
		const q = encodeURIComponent("repo:alice/proj");
		const asc = await call(`/search/issues?q=${q}&sort=created&order=asc`);
		expect(asc.body.items.map((i: { number: number }) => i.number)).toEqual([
			1, 2, 3,
		]);
	});
});
