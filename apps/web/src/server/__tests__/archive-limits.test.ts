/**
 * @vitest-environment node
 *
 * Archive bounds (a tiny limit via a mocked `limits.ts`) and the zip/tar
 * writers' handling of executables, symlinks and empty directories (the shape
 * a submodule pointer takes), checked with the system `unzip` and `tar`.
 */
import { execFileSync } from "node:child_process";
import {
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("#/lib/limits", async (importOriginal) => ({
	...(await importOriginal<typeof import("#/lib/limits")>()),
	MAX_ARCHIVE_ENTRIES: 3,
}));
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
const { call, mintToken, post } = await import("../../test/api-client");
const { createCommit } = await import("../git-write");
const { serveArchive } = await import("../archive");
const { chunkStream, tarChunks, zipChunks } = await import("../archive-format");

beforeAll(async () => {
	const alice = await mintToken(users.alice, ["repo:write"]);
	await call("/user/repos", post(alice, { name: "proj", auto_init: true }));
	await createCommit("alice", "proj", {
		branch: "main",
		message: "Many files",
		files: ["a", "b", "c", "d"].map((name) => ({
			path: `${name}.txt`,
			content: name,
		})),
		author: { name: "Robot", email: "robot@example.org" },
	});
});

describe("limits", () => {
	it("answers 413 with a clear message above the entry limit", async () => {
		const response = await serveArchive(
			new Request("http://localhost:3000/alice/proj/archive/main.zip"),
			"alice",
			"proj",
			"main",
			"zip",
		);
		expect(response.status).toBe(413);
		expect(await response.text()).toContain("Use git clone");
	});
});

async function* entries() {
	const text = (value: string) => async () => new TextEncoder().encode(value);
	yield {
		path: "top",
		kind: "dir" as const,
		executable: false,
		read: text(""),
	};
	yield {
		path: "top/run.sh",
		kind: "file" as const,
		executable: true,
		read: text("#!/bin/sh\n"),
	};
	yield {
		path: "top/link",
		kind: "symlink" as const,
		executable: false,
		read: text("run.sh"),
	};
	yield {
		path: "top/sub",
		kind: "dir" as const,
		executable: false,
		read: text(""),
	};
}

async function collect(chunks: AsyncGenerator<Uint8Array>) {
	return new Uint8Array(await new Response(chunkStream(chunks)).arrayBuffer());
}

describe("writers", () => {
	const meta = { commitSha: "a".repeat(40), mtime: 1_700_000_000 };

	function check(out: string) {
		expect(lstatSync(join(out, "top/run.sh")).mode & 0o111).not.toBe(0);
		expect(lstatSync(join(out, "top/link")).isSymbolicLink()).toBe(true);
		expect(readlinkSync(join(out, "top/link"))).toBe("run.sh");
		expect(lstatSync(join(out, "top/sub")).isDirectory()).toBe(true);
	}

	it("keeps modes, symlinks and empty directories in a zip", async () => {
		const dir = mkdtempSync(join(tmpdir(), "archive-writer-"));
		const file = join(dir, "a.zip");
		writeFileSync(file, await collect(zipChunks(entries(), meta)));
		mkdirSync(join(dir, "out"));
		execFileSync("unzip", ["-q", file, "-d", join(dir, "out")]);
		check(join(dir, "out"));
	});

	it("keeps modes, symlinks and empty directories in a tar", async () => {
		const dir = mkdtempSync(join(tmpdir(), "archive-writer-"));
		const file = join(dir, "a.tar");
		writeFileSync(file, await collect(tarChunks(entries(), meta)));
		mkdirSync(join(dir, "out"));
		execFileSync("tar", ["-xf", file, "-C", join(dir, "out")]);
		check(join(dir, "out"));
	});
});
