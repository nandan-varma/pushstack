/**
 * Tests for git-http-iso.ts — the thin pushstack-specific wrapper (auth
 * gating, gitFs vs local-disk selection, R2 stale-pack cleanup) around
 * @nandan-varma/git-fs-s3's smart-HTTP module.
 *
 * Uses real isomorphic-git repos throughout rather than mocking
 * isomorphic-git: git-fs-s3 resolves its own "isomorphic-git" copy under
 * pnpm's isolated node_modules layout — a different module instance than
 * the one this file would mock — so mocking it here never reaches the
 * library's internal calls (same issue documented in git-merge-iso.test.ts
 * for @nandan-varma/git-edge). Deep protocol-level behavior (ref CAS,
 * path-traversal rejection, multi-ref pushes, non-fast-forward rejection,
 * pack consolidation) has its own dedicated coverage in git-fs-s3's own
 * test/http/*.test.ts — these tests focus on the wiring pushstack itself
 * owns: auth gating, which fs backs which path, and the hooks/R2-cleanup
 * glue.
 */

import nodeFs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createGitFs, MemoryObjectStore } from "@nandan-varma/git-fs-s3";
import git from "isomorphic-git";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Shared in-memory backing store for handleInfoRefsIso/handleUploadPackIso
// (read-only paths) — each test uses its own owner/repo pair so gitdirs
// never collide inside the one shared store.
const memoryStore = new MemoryObjectStore();
const memoryGitFs = createGitFs(memoryStore);

vi.mock("../git-fs", () => ({
	gitFs: memoryGitFs,
	detectLooseObjectsHint: vi.fn().mockResolvedValue(undefined),
	invalidateRepoGitStorage: vi.fn(),
	invalidateGitStorageKeys: vi.fn(),
}));

vi.mock("../git-storage-naming", () => ({
	getRepoGitStorageRoot: (owner: string, repo: string) =>
		`repos/${owner}/${repo}/git`,
	getRepoGitStoragePrefix: (owner: string, repo: string) =>
		`repos/${owner}/${repo}/git/`,
}));

// handleReceivePackIso hydrates to local disk — each receive-pack test gets
// its own real temp dir (set in beforeEach), routed through here.
const receiveDirRef = vi.hoisted(() => ({ current: "" }));
const withReceivePackLockMock = vi.hoisted(() => vi.fn());

vi.mock("../git-repo-storage", () => ({
	withReceivePackLock: withReceivePackLockMock,
}));

vi.mock("#/lib/r2-operations", () => ({
	bulkDeleteFromR2: vi.fn().mockResolvedValue(undefined),
}));

const { handleInfoRefsIso, handleUploadPackIso, handleReceivePackIso } =
	await import("../git-http-iso");

import type { GitAuthContext } from "../git-auth";
import { GitAuthorizationError } from "../git-errors";

const AUTH_BASE: GitAuthContext = {
	userId: "test-user",
	username: "testuser",
	user: {
		id: "test-user",
		username: "testuser",
		email: "test@example.com",
		name: "Test",
	},
	repo: { id: 1, ownerId: "test-user", name: "r", visibility: "public" },
	canRead: true,
	canWrite: false,
};
const AUTH_READ: GitAuthContext = {
	...AUTH_BASE,
	canRead: true,
	canWrite: false,
};
const AUTH_WRITE: GitAuthContext = {
	...AUTH_BASE,
	canRead: true,
	canWrite: true,
};
const AUTH_NONE: GitAuthContext = {
	...AUTH_BASE,
	canRead: false,
	canWrite: false,
};

// Helper to build pkt-line buffer
function pktLine(s: string): Buffer {
	const b = Buffer.from(s);
	return Buffer.concat([
		Buffer.from((b.length + 4).toString(16).padStart(4, "0")),
		b,
	]);
}

