/**
 * @vitest-environment node
 *
 * Gist storage and git plumbing: init at `gists/{id}/git`, commits and reads
 * over `gist-git.ts`, and a clone of `/{id}.git` through the smart-HTTP
 * handler (receive-pack is refused).
 */
import fs, { promises as nodeFs } from "node:fs";
import os from "node:os";
import path from "node:path";
import git, { type HttpClient } from "isomorphic-git";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MAX_GIST_INLINE_CONTENT_BYTES } from "#/lib/limits";

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));

const { createUsers } = await import("../../test/app-harness");
const { db } = await import("../../db");
const { gists } = await import("../../db/app-schema");
const {
	applyGistUpdate,
	createGistFiles,
	gistCommitPage,
	gistRepoFor,
	initGistRepo,
	readGistFiles,
} = await import("../gist-git");
const { serveGistGitRequest } = await import("../git-http");
const { getGistGitStorageRoot } = await import("../git-storage-naming");

const GIST_ID = "0123456789abcdef0123456789abcdef";
const MISSING_ID = "fedcba9876543210fedcba9876543210";
const AUTHOR = { name: "Gist Owner", email: "gistowner@example.com" };
const CLONE_DIR = path.join(os.tmpdir(), `pushstack-gist-${Date.now()}`);
const BASE = "https://pushstack.test";

const users = await createUsers("gistowner");

/** isomorphic-git's HTTP transport, calling the handler in-process. */
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

const text = (bytes: Uint8Array | null) =>
	bytes === null ? null : new TextDecoder().decode(bytes);

const refOid = (ref: string) =>
	git.resolveRef({ ...gistRepoFor(GIST_ID), ref });

beforeAll(async () => {
	await db.insert(gists).values({
		id: GIST_ID,
		ownerId: users.gistowner.id,
		description: "storage test",
		visibility: "secret",
	});
	await initGistRepo(GIST_ID);
}, 60_000);

afterAll(async () => {
	await nodeFs.rm(CLONE_DIR, { recursive: true, force: true }).catch(() => {});
});

describe("gist storage", () => {
	it("initialises a bare repository on master under gists/{id}/git", async () => {
		expect(getGistGitStorageRoot(GIST_ID)).toBe(`gists/${GIST_ID}/git`);
		expect(
			await git.currentBranch({ ...gistRepoFor(GIST_ID), fullname: false }),
		).toBe("master");
	});

	it("commits the first files as one revision", async () => {
		const oid = await createGistFiles(
			GIST_ID,
			[
				{ path: "hello.txt", content: "hello\n" },
				{ path: "dir/notes.md", content: "# notes\n" },
			],
			AUTHOR,
		);
		expect(oid).toMatch(/^[0-9a-f]{40}$/);
		expect(await refOid("refs/heads/master")).toBe(oid);

		const files = await readGistFiles(GIST_ID);
		expect(files.map((file) => file.path).sort()).toEqual([
			"dir/notes.md",
			"hello.txt",
		]);
		expect(files.find((file) => file.path === "hello.txt")).toMatchObject({
			size: 6,
			truncated: false,
		});
		expect(
			text(files.find((file) => file.path === "hello.txt")?.content ?? null),
		).toBe("hello\n");
	});

	it("reads the first commit back at its revision", async () => {
		const page = await gistCommitPage(GIST_ID, 10);
		const first = page.at(-1);
		expect(first?.commit.commit.message.trim()).toBe("");
		const files = await readGistFiles(GIST_ID, first?.commit.oid);
		expect(files.map((file) => file.path).sort()).toEqual([
			"dir/notes.md",
			"hello.txt",
		]);
	});

	it("renames and deletes files in one new commit", async () => {
		const before = await refOid("refs/heads/master");
		const oid = await applyGistUpdate(
			GIST_ID,
			{
				files: [{ path: "renamed.txt", content: "hello\n" }],
				deletes: ["hello.txt"],
			},
			AUTHOR,
		);
		expect(oid).not.toBe(before);
		expect(await refOid("refs/heads/master")).toBe(oid);

		const page = await gistCommitPage(GIST_ID, 10);
		expect(page).toHaveLength(2);
		expect(page[0]?.commit.oid).toBe(oid);
		expect(page[0]?.commit.commit.message.trim()).toBe("");
		expect(page[0]?.changeStatus.total).toBeGreaterThan(0);

		const files = await readGistFiles(GIST_ID);
		expect(files.map((file) => file.path).sort()).toEqual([
			"dir/notes.md",
			"renamed.txt",
		]);
		expect(await readGistFiles(GIST_ID, before)).toHaveLength(2);
	});

	it("refuses an update that changes nothing", async () => {
		await expect(applyGistUpdate(GIST_ID, {}, AUTHOR)).rejects.toThrow(
			/needs a file change/,
		);
	});

	it("lists a file over the inline budget without its content", async () => {
		const big = new Uint8Array(MAX_GIST_INLINE_CONTENT_BYTES + 1).fill(97);
		await applyGistUpdate(
			GIST_ID,
			{ files: [{ path: "big.txt", content: big }] },
			AUTHOR,
		);

		const files = await readGistFiles(GIST_ID);
		expect(files.find((file) => file.path === "big.txt")).toMatchObject({
			size: MAX_GIST_INLINE_CONTENT_BYTES + 1,
			truncated: true,
			content: null,
		});
	});
});

describe("clone at /{id}.git", () => {
	const infoRefs = (id: string) =>
		serveGistGitRequest(
			new Request(`${BASE}/${id}.git/info/refs?service=git-upload-pack`),
		);

	it("advertises refs/heads/master at both clone URLs", async () => {
		for (const url of [`${BASE}/${GIST_ID}.git`, `${BASE}/gist/${GIST_ID}.git`])
			expect(
				(
					await serveGistGitRequest(
						new Request(`${url}/info/refs?service=git-upload-pack`),
					)
				).status,
			).toBe(200);
		const response = await infoRefs(GIST_ID);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe(
			"application/x-git-upload-pack-advertisement",
		);
		const body = new TextDecoder().decode(await response.arrayBuffer());
		expect(body).toContain("# service=git-upload-pack");
		expect(body).toContain("refs/heads/master");
	});

	it("answers 404 for an id with no storage", async () => {
		expect((await infoRefs(MISSING_ID)).status).toBe(404);
	});

	it("refuses receive-pack", async () => {
		const response = await serveGistGitRequest(
			new Request(`${BASE}/${GIST_ID}.git/git-receive-pack`, {
				method: "POST",
				body: new Uint8Array(),
			}),
		);
		expect(response.status).toBe(403);
	});

	it("clones the gist and checks out its files", async () => {
		await git.clone({
			fs,
			http,
			dir: CLONE_DIR,
			url: `${BASE}/${GIST_ID}.git`,
		});
		expect(
			await nodeFs.readFile(path.join(CLONE_DIR, "renamed.txt"), "utf8"),
		).toBe("hello\n");
		expect(
			await nodeFs.readFile(path.join(CLONE_DIR, "dir/notes.md"), "utf8"),
		).toBe("# notes\n");
		expect(
			await git.currentBranch({ fs, dir: CLONE_DIR, fullname: false }),
		).toBe("master");
	});
});
