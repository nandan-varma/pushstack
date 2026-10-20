/**
 * @vitest-environment node
 *
 * The GitHub-compatible REST API (`/api/v3`), end to end: the real dispatcher
 * over real Postgres (pglite) and git-fs.ts's in-memory store. Requests carry
 * real personal access tokens; only the web session (used here to mint
 * tokens and seed commits) is faked.
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
const { handleApiRequest } = await import("../api");
const files = await import("../files");
const repositories = await import("../repositories");
const { db } = await import("../../db");
const { repositories: repoTable } = await import("../../db/app-schema");
const { eq } = await import("drizzle-orm");

const users = await createUsers("alice", "bob");
const { BASE, asToken, call, mintToken, post } = await import(
	"../../test/api-client"
);

let alice: string;
let aliceRead: string;
let bob: string;

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	aliceRead = await mintToken(users.alice, ["repo:read"]);
	bob = await mintToken(users.bob, ["repo:write"]);
});

describe("authentication", () => {
	it("accepts both `token` and `Bearer` schemes", async () => {
		for (const authorization of [`token ${alice}`, `Bearer ${alice}`]) {
			const { status, body } = await call("/user", { authorization });
			expect(status).toBe(200);
			expect(body.login).toBe("alice");
		}
	});

	it("401s a bad, malformed or unsupported credential with GitHub's body", async () => {
		for (const authorization of [
			"token pst_nope",
			"Bearer nope",
			"Basic YWxpY2U6cHN0X3g=",
			"token",
		]) {
			const { status, body } = await call("/user", { authorization });
			expect(status).toBe(401);
			expect(body).toMatchObject({
				message: "Bad credentials",
				documentation_url: expect.stringContaining("docs.github.com"),
			});
		}
	});

	it("401s a bad token even where an anonymous request would succeed", async () => {
		const { status } = await call("/users/alice", {
			authorization: "token pst_nope",
		});
		expect(status).toBe(401);
	});

	it("requires authentication for /user", async () => {
		const { status, body } = await call("/user");
		expect(status).toBe(401);
		expect(body.message).toBe("Requires authentication");
	});

	it("sends GitHub's media-type and JSON content-type headers", async () => {
		const { headers } = await call("/users/alice");
		expect(headers.get("content-type")).toBe("application/json; charset=utf-8");
		expect(headers.get("x-github-media-type")).toMatch(/^github\.v3/);
	});

	it("404s unknown routes with GitHub's error body", async () => {
		const { status, body } = await call("/nope");
		expect(status).toBe(404);
		expect(body).toMatchObject({ message: "Not Found", status: "404" });
	});
});

describe("request handling", () => {
	it("401s a bad token on an unknown route, and an expired token", async () => {
		expect(
			(await call("/nope", { authorization: "token pst_nope" })).status,
		).toBe(401);
		const expired = await mintToken(users.bob, ["repo:read"]);
		const { tokens: tokenTable } = await import("../../db/app-schema");
		const { hashToken } = await import("../../lib/token-scopes");
		await db
			.update(tokenTable)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(tokenTable.tokenHash, await hashToken(expired)));
		const { status, body } = await call("/user", asToken(expired));
		expect(status).toBe(401);
		expect(body.message).toBe("Bad credentials");
	});

	it("accepts Bearer on a write", async () => {
		const { status } = await call("/user/repos", {
			authorization: `Bearer ${alice}`,
			method: "POST",
			body: JSON.stringify({ name: "via-bearer" }),
		});
		expect(status).toBe(201);
		await db.delete(repoTable).where(eq(repoTable.name, "via-bearer"));
	});

	it("413s an oversized body, declared or streamed", async () => {
		const big = JSON.stringify({
			name: "x",
			description: "y".repeat(1_100_000),
		});
		const declared = await call("/user/repos", {
			...asToken(alice),
			method: "POST",
			body: big,
		});
		expect(declared.status).toBe(413);

		// A chunked body declares no length; the cap must stop the read itself.
		const chunk = new TextEncoder().encode("y".repeat(256 * 1024));
		let sent = 0;
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				sent += chunk.byteLength;
				controller.enqueue(chunk);
			},
		});
		const response = await handleApiRequest(
			new Request(`${BASE}/user/repos`, {
				method: "POST",
				headers: { authorization: `token ${alice}` },
				body: stream,
				// @ts-expect-error Node's fetch requires this for stream bodies
				duplex: "half",
			}),
		);
		expect(response.status).toBe(413);
		expect(sent).toBeLessThan(4 * 1024 * 1024);
	});

	it("sends a unique X-GitHub-Request-Id, on errors too", async () => {
		const a = await call("/user");
		const b = await call("/nope");
		expect(a.headers.get("x-github-request-id")).toMatch(/^[0-9a-f]{32}$/);
		expect(b.headers.get("x-github-request-id")).toMatch(/^[0-9a-f]{32}$/);
		expect(a.headers.get("x-github-request-id")).not.toBe(
			b.headers.get("x-github-request-id"),
		);
	});

	it("answers HEAD like GET without a body", async () => {
		const response = await handleApiRequest(
			new Request(`${BASE}/users/alice`, { method: "HEAD" }),
		);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("");
	});
});

describe("users", () => {
	it("returns the authenticated user without leaking the email", async () => {
		const { body } = await call("/user", asToken(alice));
		expect(body).toMatchObject({
			login: "alice",
			id: expect.any(Number),
			node_id: expect.any(String),
			type: "User",
			name: "Alice",
			email: null,
			html_url: "http://localhost:3000/alice",
			url: `${BASE}/users/alice`,
			public_repos: 0,
			total_private_repos: 0,
		});
		expect(body.created_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
		expect(JSON.stringify(body)).not.toContain("example.com");
	});

	it("returns a public profile, 404 for an unknown user", async () => {
		const { status, body } = await call("/users/bob");
		expect(status).toBe(200);
		expect(body).toMatchObject({ login: "bob", type: "User" });
		expect(body).not.toHaveProperty("total_private_repos");
		expect((await call("/users/nobody")).status).toBe(404);
		expect((await call("/users/..%2Fetc")).status).toBe(404);
	});

	it("gives users stable integer ids and looks them up by id", async () => {
		const a = (await call("/users/alice")).body;
		const b = (await call("/users/bob")).body;
		expect(Number.isInteger(a.id)).toBe(true);
		expect(a.id).not.toBe(b.id);
		expect((await call("/user", asToken(alice))).body.id).toBe(a.id);
		expect(Buffer.from(a.node_id, "base64").toString()).toBe(`04:User${a.id}`);
		const byId = await call(`/user/${b.id}`);
		expect(byId.status).toBe(200);
		expect(byId.body).toMatchObject({ login: "bob", id: b.id });
		expect(byId.body).not.toHaveProperty("total_private_repos");
		for (const bad of ["0", "-1", "99999999", "abc", "99999999999999"])
			expect((await call(`/user/${bad}`)).status).toBe(404);
	});

	it("serializes owners and authors with the integer id", async () => {
		const aliceId = (await call("/users/alice")).body.id;
		const repos = await call("/users/alice/repos", asToken(alice));
		for (const r of repos.body) expect(r.owner.id).toBe(aliceId);
	});
});

describe("creating repositories", () => {
	it("creates a public repository and serves it back", async () => {
		const { status, headers, body } = await call(
			"/user/repos",
			post(alice, { name: "proj", description: "A project" }),
		);
		expect(status).toBe(201);
		expect(headers.get("location")).toBe(`${BASE}/repos/alice/proj`);
		expect(body).toMatchObject({
			name: "proj",
			full_name: "alice/proj",
			private: false,
			visibility: "public",
			description: "A project",
			default_branch: "main",
			fork: false,
			html_url: "http://localhost:3000/alice/proj",
			url: `${BASE}/repos/alice/proj`,
			clone_url: "http://localhost:3000/api/git/alice/proj.git",
			stargazers_count: 0,
			owner: { login: "alice", type: "User" },
			permissions: { admin: true, push: true, pull: true },
		});

		const fetched = await call("/repos/alice/proj");
		expect(fetched.status).toBe(200);
		expect(fetched.body.id).toBe(body.id);
	});

	it("creates a private repository", async () => {
		const { status, body } = await call(
			"/user/repos",
			post(alice, { name: "secret", private: true }),
		);
		expect(status).toBe(201);
		expect(body).toMatchObject({ private: true, visibility: "private" });
	});

	it("422s a duplicate name like GitHub", async () => {
		const { status, body } = await call(
			"/user/repos",
			post(alice, { name: "proj" }),
		);
		expect(status).toBe(422);
		expect(body).toMatchObject({
			message: "Repository creation failed.",
			errors: [
				{
					resource: "Repository",
					code: "custom",
					field: "name",
					message: "name already exists on this account",
				},
			],
		});
	});

	it("422s a missing or invalid name", async () => {
		const missing = await call("/user/repos", post(alice, {}));
		expect(missing.status).toBe(422);
		expect(missing.body.errors).toEqual([
			{ resource: "Repository", field: "name", code: "missing_field" },
		]);
		const invalid = await call("/user/repos", post(alice, { name: "a/../b" }));
		expect(invalid.status).toBe(422);
		expect(invalid.body.errors).toEqual([
			{ resource: "Repository", field: "name", code: "invalid" },
		]);
	});

	it("400s a body that isn't a JSON object", async () => {
		for (const body of ["{nope", "[]", "null"]) {
			const result = await call("/user/repos", {
				...asToken(alice),
				method: "POST",
				body,
			});
			expect(result.status).toBe(400);
			expect(result.body.message).toBe("Problems parsing JSON");
		}
	});

	it("requires authentication and the repo:write scope", async () => {
		expect((await call("/user/repos", post("x", {}))).status).toBe(401);
		const anonymous = await call("/user/repos", {
			method: "POST",
			body: JSON.stringify({ name: "anon" }),
		});
		expect(anonymous.status).toBe(401);
		const readOnly = await call(
			"/user/repos",
			post(aliceRead, { name: "readonly" }),
		);
		expect(readOnly.status).toBe(403);
		expect(readOnly.body.message).toBe(
			"Resource not accessible by personal access token",
		);
	});
});

describe("repository visibility: 404, not 403", () => {
	it("serves a public repository anonymously", async () => {
		expect((await call("/repos/alice/proj")).status).toBe(200);
	});

	it("hides a private repository from anonymous and unrelated users", async () => {
		expect((await call("/repos/alice/secret")).status).toBe(404);
		expect((await call("/repos/alice/secret", asToken(bob))).status).toBe(404);
		expect((await call("/repos/alice/secret/branches")).status).toBe(404);
		expect((await call("/repos/alice/secret/tags", asToken(bob))).status).toBe(
			404,
		);
		expect((await call("/repos/alice/missing")).status).toBe(404);
	});

	it("shows a private repository to its owner", async () => {
		for (const token of [alice, aliceRead]) {
			const { status, body } = await call(
				"/repos/alice/secret",
				asToken(token),
			);
			expect(status).toBe(200);
			expect(body.private).toBe(true);
		}
	});

	it("shows a private repository to a collaborator with their permissions", async () => {
		signIn(users.alice);
		const { id } = (await call("/repos/alice/secret", asToken(alice))).body;
		await repositories.addCollaboratorByUsername({
			data: { repoId: id, username: "bob", role: "read" },
		});
		const { status, body } = await call("/repos/alice/secret", asToken(bob));
		expect(status).toBe(200);
		expect(body.permissions).toEqual({ admin: false, push: false, pull: true });
	});
});

describe("listing repositories", () => {
	it("lists the user's own and collaborated repositories, privates included", async () => {
		const mine = await call("/user/repos", asToken(alice));
		expect(mine.body.map((r: { full_name: string }) => r.full_name)).toEqual([
			"alice/proj",
			"alice/secret",
		]);
		const bobs = await call("/user/repos", asToken(bob));
		expect(bobs.body.map((r: { full_name: string }) => r.full_name)).toEqual([
			"alice/secret",
		]);
		expect(bobs.body[0].permissions).toEqual({
			admin: false,
			push: false,
			pull: true,
		});
	});

	it("filters /user/repos by visibility, affiliation and type", async () => {
		const names = (body: { name: string }[]) => body.map((r) => r.name);
		expect(
			names(
				(await call("/user/repos?visibility=private", asToken(alice))).body,
			),
		).toEqual(["secret"]);
		expect(
			names((await call("/user/repos?affiliation=owner", asToken(bob))).body),
		).toEqual([]);
		expect(
			names((await call("/user/repos?type=public", asToken(alice))).body),
		).toEqual(["proj"]);
		const conflict = await call(
			"/user/repos?type=all&visibility=public",
			asToken(alice),
		);
		expect(conflict.status).toBe(422);
		expect(
			(await call("/user/repos?visibility=bogus", asToken(alice))).status,
		).toBe(422);
	});

	it("lists only public repositories for /users/{username}/repos", async () => {
		const { status, body } = await call("/users/alice/repos");
		expect(status).toBe(200);
		expect(body.map((r: { name: string }) => r.name)).toEqual(["proj"]);
		const own = await call("/users/alice/repos", asToken(alice));
		expect(own.body.map((r: { name: string }) => r.name)).toEqual(["proj"]);
		expect((await call("/users/nobody/repos")).status).toBe(404);
	});

	it("sorts and paginates with a Link header", async () => {
		for (const name of ["page-a", "page-b", "page-c"]) {
			await call("/user/repos", post(alice, { name }));
		}
		const first = await call("/user/repos?per_page=2", asToken(alice));
		expect(first.body.map((r: { name: string }) => r.name)).toEqual([
			"page-a",
			"page-b",
		]);
		const link = first.headers.get("link") ?? "";
		expect(link).toContain(
			`<${"http://localhost:3000"}/api/v3/user/repos?per_page=2&page=2>; rel="next"`,
		);
		expect(link).toContain('page=3>; rel="last"');
		expect(link).not.toContain('rel="prev"');

		const last = await call("/user/repos?per_page=2&page=3", asToken(alice));
		expect(last.body.map((r: { name: string }) => r.name)).toEqual(["secret"]);
		const lastLink = last.headers.get("link") ?? "";
		expect(lastLink).toContain('rel="prev"');
		expect(lastLink).toContain('rel="first"');
		expect(lastLink).not.toContain('rel="next"');

		const beyond = await call("/user/repos?per_page=2&page=9", asToken(alice));
		expect(beyond.body).toEqual([]);

		const newest = await call(
			"/user/repos?sort=created&per_page=1",
			asToken(alice),
		);
		expect(newest.body[0].name).toBe("page-c");
		const oldest = await call(
			"/user/repos?sort=created&direction=asc&per_page=1",
			asToken(alice),
		);
		expect(oldest.body[0].name).toBe("proj");
	});

	it("omits Link when everything fits on one page, and falls back on bad paging params", async () => {
		const { headers, body } = await call("/users/alice/repos");
		expect(headers.get("link")).toBeNull();
		expect(body).toHaveLength(4);
		const bad = await call("/users/alice/repos?per_page=0&page=-3");
		expect(bad.status).toBe(200);
		expect(bad.body).toHaveLength(4);
	});

	it("caps per_page at 100 and rejects non-decimal paging values", async () => {
		const { pageParams } = await import("../api/http");
		const params = (query: string) => pageParams(new URLSearchParams(query));
		expect(params("per_page=1000").perPage).toBe(100);
		expect(params("per_page=1e1").perPage).toBe(30);
		expect(params("per_page=0x10&page= 5")).toMatchObject({
			perPage: 30,
			page: 1,
		});
		expect(params("per_page=100&page=3").offset).toBe(200);
		expect(params("per_page=100&page=102").reachable).toBe(false);
	});

	it("returns an empty list past the last page or the reachable depth", async () => {
		const { body } = await call("/users/alice/repos?page=2");
		expect(body).toEqual([]);
		const deep = await call("/users/alice/repos?per_page=100&page=500");
		expect(deep.body).toEqual([]);
		expect(deep.headers.get("link")).toBeNull();
	});
});

describe("branches and tags", () => {
	let repoId: number;
	let head: string;

	beforeAll(async () => {
		repoId = (await call("/repos/alice/proj")).body.id;
		signIn(users.alice);
		await files.uploadFile({
			data: {
				repoId,
				branchName: "main",
				path: "app.txt",
				content: btoa("hello\n"),
				commitMessage: "Initial\n\nBody",
			},
		});
		await files.createBranch({ data: { repoId, name: "feature/x" } });
	});

	it("lists branches with their tip commits", async () => {
		const { status, body } = await call("/repos/alice/proj/branches");
		expect(status).toBe(200);
		expect(body.map((b: { name: string }) => b.name)).toEqual([
			"feature/x",
			"main",
		]);
		head = body[1].commit.sha;
		expect(head).toMatch(/^[0-9a-f]{40}$/);
		expect(body[1]).toEqual({
			name: "main",
			commit: { sha: head, url: `${BASE}/repos/alice/proj/commits/${head}` },
			protected: false,
		});
	});

	it("lists no branches for an empty repository", async () => {
		await call("/user/repos", post(alice, { name: "empty" }));
		const { status, body } = await call("/repos/alice/empty/branches");
		expect(status).toBe(200);
		expect(body).toEqual([]);
	});

	it("returns one branch with its commit details", async () => {
		const { status, body } = await call("/repos/alice/proj/branches/main");
		expect(status).toBe(200);
		expect(body).toMatchObject({
			name: "main",
			protected: false,
			commit: {
				sha: head,
				comments_url: `${BASE}/repos/alice/proj/commits/${head}/comments`,
				commit: {
					message: "Initial\n\nBody\n",
					author: { name: expect.any(String), email: expect.any(String) },
					tree: { sha: expect.stringMatching(/^[0-9a-f]{40}$/) },
				},
				parents: [],
			},
			_links: {
				self: `${BASE}/repos/alice/proj/branches/main`,
				html: "http://localhost:3000/alice/proj/tree/main",
			},
		});
		expect(body.commit.commit.author.date).toMatch(
			/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/,
		);
	});

	it("resolves branch names containing slashes", async () => {
		const { status, body } = await call("/repos/alice/proj/branches/feature/x");
		expect(status).toBe(200);
		expect(body.name).toBe("feature/x");
		expect(body.commit.comments_url).toBe(
			`${BASE}/repos/alice/proj/commits/${body.commit.sha}/comments`,
		);
		const encoded = await call("/repos/alice/proj/branches/feature%2Fx");
		expect(encoded.status).toBe(200);
	});

	it("404s a missing or invalid branch", async () => {
		const missing = await call("/repos/alice/proj/branches/nope");
		expect(missing.status).toBe(404);
		expect(missing.body.message).toBe("Branch not found");
		expect((await call("/repos/alice/proj/branches/a..b")).status).toBe(404);
		expect(
			(await call("/repos/alice/proj/branches/..%2F..%2Fbob")).status,
		).toBe(404);
	});

	it("lists tags", async () => {
		expect((await call("/repos/alice/proj/tags")).body).toEqual([]);
		const git = (await import("isomorphic-git")).default;
		const { repoFor } = await import("../git-repo");
		const repo = repoFor("alice", "proj");
		await git.tag({ ...repo, ref: "v1.0", object: head });
		await git.annotatedTag({
			...repo,
			ref: "v2.0",
			object: head,
			message: "Release",
			tagger: { name: "T", email: "t@t.test" },
		});
		const { status, body } = await call("/repos/alice/proj/tags");
		expect(status).toBe(200);
		expect(body).toEqual(
			["v1.0", "v2.0"].map((name) => ({
				name,
				commit: { sha: head, url: `${BASE}/repos/alice/proj/commits/${head}` },
			})),
		);
	});

	it("paginates branches", async () => {
		const { body, headers } = await call(
			"/repos/alice/proj/branches?per_page=1",
		);
		expect(body).toHaveLength(1);
		expect(headers.get("link")).toContain('rel="next"');
	});
});

describe("repository initialization", () => {
	it("initializes with auto_init, gitignore_template and license_template", async () => {
		const { status } = await call(
			"/user/repos",
			post(alice, {
				name: "inited",
				auto_init: true,
				gitignore_template: "Node",
				license_template: "mit",
			}),
		);
		expect(status).toBe(201);
		const branch = await call("/repos/alice/inited/branches/main");
		expect(branch.status).toBe(200);
		expect(branch.body.commit.commit.message).toBe("Initial commit\n");
		const { id } = (await call("/repos/alice/inited")).body;
		signIn(users.alice);
		const readme = await files.getFile({
			data: { repoId: id, branchName: "main", path: "README.md" },
		});
		expect(JSON.stringify(readme)).toContain("inited");

		await call(
			"/user/repos",
			post(alice, { name: "tpl-only", license_template: "mit" }),
		);
		expect((await call("/repos/alice/tpl-only/branches")).body).toEqual([]);

		const bad = await call(
			"/user/repos",
			post(alice, { name: "bad-tpl", gitignore_template: "Nope" }),
		);
		expect(bad.status).toBe(422);
		expect(bad.body.errors[0].field).toBe("gitignore_template");
	});
});
