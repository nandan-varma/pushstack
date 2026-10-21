/**
 * @vitest-environment node
 *
 * The REST API's custom media types (`Accept: application/vnd.github.*`) for
 * contents, commits and comparisons; paging a commit's files; and the commit
 * list's author/committer/since/until filters.
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
const users = await createUsers("alice");
const { BASE, call, mintToken, post } = await import("../../test/api-client");
const { handleApiRequest } = await import("../api");
const { createCommit } = await import("../git-write");
const caps = await import("../api/caps");

let alice: string;
let first: string;
let second: string;

/** A raw request with an Accept header; non-JSON bodies come back as text. */
async function accept(path: string, mediaType: string) {
	const response = await handleApiRequest(
		new Request(`${BASE}${path}`, { headers: { accept: mediaType } }),
	);
	return {
		status: response.status,
		headers: response.headers,
		text: await response.text(),
	};
}

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	await call("/user/repos", post(alice, { name: "proj", auto_init: true }));
	first = await createCommit("alice", "proj", {
		branch: "main",
		message: "Add notes\n\nWith a body.",
		files: [
			{ path: "docs/notes.txt", content: "one\ntwo\n" },
			{ path: "bin.dat", content: new Uint8Array([0, 1, 2, 3]) },
		],
		author: { name: "Robot", email: "robot@example.org" },
	});
	second = await createCommit("alice", "proj", {
		branch: "main",
		message: "Edit notes",
		files: [{ path: "docs/notes.txt", content: "one\nTWO\n" }],
		author: { name: "Alice", email: users.alice.email },
	});
});

describe("contents", () => {
	it("serves raw bytes with the raw media type", async () => {
		const raw = await accept(
			"/repos/alice/proj/contents/docs/notes.txt",
			"application/vnd.github.raw+json",
		);
		expect(raw.status).toBe(200);
		expect(raw.text).toBe("one\nTWO\n");
		expect(raw.headers.get("content-type")).toBe("application/octet-stream");
		expect(raw.headers.get("x-content-type-options")).toBe("nosniff");
		expect(raw.headers.get("x-github-media-type")).toBe(
			"github.v3; format=raw",
		);
	});

	it("serves a directory as one object with the object media type", async () => {
		const object = await accept(
			"/repos/alice/proj/contents/docs",
			"application/vnd.github.object",
		);
		const body = JSON.parse(object.text);
		expect(body).toMatchObject({ type: "dir", path: "docs", name: "docs" });
		expect(body.entries.map((e: { name: string }) => e.name)).toEqual([
			"notes.txt",
		]);
	});
});

describe("commits", () => {
	it("serves a commit as a diff, a patch or its sha", async () => {
		const diff = await accept(
			`/repos/alice/proj/commits/${second}`,
			"application/vnd.github.diff",
		);
		expect(diff.status).toBe(200);
		expect(diff.headers.get("content-type")).toBe("text/plain; charset=utf-8");
		expect(diff.text).toContain("diff --git a/docs/notes.txt b/docs/notes.txt");
		expect(diff.text).toContain("-two\n+TWO\n");

		const patch = await accept(
			`/repos/alice/proj/commits/${first}`,
			"application/vnd.github.patch",
		);
		expect(patch.text).toMatch(
			new RegExp(`^From ${first} Mon Sep 17 00:00:00 2001\n`),
		);
		expect(patch.text).toContain(
			"Subject: [PATCH] Add notes\n\nWith a body.\n---\n",
		);
		expect(patch.text).toContain("Binary files /dev/null and b/bin.dat differ");
		expect(patch.text).not.toContain("robot@example.org");

		const sha = await accept(
			"/repos/alice/proj/commits/main",
			"application/vnd.github.sha",
		);
		expect(sha.text).toBe(second);
	});

	it("pages a commit's files past the default cap", async () => {
		caps.apiCaps.diffFiles = 1;
		try {
			const plain = await call(`/repos/alice/proj/commits/${first}`);
			expect(plain.body.files).toHaveLength(1);
			const page2 = await call(
				`/repos/alice/proj/commits/${first}?per_page=1&page=2`,
			);
			expect(page2.body.files).toHaveLength(1);
			expect(page2.body.files[0].filename).not.toBe(
				plain.body.files[0].filename,
			);
			expect(page2.headers.get("link")).toContain('rel="prev"');
		} finally {
			caps.apiCaps.diffFiles = caps.DEFAULT_API_CAPS.diffFiles;
		}
	});

	it("serves a comparison as a diff and as patches", async () => {
		const diff = await accept(
			`/repos/alice/proj/compare/${first}...${second}`,
			"application/vnd.github.diff",
		);
		expect(diff.text).toContain("-two\n+TWO\n");
		expect(diff.text).not.toContain("bin.dat");
		const parent = (await call(`/repos/alice/proj/commits/${first}`)).body
			.parents[0].sha;
		const patches = await accept(
			`/repos/alice/proj/compare/${parent}...main`,
			"application/vnd.github.patch",
		);
		expect(patches.text).toContain("Subject: [PATCH 1/2] Add notes");
		expect(patches.text).toContain("Subject: [PATCH 2/2] Edit notes");
	});
});

describe("commit filters", () => {
	const shas = async (query: string) =>
		(await call(`/repos/alice/proj/commits?${query}`)).body.map(
			(c: { sha: string }) => c.sha,
		);

	it("filters by author email or login, and by date", async () => {
		expect(await shas("author=robot@example.org")).toEqual([first]);
		expect(await shas("author=alice")).toContain(second);
		expect(await shas("author=alice")).not.toContain(first);
		expect(await shas("author=nobody-here")).toEqual([]);
		expect(await shas("committer=robot@example.org")).toEqual([first]);
		expect(await shas("since=2999-01-01T00:00:00Z")).toEqual([]);
		expect(await shas("until=2000-01-01T00:00:00Z")).toEqual([]);
		expect((await shas("since=2000-01-01T00:00:00Z")).slice(0, 2)).toEqual([
			second,
			first,
		]);
		expect(await shas("author=robot@example.org&path=docs/notes.txt")).toEqual([
			first,
		]);
		expect(
			(await call("/repos/alice/proj/commits?since=yesterday")).status,
		).toBe(422);
	});
});
