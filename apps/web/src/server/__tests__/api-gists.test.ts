/**
 * @vitest-environment node
 *
 * Gists over `/api/v3`: create (201 with Location and file contents), the four
 * lists, anonymous reads of secret gists, PATCH update/rename/delete revisions,
 * revision reads, delete, the `gist` token scope, and that a gist-only token
 * cannot read repositories.
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
const users = await createUsers("alice", "bob");
const { asToken, call, mintToken, patch, post } = await import(
	"../../test/api-client"
);
const { db } = await import("#/db");
const { gistStars } = await import("#/db/app-schema");
const { gistCommitPage } = await import("../gist-git");
const { serveGitRequest } = await import("../git-http");

const BASE = "http://localhost:3000";
const UNKNOWN_SHA = "0".repeat(40);

let token: string;
let repoToken: string;
let gistToken: string;
let publicId: string;
let secretId: string;

const deleteRequest = (auth: string) => ({
	...asToken(auth),
	method: "DELETE",
});

const revisions = async (id: string) =>
	(await gistCommitPage(id, 100)).map((entry) => entry.commit.oid);

beforeAll(async () => {
	token = await mintToken(users.alice, ["repo:write", "gist"]);
	repoToken = await mintToken(users.alice, ["repo:write"]);
	gistToken = await mintToken(users.alice, ["gist"]);
	await call(
		"/user/repos",
		post(repoToken, { name: "private", private: true }),
	);
});

describe("gist lifecycle", () => {
	it("creates a public gist with its files and a Location", async () => {
		const { status, headers, body } = await call(
			"/gists",
			post(token, {
				description: "a public gist",
				public: true,
				files: {
					"hello.txt": { content: "hello\n" },
					"notes.md": { content: "# notes\n" },
				},
			}),
		);
		expect(status).toBe(201);
		expect(headers.get("location")).toBe(body.url);
		expect(body).toMatchObject({
			id: expect.stringMatching(/^[0-9a-f]{32}$/),
			public: true,
			description: "a public gist",
			owner: { login: "alice" },
			files: {
				"hello.txt": {
					filename: "hello.txt",
					size: 6,
					content: "hello\n",
					truncated: false,
				},
				"notes.md": {
					filename: "notes.md",
					language: "markdown",
					content: "# notes\n",
				},
			},
			fork_of: null,
		});
		expect(body.url).toBe(`${BASE}/api/v3/gists/${body.id}`);
		expect(body.html_url).toBe(`${BASE}/alice/${body.id}`);
		expect(body.git_pull_url).toBe(`${BASE}/${body.id}.git`);
		publicId = body.id;
	});

	it("creates a secret gist by default and reads it anonymously", async () => {
		const created = await call(
			"/gists",
			post(token, { files: { "secret.txt": { content: "hidden\n" } } }),
		);
		expect(created.status).toBe(201);
		expect(created.body.public).toBe(false);
		secretId = created.body.id;

		const read = await call(`/gists/${secretId}`);
		expect(read.status).toBe(200);
		expect(read.body.files["secret.txt"].content).toBe("hidden\n");
	});

	it("lists the caller's gists, public gists and a user's public gists", async () => {
		const mine = await call("/gists", asToken(token));
		expect(mine.status).toBe(200);
		expect(mine.body.map((gist: { id: string }) => gist.id).sort()).toEqual(
			[publicId, secretId].sort(),
		);

		const publicList = await call("/gists/public");
		expect(publicList.status).toBe(200);
		expect(publicList.body.map((gist: { id: string }) => gist.id)).toContain(
			publicId,
		);
		expect(
			publicList.body.map((gist: { id: string }) => gist.id),
		).not.toContain(secretId);

		const byUser = await call("/users/alice/gists");
		expect(byUser.body.map((gist: { id: string }) => gist.id)).toContain(
			publicId,
		);
		expect(byUser.body.map((gist: { id: string }) => gist.id)).not.toContain(
			secretId,
		);
		expect((await call("/users/missing/gists")).status).toBe(404);
	});

	it("lists starred gists", async () => {
		expect((await call("/gists/starred", asToken(token))).body).toEqual([]);
		await db.insert(gistStars).values({
			gistId: publicId,
			userId: users.alice.id,
		});
		const starred = await call("/gists/starred", asToken(token));
		expect(starred.status).toBe(200);
		expect(starred.body.map((gist: { id: string }) => gist.id)).toEqual([
			publicId,
		]);
		expect((await call("/gists/starred")).status).toBe(401);
	});

	it("updates, renames and deletes files in one revision each", async () => {
		expect(await revisions(publicId)).toHaveLength(1);

		const edited = await call(
			`/gists/${publicId}`,
			patch(token, { files: { "hello.txt": { content: "HELLO\n" } } }),
		);
		expect(edited.status).toBe(200);
		expect(edited.body.files["hello.txt"].content).toBe("HELLO\n");
		const afterEdit = await revisions(publicId);
		expect(afterEdit).toHaveLength(2);
		const firstRevision = afterEdit[1] as string;

		const old = await call(`/gists/${publicId}/${firstRevision}`);
		expect(old.status).toBe(200);
		expect(old.body.files["hello.txt"].content).toBe("hello\n");
		expect(old.body.files["notes.md"].content).toBe("# notes\n");

		const renamed = await call(
			`/gists/${publicId}`,
			patch(token, { files: { "notes.md": { filename: "renamed.md" } } }),
		);
		expect(renamed.status).toBe(200);
		expect(Object.keys(renamed.body.files).sort()).toEqual([
			"hello.txt",
			"renamed.md",
		]);
		expect(renamed.body.files["renamed.md"].content).toBe("# notes\n");
		expect(await revisions(publicId)).toHaveLength(3);

		const deleted = await call(
			`/gists/${publicId}`,
			patch(token, { files: { "renamed.md": null } }),
		);
		expect(deleted.status).toBe(200);
		expect(Object.keys(deleted.body.files)).toEqual(["hello.txt"]);
		expect(await revisions(publicId)).toHaveLength(4);

		expect((await call(`/gists/${publicId}/${UNKNOWN_SHA}`)).status).toBe(404);
	});

	it("accepts POST for an update, as gh sends it", async () => {
		const updated = await call(
			`/gists/${publicId}`,
			post(token, { description: "posted" }),
		);
		expect(updated.status).toBe(200);
		expect(updated.body.description).toBe("posted");
	});

	it("deletes a gist, then answers 404", async () => {
		const deleted = await call(`/gists/${secretId}`, deleteRequest(token));
		expect(deleted.status).toBe(204);
		expect((await call(`/gists/${secretId}`)).status).toBe(404);
	});
});

describe("gist token scope", () => {
	it("refuses every write without the gist scope", async () => {
		expect(
			(
				await call(
					"/gists",
					post(repoToken, { files: { "x.txt": { content: "x" } } }),
				)
			).status,
		).toBe(403);
		expect(
			(
				await call(
					`/gists/${publicId}`,
					patch(repoToken, {
						files: { "hello.txt": { content: "no\n" } },
					}),
				)
			).status,
		).toBe(403);
		expect(
			(await call(`/gists/${publicId}`, deleteRequest(repoToken))).status,
		).toBe(403);
	});

	it("advertises the gist scope and keeps a gist-only token out of repositories", async () => {
		const gistOnly = await call("/gists/public", asToken(gistToken));
		expect(gistOnly.headers.get("X-OAuth-Scopes")).toBe("gist");
		expect(
			(gistOnly.headers.get("X-OAuth-Scopes") ?? "").split(", "),
		).toContain("gist");
		const both = await call("/gists", asToken(token));
		expect(both.headers.get("X-OAuth-Scopes")).toContain("gist");
		expect(both.headers.get("X-OAuth-Scopes")).toContain("repo");

		const clone = await serveGitRequest(
			new Request(
				`${BASE}/alice/private.git/info/refs?service=git-upload-pack`,
				{
					headers: { authorization: `Basic ${btoa(`alice:${gistToken}`)}` },
				},
			),
		);
		expect(clone.status).toBe(403);
	});
});
