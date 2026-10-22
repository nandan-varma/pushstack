/**
 * @vitest-environment node
 *
 * git-http.ts: URL routing, the streamed body cap, and request handling
 * through serveGitRequest (real Postgres via pglite, in-memory git storage).
 * Full clone/fetch/push flows are covered by git-user-lifecycle.test.ts and
 * the native-git smoke test.
 */
import { gzipSync } from "node:zlib";
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
const { parseGitUrl, readGitRequestBody, serveGitRequest } = await import(
	"../git-http"
);
const { createRepository } = await import("../repositories");

const BASE = "http://localhost:3000";

describe("parseGitUrl", () => {
	it("routes the ref advertisement and both services", () => {
		expect(
			parseGitUrl(`${BASE}/alice/repo.git/info/refs?service=git-upload-pack`),
		).toEqual({
			owner: "alice",
			repo: "repo",
			service: "git-upload-pack",
			isInfoRefs: true,
		});
		expect(parseGitUrl(`${BASE}/alice/repo/git-receive-pack`)).toEqual({
			owner: "alice",
			repo: "repo",
			service: "git-receive-pack",
			isInfoRefs: false,
		});
	});

	it("accepts dotted owner and repository names", () => {
		expect(
			parseGitUrl(`${BASE}/a.b/my.repo.git/git-upload-pack`),
		).toMatchObject({
			owner: "a.b",
			repo: "my.repo",
		});
	});

	it.each([
		`${BASE}/`,
		`${BASE}/alice`,
		`${BASE}/alice/repo.git/info/refs?service=git-unknown`,
		`${BASE}/alice/repo.git/objects/info/packs`,
		`${BASE}/../etc/git-upload-pack`,
		`${BASE}/alice/..git/git-upload-pack`,
	])("rejects %s", (url) => {
		expect(parseGitUrl(url)).toBeNull();
	});
});

describe("readGitRequestBody", () => {
	it("enforces the cap on a chunked body with no Content-Length", async () => {
		let sent = 0;
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				sent += 1024;
				controller.enqueue(new Uint8Array(1024));
				if (sent > 1024 * 1024) controller.close();
			},
		});
		const request = new Request("http://x/", {
			method: "POST",
			body: stream,
			// @ts-expect-error -- Node's fetch requires this for stream bodies
			duplex: "half",
		});
		await expect(readGitRequestBody(request, 64 * 1024)).rejects.toMatchObject({
			statusCode: 413,
		});
		expect(sent).toBeLessThan(200 * 1024);
	});

	it("rejects a declared oversize body without reading it", async () => {
		const request = new Request("http://x/", {
			method: "POST",
			body: "x".repeat(10),
			headers: { "content-length": String(10 * 1024 * 1024) },
		});
		await expect(readGitRequestBody(request, 1024)).rejects.toMatchObject({
			statusCode: 413,
		});
	});

	it("decodes gzip requests sent by native Git", async () => {
		const protocol = `0032want ${"a".repeat(40)}\n00000009done\n`;
		const body = await readGitRequestBody(
			new Request("http://x/", {
				method: "POST",
				body: gzipSync(protocol),
				headers: { "content-encoding": "gzip" },
			}),
		);
		expect(new TextDecoder().decode(body)).toBe(protocol);
	});

	it("caps the decompressed body even when the gzip body is small", async () => {
		const compressed = gzipSync("x".repeat(1024 * 1024));
		expect(compressed.length).toBeLessThan(4096);
		await expect(
			readGitRequestBody(
				new Request("http://x/", {
					method: "POST",
					body: compressed,
					headers: { "content-encoding": "gzip" },
				}),
				4096,
			),
		).rejects.toMatchObject({ statusCode: 413 });
	});

	it("caps encoded bytes without relying on Content-Length", async () => {
		await expect(
			readGitRequestBody(
				new Request("http://x/", {
					method: "POST",
					body: gzipSync(""),
					headers: { "content-encoding": "gzip" },
				}),
				10,
			),
		).rejects.toMatchObject({ statusCode: 413 });
	});

	it("rejects malformed gzip rather than parsing it as Git protocol", async () => {
		await expect(
			readGitRequestBody(
				new Request("http://x/", {
					method: "POST",
					body: "not gzip",
					headers: { "content-encoding": "gzip" },
				}),
			),
		).rejects.toMatchObject({ statusCode: 400 });
	});

	it.each(["br", "gzip, gzip"])(
		"rejects unsupported encoding %s",
		async (encoding) => {
			await expect(
				readGitRequestBody(
					new Request("http://x/", {
						method: "POST",
						body: "0000",
						headers: { "content-encoding": encoding },
					}),
				),
			).rejects.toMatchObject({ statusCode: 415 });
		},
	);

	it("returns a body under the cap", async () => {
		const body = await readGitRequestBody(
			new Request("http://x/", { method: "POST", body: "0000" }),
			1024,
		);
		expect(new TextDecoder().decode(body)).toBe("0000");
	});
});

describe("serveGitRequest", () => {
	beforeAll(async () => {
		const { alice } = await createUsers("alice");
		signIn(alice);
		await createRepository({ data: { name: "pub", visibility: "public" } });
		await createRepository({ data: { name: "priv", visibility: "private" } });
	});

	it("advertises refs of a public repository anonymously", async () => {
		const response = await serveGitRequest(
			new Request(`${BASE}/alice/pub.git/info/refs?service=git-upload-pack`),
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe(
			"application/x-git-upload-pack-advertisement",
		);
	});

	it("asks for credentials on a private repository, and on any push", async () => {
		for (const url of [
			`${BASE}/alice/priv.git/info/refs?service=git-upload-pack`,
			`${BASE}/alice/pub.git/info/refs?service=git-receive-pack`,
		]) {
			const response = await serveGitRequest(new Request(url));
			expect(response.status).toBe(401);
			expect(response.headers.get("www-authenticate")).toContain("Basic");
		}
	});

	it("404s an unknown repository, 400s a bad route or method", async () => {
		expect(
			(
				await serveGitRequest(
					new Request(
						`${BASE}/alice/nope.git/info/refs?service=git-upload-pack`,
					),
				)
			).status,
		).toBe(404);
		expect(
			(await serveGitRequest(new Request(`${BASE}/alice/pub.git/HEAD`))).status,
		).toBe(400);
		expect(
			(
				await serveGitRequest(
					new Request(`${BASE}/alice/pub.git/git-upload-pack`),
				)
			).status,
		).toBe(400);
	});
});
