/**
 * @vitest-environment node
 *
 * A gist's stars, forks, commits and comments over `/api/v3`: 204/404 starred
 * checks, idempotent star and unstar, a fork that copies `master` (cloned back
 * over smart HTTP) and is listed by the parent, commits with their version and
 * change status, and comment create/get/update/delete with the author
 * association and GitHub's 65,535-character body cap.
 */
import fs, { promises as nodeFs } from "node:fs";
import os from "node:os";
import path from "node:path";
import git, { type HttpClient } from "isomorphic-git";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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
const { serveGistGitRequest } = await import("../git-http");

const BASE = "http://localhost:3000";
const MISSING_ID = "f".repeat(32);
const CLONE_DIR = path.join(os.tmpdir(), `pushstack-gist-fork-${Date.now()}`);

/** isomorphic-git's transport, calling the gist smart-HTTP handler in-process. */
const http: HttpClient = {
	async request({ url, method = "GET", headers = {}, body }) {
		const chunks: Uint8Array[] = [];
		if (body) for await (const chunk of body) chunks.push(chunk);
		const response = await serveGistGitRequest(
			new Request(url, {
				method,
				headers: { ...headers } as Record<string, string>,
				body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
			}),
		);
		const responseHeaders: Record<string, string> = {};
		response.headers.forEach((value, key) => {
			responseHeaders[key] = value;
		});
		return {
			url,
			method,
			statusCode: response.status,
			statusMessage: response.statusText,
			headers: responseHeaders,
			body: (async function* () {
				yield new Uint8Array(await response.arrayBuffer());
			})(),
		};
	},
};

let alice: string;
let bob: string;
let repoOnly: string;
let gistId: string;
let forkId: string;
let commentId: number;

const put = (token: string) => ({ ...asToken(token), method: "PUT" });
const del = (token: string) => ({ ...asToken(token), method: "DELETE" });
const postEmpty = (token: string) => ({ ...asToken(token), method: "POST" });

beforeAll(async () => {
	alice = await mintToken(users.alice, ["gist"]);
	bob = await mintToken(users.bob, ["gist"]);
	repoOnly = await mintToken(users.bob, ["repo:write"]);
	const created = await call(
		"/gists",
		post(alice, {
			public: true,
			files: { "hello.txt": { content: "hello\n" } },
		}),
	);
	expect(created.status).toBe(201);
	gistId = created.body.id;
});

afterAll(async () => {
	await nodeFs.rm(CLONE_DIR, { recursive: true, force: true }).catch(() => {});
});

describe("gist stars", () => {
	it("stars, checks, unstars and stays idempotent", async () => {
		expect((await call(`/gists/${gistId}/star`)).status).toBe(401);
		expect((await call(`/gists/${gistId}/star`, put(repoOnly))).status).toBe(
			403,
		);
		expect((await call(`/gists/${MISSING_ID}/star`, put(bob))).status).toBe(
			404,
		);

		expect((await call(`/gists/${gistId}/star`, asToken(bob))).status).toBe(
			404,
		);
		expect((await call(`/gists/${gistId}/star`, put(bob))).status).toBe(204);
		expect((await call(`/gists/${gistId}/star`, asToken(bob))).status).toBe(
			204,
		);
		// A second star is not an error.
		expect((await call(`/gists/${gistId}/star`, put(bob))).status).toBe(204);

		expect((await call(`/gists/${gistId}/star`, del(bob))).status).toBe(204);
		expect((await call(`/gists/${gistId}/star`, asToken(bob))).status).toBe(
			404,
		);
	});
});

describe("gist commits", () => {
	it("reports each revision's version, committed_at and change status", async () => {
		const initial = await call(`/gists/${gistId}/commits`);
		expect(initial.status).toBe(200);
		expect(initial.body).toHaveLength(1);
		const [first] = initial.body;
		expect(first.version).toMatch(/^[0-9a-f]{40}$/);
		expect(first.url).toBe(`${BASE}/api/v3/gists/${gistId}/${first.version}`);
		expect(first.user).toMatchObject({ login: "alice" });
		expect(first.committed_at).toMatch(/Z$/);
		expect(first.change_status.additions).toBeGreaterThan(0);

		const edited = await call(
			`/gists/${gistId}`,
			patch(alice, { files: { "hello.txt": { content: "hello\nworld\n" } } }),
		);
		expect(edited.status).toBe(200);

		const after = await call(`/gists/${gistId}/commits`);
		expect(after.body).toHaveLength(2);
		expect(after.body[0].change_status).toEqual({
			total: 3,
			additions: 2,
			deletions: 1,
		});
		expect(after.body[1].version).toBe(first.version);
	});
});