// Parse pkt-lines from a Buffer for assertion
function parsePktLines(buf: Buffer): string[] {
	const lines: string[] = [];
	let pos = 0;
	while (pos + 4 <= buf.length) {
		const len = Number.parseInt(buf.slice(pos, pos + 4).toString("ascii"), 16);
		if (len === 0) {
			lines.push("FLUSH");
			pos += 4;
		} else if (len >= 4) {
			lines.push(buf.slice(pos + 4, pos + len).toString("utf8"));
			pos += len;
		} else break;
	}
	return lines;
}

// Decodes side-band-64k-framed packfile bytes (band-1 pkt-lines terminated by
// a flush-pkt) back into the raw packfile, mirroring what a real client's
// GitSideBand.demux does.
function decodeSideBandPackfile(buf: Buffer): Buffer {
	const chunks: Buffer[] = [];
	let pos = 0;
	while (pos + 4 <= buf.length) {
		const len = Number.parseInt(buf.slice(pos, pos + 4).toString("ascii"), 16);
		if (len === 0) {
			pos += 4;
			break;
		}
		const band = buf[pos + 4];
		if (band !== 1) throw new Error(`unexpected side-band marker ${band}`);
		chunks.push(buf.slice(pos + 5, pos + len));
		pos += len;
	}
	return Buffer.concat(chunks);
}

const AUTHOR = {
	name: "Test",
	email: "test@example.com",
	timestamp: 1000000000,
	timezoneOffset: 0,
};

/** Seed a bare repo directly into the shared in-memory gitFs store. */
async function seedMemoryRepo(
	owner: string,
	repo: string,
	commitCount: number,
): Promise<{ gitdir: string; headOid?: string }> {
	const gitdir = `repos/${owner}/${repo}/git`;
	await git.init({
		fs: memoryGitFs,
		gitdir,
		bare: true,
		defaultBranch: "main",
	});
	let headOid: string | undefined;
	for (let i = 0; i < commitCount; i++) {
		const blobOid = await git.writeBlob({
			fs: memoryGitFs,
			gitdir,
			blob: new TextEncoder().encode(`content ${i}\n`),
		});
		const treeOid = await git.writeTree({
			fs: memoryGitFs,
			gitdir,
			tree: [{ path: "f.txt", mode: "100644", type: "blob", oid: blobOid }],
		});
		headOid = await git.writeCommit({
			fs: memoryGitFs,
			gitdir,
			commit: {
				message: `commit ${i}\n`,
				tree: treeOid,
				parent: headOid ? [headOid] : [],
				author: AUTHOR,
				committer: AUTHOR,
			},
		});
		await git.writeRef({
			fs: memoryGitFs,
			gitdir,
			ref: "refs/heads/main",
			value: headOid,
			force: true,
		});
	}
	return { gitdir, headOid };
}

describe("handleInfoRefsIso", () => {
	it("returns 403 if no read access for upload-pack", async () => {
		await expect(
			handleInfoRefsIso("u", "r", "git-upload-pack", AUTH_NONE),
		).rejects.toThrow(GitAuthorizationError);
	});

	it("returns 403 if no write access for receive-pack", async () => {
		await expect(
			handleInfoRefsIso("u", "r", "git-receive-pack", AUTH_READ),
		).rejects.toThrow(GitAuthorizationError);
	});

	it("returns capability sentinel for empty repo", async () => {
		await seedMemoryRepo("irempty", "r", 0);

		const result = await handleInfoRefsIso(
			"irempty",
			"r",
			"git-upload-pack",
			AUTH_READ,
		);
		expect(result.status).toBe(200);
		const lines = parsePktLines(Buffer.from(result.body));
		expect(lines[0]).toBe("# service=git-upload-pack\n");
		expect(lines[1]).toBe("FLUSH");
		expect(lines[2]).toContain("capabilities^{}");
	});

	it("returns refs and capabilities for a repo with commits", async () => {
		const { headOid } = await seedMemoryRepo("irfull", "r", 1);

		const result = await handleInfoRefsIso(
			"irfull",
			"r",
			"git-upload-pack",
			AUTH_READ,
		);
		expect(result.status).toBe(200);
		const lines = parsePktLines(Buffer.from(result.body));
		// service header, FLUSH, HEAD line, refs/heads/main, FLUSH
		expect(lines[0]).toBe("# service=git-upload-pack\n");
		expect(lines[1]).toBe("FLUSH");
		const headLine = lines[2];
		expect(headLine).toContain(headOid);
		expect(headLine).toContain("HEAD");
		expect(headLine).toContain("symref=HEAD:refs/heads/main");
		expect(lines[lines.length - 1]).toBe("FLUSH");
	});
});

