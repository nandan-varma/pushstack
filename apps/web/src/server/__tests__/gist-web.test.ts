/**
 * @vitest-environment node
 *
 * The gist web pages' data: a page's files with contents and languages for a
 * public and a secret gist (anonymous included), a revision page returning
 * that revision's files, the raw route's exact bytes and its 404, and the
 * redirect decision between a gist pair and a repository pair.
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

const { createUsers, signIn, signOut } = await import("../../test/app-harness");
const users = await createUsers("alice", "bob");
const { applyGistUpdate, createGistFiles, initGistRepo } = await import(
	"../gist-git"
);
const { generateGistId, insertGist } = await import("../gist-store");
const { getGistPage, gistPathTarget } = await import("../gists");
const { serveGistRawFile } = await import("../gist-raw");

const BASE = "https://pushstack.test";
const AUTHOR = { name: "Alice", email: "alice@example.com" };

let publicId: string;
let secretId: string;
let firstSha: string;

async function createGist(
	visibility: "public" | "secret",
	description: string,
	files: { path: string; content: string }[],
): Promise<string> {
	const id = generateGistId();
	await initGistRepo(id);
	const sha = await createGistFiles(id, files, AUTHOR);
	await insertGist({
		id,
		ownerId: users.alice.id,
		description,
		visibility,
	});
	if (visibility === "public") firstSha = sha;
	return id;
}

beforeAll(async () => {
	publicId = await createGist("public", "a public gist", [
		{ path: "hello.ts", content: "export const hello = 1;\n" },
	]);
	secretId = await createGist("secret", "a secret gist", [
		{ path: "hidden.txt", content: "unlisted\n" },
	]);
	signIn(users.alice);
});

describe("gist page", () => {
	it("returns the files, contents and languages of a public gist", async () => {
		const page = await getGistPage({
			data: { owner: "alice", id: publicId },
		});
		expect(page.gist).toMatchObject({
			id: publicId,
			description: "a public gist",
			visibility: "public",
			owner: { username: "alice" },
		});
		expect(page.files).toEqual([
			{
				path: "hello.ts",
				size: 24,
				truncated: false,
				language: "typescript",
				content: "export const hello = 1;\n",
			},
		]);
		expect(page.revisions[0]?.sha).toBe(firstSha);
	});

	it("reads a secret gist and its comments anonymously", async () => {
		signOut();
		const page = await getGistPage({ data: { owner: "alice", id: secretId } });
		expect(page.gist.visibility).toBe("secret");
		expect(page.files.map((file) => file.path)).toEqual(["hidden.txt"]);
		expect(page.files[0]?.content).toBe("unlisted\n");
		expect(page.canWrite).toBe(false);
	});

	it("returns a revision's own files", async () => {
		signIn(users.alice);
		const sha = await applyGistUpdate(
			publicId,
			{
				files: [{ path: "hello.ts", content: "export const hello = 2;\n" }],
			},
			AUTHOR,
		);
		const page = await getGistPage({
			data: { owner: "alice", id: publicId, revision: sha },
		});
		expect(page.revision).toBe(sha);
		expect(page.files[0]?.content).toBe("export const hello = 2;\n");
		const first = await getGistPage({
			data: { owner: "alice", id: publicId, revision: firstSha },
		});
		expect(first.files[0]?.content).toBe("export const hello = 1;\n");
	});

	it("404s a gist the pair does not name", async () => {
		await expect(
			getGistPage({ data: { owner: "bob", id: publicId } }),
		).rejects.toThrow();
	});
});

describe("raw gist file", () => {
	const raw = (revision: string, path: string) =>
		serveGistRawFile(
			new Request(
				`${BASE}/gist/alice/${publicId}/raw/${revision}/${encodeURIComponent(path)}`,
			),
		);

	it("returns the file's exact bytes with a content type", async () => {
		const response = await raw("HEAD", "hello.ts");
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe(
			"text/plain; charset=utf-8",
		);
		expect(await response.text()).toBe("export const hello = 2;\n");
	});

	it("serves a pinned revision", async () => {
		const response = await raw(firstSha, "hello.ts");
		expect(await response.text()).toBe("export const hello = 1;\n");
	});

	it("404s an unknown file", async () => {
		const response = await raw("HEAD", "missing.txt");
		expect(response.status).toBe(404);
	});
});

describe("redirect decision", () => {
	it("names a gist pair a gist", async () => {
		expect(
			await gistPathTarget({ data: { owner: "alice", name: publicId } }),
		).toBe("gist");
	});

	it("names anything else a repository", async () => {
		expect(
			await gistPathTarget({ data: { owner: "alice", name: "hello" } }),
		).toBe("repository");
		expect(
			await gistPathTarget({ data: { owner: "bob", name: publicId } }),
		).toBe("repository");
	});
});
