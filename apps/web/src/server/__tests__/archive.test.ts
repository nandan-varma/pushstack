/**
 * @vitest-environment node
 *
 * Source archives end to end over pglite and the in-memory store: the web
 * `/archive/…` URLs stream a zip or tar.gz that the system `unzip` and `tar`
 * accept, the REST `zipball`/`tarball` routes redirect to them, private
 * repositories stay private, and refs are validated.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));
vi.mock("@tanstack/react-start", () => import("../../test/server-test-utils"));
vi.mock(
	"#/server/session",
	async () => (await import("../../test/app-harness")).sessionModule,
);

const { createUsers, signOut } = await import("../../test/app-harness");
const users = await createUsers("alice", "bob");
const { call, mintToken, post } = await import("../../test/api-client");
const { createBranch, createCommit } = await import("../git-write");
const { serveArchive, splitArchiveSuffix } = await import("../archive");

const LONG_DIR = `${"deeply-nested-directory-".repeat(5)}end`;
let alice: string;
let tip: string;

const author = { name: "Robot", email: "robot@example.org" };
const request = (headers: Record<string, string> = {}) =>
	new Request("http://localhost:3000/alice/proj/archive/x", { headers });

async function download(
	spec: string,
	format: "zip" | "tar.gz",
	owner = "alice",
	name = "proj",
	headers: Record<string, string> = {},
	legacy = false,
) {
	const response = await serveArchive(
		request(headers),
		owner,
		name,
		spec,
		format,
		{ legacy },
	);
	return { response, bytes: new Uint8Array(await response.arrayBuffer()) };
}

function extract(bytes: Uint8Array, format: "zip" | "tar.gz") {
	const dir = mkdtempSync(join(tmpdir(), "archive-test-"));
	const file = join(dir, `a.${format}`);
	writeFileSync(file, bytes);
	const out = join(dir, "out");
	if (format === "zip") {
		execFileSync("unzip", ["-tq", file]);
		execFileSync("unzip", ["-q", file, "-d", out]);
	} else {
		execFileSync("mkdir", [out]);
		execFileSync("tar", ["-xzf", file, "-C", out]);
	}
	return { dir, out, file };
}

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	await call("/user/repos", post(alice, { name: "proj", auto_init: true }));
	await call(
		"/user/repos",
		post(alice, { name: "secret", auto_init: true, private: true }),
	);
	await createBranch("alice", "proj", "feature/x", "main");
	await createCommit("alice", "proj", {
		branch: "main",
		message: "Add files",
		files: [
			{ path: "README.txt", content: "readme\n" },
			{ path: "src/app.txt", content: "hello\n".repeat(1000) },
			{ path: "bin/data.bin", content: new Uint8Array([0, 1, 2, 255, 0]) },
			{ path: "über/ñ.txt", content: "unicode\n" },
			{ path: `${LONG_DIR}/file.txt`, content: "long\n" },
		],
		author,
	});
	tip = (await call("/repos/alice/proj/branches/main")).body.commit.sha;
	await createCommit("alice", "proj", {
		branch: "feature/x",
		message: "Feature",
		files: [{ path: "feature.txt", content: "feature\n" }],
		author,
	});
	await call(
		"/repos/alice/proj/git/refs",
		post(alice, { ref: "refs/tags/v1.2", sha: tip }),
	);
});

describe("archive URLs", () => {
	it("splits the format suffix", () => {
		expect(splitArchiveSuffix("refs/heads/main.zip")).toEqual({
			name: "refs/heads/main",
			format: "zip",
		});
		expect(splitArchiveSuffix("abc.tar.gz")?.format).toBe("tar.gz");
		expect(splitArchiveSuffix("abc.tar")).toBeNull();
	});
});

describe("zip", () => {
	it("streams a valid archive under {repo}-{branch}/", async () => {
		const { response, bytes } = await download("refs/heads/main", "zip");
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("application/zip");
		expect(response.headers.get("content-disposition")).toBe(
			"attachment; filename=proj-main.zip",
		);
		// Streamed: no length is promised up front.
		expect(response.headers.has("content-length")).toBe(false);
		const { out, file } = extract(bytes, "zip");
		const top = join(out, "proj-main");
		expect(readFileSync(join(top, "README.txt"), "utf8")).toBe("readme\n");
		expect(readFileSync(join(top, "src/app.txt"), "utf8")).toBe(
			"hello\n".repeat(1000),
		);
		expect([...readFileSync(join(top, "bin/data.bin"))]).toEqual([
			0, 1, 2, 255, 0,
		]);
		expect(readFileSync(join(top, "über/ñ.txt"), "utf8")).toBe("unicode\n");
		// The commit is recorded as the archive comment.
		expect(execFileSync("unzip", ["-z", file]).toString()).toContain(tip);
	});

	it("names a slashed branch with dashes and strips a tag's v", async () => {
		const branch = await download("refs/heads/feature/x", "zip");
		expect(branch.response.headers.get("content-disposition")).toBe(
			"attachment; filename=proj-feature-x.zip",
		);
		expect(
			readFileSync(
				join(extract(branch.bytes, "zip").out, "proj-feature-x/feature.txt"),
				"utf8",
			),
		).toBe("feature\n");
		const tag = await download("refs/tags/v1.2", "zip");
		expect(tag.response.headers.get("content-disposition")).toBe(
			"attachment; filename=proj-1.2.zip",
		);
		extract(tag.bytes, "zip");
	});
});

describe("tar.gz", () => {
	it("streams an archive tar extracts, with long paths", async () => {
		const { response, bytes } = await download("main", "tar.gz");
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("application/gzip");
		const { out } = extract(bytes, "tar.gz");
		const top = join(out, "proj-main");
		expect(readFileSync(join(top, "README.txt"), "utf8")).toBe("readme\n");
		expect(readFileSync(join(top, LONG_DIR, "file.txt"), "utf8")).toBe(
			"long\n",
		);
		expect(readFileSync(join(top, "über/ñ.txt"), "utf8")).toBe("unicode\n");
	});

	it("records the commit in a pax global header", async () => {
		const { bytes } = await download("main", "tar.gz");
		const { file } = extract(bytes, "tar.gz");
		const listing = execFileSync("tar", ["-tzvf", file]).toString();
		expect(listing).toContain("proj-main/README.txt");
		const raw = execFileSync("gunzip", ["-c", file]).toString("latin1");
		expect(raw).toContain(`comment=${tip}`);
	});
});

describe("refs and caching", () => {
	it("pins a full sha as immutable and rejects unknown or unsafe refs", async () => {
		const pinned = await download(tip, "zip");
		expect(pinned.response.status).toBe(200);
		expect(pinned.response.headers.get("cache-control")).toContain("immutable");
		expect(pinned.response.headers.get("content-disposition")).toBe(
			`attachment; filename=proj-${tip}.zip`,
		);
		const branch = await download("main", "zip");
		expect(branch.response.headers.get("cache-control")).not.toContain(
			"immutable",
		);
		const statuses = await Promise.all(
			[
				"nope",
				"refs/heads/nope",
				"../../etc/passwd",
				"refs/heads/",
				"deadbeef",
				"0".repeat(40),
			].map(async (spec) => (await download(spec, "zip")).response.status),
		);
		expect(statuses).toEqual([404, 404, 404, 404, 404, 404]);
		expect(
			(await download("main", "zip", "alice", "missing")).response.status,
		).toBe(404);
	});
});

describe("access", () => {
	it("hides private repositories from anonymous and other users, not from a token", async () => {
		signOut();
		expect(
			(await download("main", "zip", "alice", "secret")).response.status,
		).toBe(404);
		const bob = await mintToken(users.bob, ["repo:read"]);
		signOut();
		expect(
			(
				await download("main", "zip", "alice", "secret", {
					authorization: `token ${bob}`,
				})
			).response.status,
		).toBe(404);
		const owner = await download("main", "zip", "alice", "secret", {
			authorization: `token ${alice}`,
		});
		expect(owner.response.status).toBe(200);
		expect(owner.response.headers.get("cache-control")).toContain("private");
		expect(
			(
				await download("main", "zip", "alice", "secret", {
					authorization: "token pst_nope",
				})
			).response.status,
		).toBe(401);
	});
});

describe("REST redirects", () => {
	it("302s zipball and tarball to codeload-style legacy URLs", async () => {
		const zip = await call("/repos/alice/proj/zipball/main");
		expect(zip.status).toBe(302);
		expect(zip.headers.get("location")).toBe(
			"http://localhost:3000/alice/proj/legacy.zip/refs/heads/main",
		);
		const tar = await call("/repos/alice/proj/tarball/feature/x");
		expect(tar.headers.get("location")).toBe(
			"http://localhost:3000/alice/proj/legacy.tar.gz/refs/heads/feature/x",
		);
		const tag = await call("/repos/alice/proj/zipball/v1.2");
		expect(tag.headers.get("location")).toBe(
			"http://localhost:3000/alice/proj/legacy.zip/refs/tags/v1.2",
		);
		const sha = await call(`/repos/alice/proj/tarball/${tip}`);
		expect(sha.headers.get("location")).toBe(
			`http://localhost:3000/alice/proj/legacy.tar.gz/${tip}`,
		);
	});

	it("uses the default branch without a ref", async () => {
		for (const path of ["zipball", "zipball/", "tarball"]) {
			const { status, headers } = await call(`/repos/alice/proj/${path}`);
			expect(status, path).toBe(302);
			expect(headers.get("location"), path).toContain("/alice/proj/legacy.");
			expect(headers.get("location"), path).toMatch(/\/refs\/heads\/main$/);
		}
	});

	it("names legacy archives {owner}-{repo}-{short sha}", async () => {
		const { response, bytes } = await download(
			"refs/heads/main",
			"zip",
			"alice",
			"proj",
			{},
			true,
		);
		const name = `alice-proj-${tip.slice(0, 7)}`;
		expect(response.headers.get("content-disposition")).toBe(
			`attachment; filename=${name}.zip`,
		);
		const { out } = extract(bytes, "zip");
		expect(readFileSync(join(out, name, "README.txt"), "utf8")).toBe(
			"readme\n",
		);
	});

	it("404s an unknown ref or an unreadable repository", async () => {
		expect((await call("/repos/alice/proj/zipball/nope")).status).toBe(404);
		expect((await call("/repos/alice/secret/zipball/main")).status).toBe(404);
		expect(
			(
				await call("/repos/alice/secret/zipball/main", {
					authorization: `token ${alice}`,
				})
			).status,
		).toBe(302);
	});
});

describe("hostile trees and failures", () => {
	it("refuses a tree with names that could escape the archive directory", async () => {
		const { default: iso } = await import("isomorphic-git");
		const { withPackedWrites } = await import("git-fs-s3/ops");
		const { repoFor } = await import("../git-repo");
		const names = ["ok.txt", "..", ".", ".git", ".GIT", "a\\b", "a/b"];
		await withPackedWrites(repoFor("alice", "proj"), async (repo) => {
			const blob = await iso.writeBlob({
				...repo,
				blob: new TextEncoder().encode("x"),
			});
			const tree = await iso.writeTree({
				...repo,
				tree: names.map((path) => ({
					mode: "100644",
					path,
					oid: blob,
					type: "blob" as const,
				})),
			});
			const identity = {
				name: "x",
				email: "x@example.org",
				timestamp: 1,
				timezoneOffset: 0,
			};
			const commit = await iso.writeCommit({
				...repo,
				commit: {
					message: "hostile\n",
					tree,
					parent: [],
					author: identity,
					committer: identity,
				},
			});
			await iso.writeRef({
				...repo,
				ref: "refs/heads/hostile",
				value: commit,
			});
		});
		// The git library refuses to parse such a tree; that is a 422, never an
		// archive that would extract outside its directory.
		const { response, bytes } = await download("refs/heads/hostile", "zip");
		expect(response.status).toBe(422);
		expect(new TextDecoder().decode(bytes)).toContain("unsafe");
	});

	it("keeps only names that are one safe path component", async () => {
		const { isSafeArchiveName } = await import("../git-read");
		for (const name of ["", ".", "..", ".git", ".GIT", "a/b", "a\\b", "a\0b"]) {
			expect(isSafeArchiveName(name), JSON.stringify(name)).toBe(false);
		}
		for (const name of ["ok.txt", ".gitignore", ".github", "über", "a b"]) {
			expect(isSafeArchiveName(name), name).toBe(true);
		}
	});

	it("413s a path over the length cap", async () => {
		const deep = Array.from({ length: 20 }, () => "d".repeat(250)).join("/");
		await createCommit("alice", "proj", {
			branch: "feature/x",
			message: "Deep",
			files: [{ path: `${deep}/f.txt`, content: "x" }],
			author,
		});
		const { response } = await download("refs/heads/feature/x", "zip");
		expect(response.status).toBe(413);
	});

	it("errors the stream, not the process, when building fails mid-way", async () => {
		const { chunkStream, tarChunks } = await import("../archive-format");
		async function* failing() {
			yield {
				path: "a",
				kind: "file" as const,
				executable: false,
				read: async () => new Uint8Array([1]),
			};
			yield {
				path: "b",
				kind: "file" as const,
				executable: false,
				read: async () => {
					throw new Error("blob vanished");
				},
			};
		}
		const gzipped = chunkStream(
			tarChunks(failing(), { commitSha: "a".repeat(40), mtime: 1 }),
		).pipeThrough(
			new CompressionStream("gzip") as unknown as ReadableWritablePair<
				Uint8Array,
				Uint8Array
			>,
		);
		await expect(new Response(gzipped).arrayBuffer()).rejects.toThrow();
	});
});