describe("handleUploadPackIso", () => {
	it("returns 403 if no read access", async () => {
		const req = new Request("http://x/git-upload-pack", {
			method: "POST",
			body: Buffer.from("0000"),
		});
		await expect(handleUploadPackIso("u", "r", req, AUTH_NONE)).rejects.toThrow(
			GitAuthorizationError,
		);
	});

	it("returns NAK with a real pack for a want request", async () => {
		const { headOid } = await seedMemoryRepo("upfull", "r", 2);

		const reqBody = Buffer.concat([
			pktLine(`want ${headOid}\n`),
			Buffer.from("0000"),
			pktLine("done\n"),
		]);

		const req = new Request("http://x/git-upload-pack", {
			method: "POST",
			body: reqBody,
		});
		const result = await handleUploadPackIso("upfull", "r", req, AUTH_READ);
		expect(result.status).toBe(200);
		expect(result.headers["Content-Type"]).toBe(
			"application/x-git-upload-pack-result",
		);

		const body = Buffer.from(result.body);
		const nakLen = Number.parseInt(body.slice(0, 4).toString("ascii"), 16);
		expect(body.slice(4, nakLen).toString()).toBe("NAK\n");
		const packfile = decodeSideBandPackfile(body.slice(nakLen));
		expect(packfile.slice(0, 4).toString()).toBe("PACK");
	});

	it("returns NAK with pack even when there are 'have' lines (no negotiation)", async () => {
		const { headOid } = await seedMemoryRepo("uphave", "r", 1);

		const reqBody = Buffer.concat([
			pktLine(`want ${headOid}\n`),
			pktLine("have 0000000000000000000000000000000000000000\n"),
			Buffer.from("0000"),
			pktLine("done\n"),
		]);

		const req = new Request("http://x/git-upload-pack", {
			method: "POST",
			body: reqBody,
		});
		const result = await handleUploadPackIso("uphave", "r", req, AUTH_READ);
		expect(result.status).toBe(200);
		const body = Buffer.from(result.body);
		expect(body.toString("utf8", 4, 8)).toBe("NAK\n");
	});

	it("returns bare NAK (no pack) when 'have' lines are sent without 'done'", async () => {
		// Mirrors a mid-negotiation round: the client hasn't decided the exchange
		// is over yet, so the response must be a NAK only. No repo needed — this
		// returns before touching the gitdir at all.
		const sha = "f".repeat(40);
		const haveSha = "1".repeat(40);

		const reqBody = Buffer.concat([
			pktLine(`want ${sha}\n`),
			Buffer.from("0000"),
			pktLine(`have ${haveSha}\n`),
			Buffer.from("0000"),
		]);

		const req = new Request("http://x/git-upload-pack", {
			method: "POST",
			body: reqBody,
		});
		const result = await handleUploadPackIso("u", "r", req, AUTH_READ);
		expect(result.status).toBe(200);

		const body = Buffer.from(result.body);
		expect(body.toString("utf8", 4, 8)).toBe("NAK\n");
		expect(body.length).toBe(8); // pkt-line("NAK\n") only, no pack bytes appended
	});
});