describe("gist forks", () => {
	it("forks the gist, copies master and lists the fork", async () => {
		expect(
			(await call(`/gists/${MISSING_ID}/forks`, postEmpty(bob))).status,
		).toBe(404);
		expect(
			(await call(`/gists/${gistId}/forks`, postEmpty(repoOnly))).status,
		).toBe(403);

		const forked = await call(`/gists/${gistId}/forks`, postEmpty(bob));
		expect(forked.status).toBe(201);
		expect(forked.headers.get("location")).toBe(forked.body.url);
		expect(forked.body).toMatchObject({
			id: expect.stringMatching(/^[0-9a-f]{32}$/),
			public: true,
			owner: { login: "bob" },
			fork_of: { id: gistId, owner: { login: "alice" } },
		});
		expect(forked.body.files["hello.txt"].content).toBe("hello\nworld\n");
		forkId = forked.body.id;

		await git.clone({
			fs,
			http,
			dir: CLONE_DIR,
			url: `${BASE}/${forkId}.git`,
		});
		expect(
			await nodeFs.readFile(path.join(CLONE_DIR, "hello.txt"), "utf8"),
		).toBe("hello\nworld\n");
		expect(
			await git.currentBranch({ fs, dir: CLONE_DIR, fullname: false }),
		).toBe("master");

		const forks = await call(`/gists/${gistId}/forks`);
		expect(forks.status).toBe(200);
		expect(forks.body.map((fork: { id: string }) => fork.id)).toEqual([forkId]);
		expect(forks.body[0].owner.login).toBe("bob");
		expect((await call(`/gists/${forkId}`)).body.fork_of.id).toBe(gistId);
	});
});

describe("gist comments", () => {
	it("creates, reads, updates and deletes a comment", async () => {
		const anonymous = {
			method: "POST",
			body: JSON.stringify({ body: "no token" }),
		};
		expect((await call(`/gists/${gistId}/comments`, anonymous)).status).toBe(
			401,
		);
		expect(
			(await call(`/gists/${gistId}/comments`, post(repoOnly, { body: "x" })))
				.status,
		).toBe(403);

		const created = await call(
			`/gists/${gistId}/comments`,
			post(bob, { body: "  nice gist  " }),
		);
		expect(created.status).toBe(201);
		expect(created.body).toMatchObject({
			body: "nice gist",
			user: { login: "bob" },
			author_association: "NONE",
		});
		expect(created.headers.get("location")).toBe(created.body.url);
		commentId = created.body.id;

		const byOwner = await call(
			`/gists/${gistId}/comments`,
			post(alice, { body: "thanks" }),
		);
		expect(byOwner.body.author_association).toBe("OWNER");

		const listed = await call(`/gists/${gistId}/comments`);
		expect(listed.status).toBe(200);
		expect(listed.body.map((comment: { id: number }) => comment.id)).toEqual([
			commentId,
			byOwner.body.id,
		]);
		expect((await call(`/gists/${gistId}`)).body.comments).toBe(2);

		const read = await call(`/gists/${gistId}/comments/${commentId}`);
		expect(read.status).toBe(200);
		expect(read.body.body).toBe("nice gist");

		// Another gist's comment, and someone else's comment, are both 404.
		expect((await call(`/gists/${forkId}/comments/${commentId}`)).status).toBe(
			404,
		);
		expect(
			(
				await call(
					`/gists/${gistId}/comments/${commentId}`,
					patch(alice, { body: "hijack" }),
				)
			).status,
		).toBe(404);
		expect(
			(await call(`/gists/${gistId}/comments/${commentId}`, del(alice))).status,
		).toBe(404);

		const updated = await call(
			`/gists/${gistId}/comments/${commentId}`,
			patch(bob, { body: "great" }),
		);
		expect(updated.status).toBe(200);
		expect(updated.body.body).toBe("great");

		const tooLong = "x".repeat(65_536);
		expect(
			(await call(`/gists/${gistId}/comments`, post(bob, { body: tooLong })))
				.status,
		).toBe(422);
		expect(
			(
				await call(
					`/gists/${gistId}/comments/${commentId}`,
					patch(bob, { body: tooLong }),
				)
			).status,
		).toBe(422);
		expect(
			(
				await call(
					`/gists/${gistId}/comments/${commentId}`,
					patch(bob, { body: "x".repeat(65_535) }),
				)
			).status,
		).toBe(200);

		expect(
			(await call(`/gists/${gistId}/comments/${commentId}`, del(bob))).status,
		).toBe(204);
		expect((await call(`/gists/${gistId}/comments/${commentId}`)).status).toBe(
			404,
		);
	});
});