describe("handleReceivePackIso", () => {
	let receiveTmpDir: string;

	beforeEach(() => {
		receiveTmpDir = nodeFs.mkdtempSync(
			path.join(os.tmpdir(), "git-http-iso-test-"),
		);
		receiveDirRef.current = receiveTmpDir;
		withReceivePackLockMock.mockReset();
		withReceivePackLockMock.mockImplementation(
			async (
				_ownerKey: string,
				_repoName: string,
				_defaultBranch: string,
				fn: (gitdir: string) => Promise<unknown>,
			) => fn(receiveDirRef.current),
		);
	});

	afterEach(() => {
		nodeFs.rmSync(receiveTmpDir, { recursive: true, force: true });
	});

	it("returns 403 if no write access", async () => {
		const req = new Request("http://x/git-receive-pack", {
			method: "POST",
			body: Buffer.from("0000"),
		});
		await expect(
			handleReceivePackIso("u", "r", req, AUTH_READ),
		).rejects.toThrow(GitAuthorizationError);
	});

	/** Build a real packfile for a single new commit, the shape a real push sends. */
	async function buildPushPack(
		message: string,
		parentOid?: string,
	): Promise<{ packfile: Buffer; commitOid: string }> {
		const staging = { fs: nodeFs, gitdir: receiveTmpDir };
		const blobOid = await git.writeBlob({
			...staging,
			blob: new TextEncoder().encode(`${message}\n`),
		});
		const treeOid = await git.writeTree({
			...staging,
			tree: [{ path: "file.txt", mode: "100644", type: "blob", oid: blobOid }],
		});
		const commitOid = await git.writeCommit({
			...staging,
			commit: {
				message: `${message}\n`,
				tree: treeOid,
				parent: parentOid ? [parentOid] : [],
				author: AUTHOR,
				committer: AUTHOR,
			},
		});
		const { packfile } = await git.packObjects({
			...staging,
			oids: [blobOid, treeOid, commitOid],
		});
		return { packfile: Buffer.from(packfile ?? new Uint8Array()), commitOid };
	}

	it("parses ref updates, indexes the pack, and writes the ref on a successful push", async () => {
		await git.init({
			fs: nodeFs,
			dir: receiveTmpDir,
			bare: true,
			defaultBranch: "main",
		});
		const { packfile, commitOid } = await buildPushPack("first");
		const zeroOid = "0".repeat(40);

		const body = Buffer.concat([
			pktLine(`${zeroOid} ${commitOid} refs/heads/main\n`),
			Buffer.from("0000"),
			packfile,
		]);

		const req = new Request("http://x/git-receive-pack", {
			method: "POST",
			body,
		});
		const result = await handleReceivePackIso("u", "r", req, AUTH_WRITE);

		expect(result.status).toBe(200);
		expect(result.headers["Content-Type"]).toBe(
			"application/x-git-receive-pack-result",
		);
		const responseBody = Buffer.from(result.body).toString("utf8");
		expect(responseBody).toContain("unpack ok");
		expect(responseBody).toContain("ok refs/heads/main");

		const headOid = await git.resolveRef({
			fs: nodeFs,
			gitdir: receiveTmpDir,
			ref: "refs/heads/main",
		});
		expect(headOid).toBe(commitOid);
	});

	it("rejects a non-fast-forward push whose oldOid no longer matches the current ref", async () => {
		await git.init({
			fs: nodeFs,
			dir: receiveTmpDir,
			bare: true,
			defaultBranch: "main",
		});
		const zeroOid = "0".repeat(40);
		const first = await buildPushPack("first");
		await handleReceivePackIso(
			"u",
			"r",
			new Request("http://x/git-receive-pack", {
				method: "POST",
				body: Buffer.concat([
					pktLine(`${zeroOid} ${first.commitOid} refs/heads/main\n`),
					Buffer.from("0000"),
					first.packfile,
				]),
			}),
			AUTH_WRITE,
		);

		// Client still thinks main is at zeroOid (stale) — server disagrees.
		const second = await buildPushPack("second", first.commitOid);
		const result = await handleReceivePackIso(
			"u",
			"r",
			new Request("http://x/git-receive-pack", {
				method: "POST",
				body: Buffer.concat([
					pktLine(`${zeroOid} ${second.commitOid} refs/heads/main\n`),
					Buffer.from("0000"),
					second.packfile,
				]),
			}),
			AUTH_WRITE,
		);

		const responseBody = Buffer.from(result.body).toString("utf8");
		expect(responseBody).toContain("ng refs/heads/main");
		const headOid = await git.resolveRef({
			fs: nodeFs,
			gitdir: receiveTmpDir,
			ref: "refs/heads/main",
		});
		expect(headOid).toBe(first.commitOid); // unchanged
	});

	it("deletes a ref when newOid is all-zero", async () => {
		await git.init({
			fs: nodeFs,
			dir: receiveTmpDir,
			bare: true,
			defaultBranch: "main",
		});
		const zeroOid = "0".repeat(40);
		const { packfile, commitOid } = await buildPushPack("first");
		await handleReceivePackIso(
			"u",
			"r",
			new Request("http://x/git-receive-pack", {
				method: "POST",
				body: Buffer.concat([
					pktLine(`${zeroOid} ${commitOid} refs/heads/doomed\n`),
					Buffer.from("0000"),
					packfile,
				]),
			}),
			AUTH_WRITE,
		);

		const result = await handleReceivePackIso(
			"u",
			"r",
			new Request("http://x/git-receive-pack", {
				method: "POST",
				body: Buffer.concat([
					pktLine(`${commitOid} ${zeroOid} refs/heads/doomed\n`),
					Buffer.from("0000"),
				]),
			}),
			AUTH_WRITE,
		);

		expect(Buffer.from(result.body).toString("utf8")).toContain(
			"ok refs/heads/doomed",
		);
		await expect(
			git.resolveRef({
				fs: nodeFs,
				gitdir: receiveTmpDir,
				ref: "refs/heads/doomed",
			}),
		).rejects.toThrow();
	});

	it("initializes bare repo on disk if HEAD does not exist", async () => {
		// No git.init on receiveTmpDir here — handleReceivePackIso's delegate
		// (applyReceivePack) must initialize the repo itself on a first push.
		// buildPushPack writes loose objects directly (isomorphic-git
		// auto-creates missing directories), which doesn't require HEAD/refs
		// to already exist.
		const zeroOid = "0".repeat(40);
		const { packfile, commitOid } = await buildPushPack("first");

		const result = await handleReceivePackIso(
			"u",
			"r",
			new Request("http://x/git-receive-pack", {
				method: "POST",
				body: Buffer.concat([
					pktLine(`${zeroOid} ${commitOid} refs/heads/main\n`),
					Buffer.from("0000"),
					packfile,
				]),
			}),
			AUTH_WRITE,
			"main",
			"owner-db-id",
		);

		expect(result.status).toBe(200);
		expect(nodeFs.existsSync(path.join(receiveTmpDir, "HEAD"))).toBe(true);
	});

	it("acquires withReceivePackLock with correct parameters during push", async () => {
		await git.init({
			fs: nodeFs,
			dir: receiveTmpDir,
			bare: true,
			defaultBranch: "main",
		});
		const zeroOid = "0".repeat(40);
		const { packfile, commitOid } = await buildPushPack("first");

		await handleReceivePackIso(
			"u",
			"r",
			new Request("http://x/git-receive-pack", {
				method: "POST",
				body: Buffer.concat([
					pktLine(`${zeroOid} ${commitOid} refs/heads/main\n`),
					Buffer.from("0000"),
					packfile,
				]),
			}),
			AUTH_WRITE,
			"main",
			"owner-id",
		);

		expect(withReceivePackLockMock).toHaveBeenCalledTimes(1);
		expect(withReceivePackLockMock).toHaveBeenCalledWith(
			"u",
			"r",
			"main",
			expect.any(Function),
			"owner-id",
		);
	});

	it("returns error response when receive-pack function throws", async () => {
		withReceivePackLockMock.mockRejectedValueOnce(new Error("lock timeout"));

		const zeroOid = "0".repeat(40);
		const req = new Request("http://x/git-receive-pack", {
			method: "POST",
			body: Buffer.concat([
				pktLine(`${zeroOid} ${"g".repeat(40)} refs/heads/main\n`),
				Buffer.from("0000"),
			]),
		});
		await expect(
			handleReceivePackIso("u", "r", req, AUTH_WRITE),
		).rejects.toThrow("lock timeout");
	});
});
