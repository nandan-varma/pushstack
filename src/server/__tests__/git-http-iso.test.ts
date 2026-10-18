/**
 * Tests for git-http-iso.ts — the thin pushstack-specific wrapper (auth
 * gating, the write lock, post-push bookkeeping) around git-fs-s3's
 * smart-HTTP module. Every service runs against an in-memory gitFs, the
 * same way production runs against R2 — no local disk.
 *
 * Uses real isomorphic-git repos throughout rather than mocking
 * isomorphic-git: git-fs-s3 resolves its own "isomorphic-git" copy under
 * pnpm's isolated node_modules layout — a different module instance than
 * the one this file would mock — so mocking it here never reaches the
 * library's internal calls (same issue documented in git-merge-iso.test.ts
 * for git-edge). Deep protocol-level behavior (ref CAS,
 * path-traversal rejection, multi-ref pushes, non-fast-forward rejection,
 * pack consolidation) has its own dedicated coverage in git-fs-s3's own
 * test/http/*.test.ts — these tests focus on the wiring pushstack itself
 * owns: auth gating, locking, and the hooks/bookkeeping glue.
 */

import { createGitFs, MemoryObjectStore } from "git-fs-s3";
import git from "isomorphic-git";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Shared in-memory backing store for every service — each test uses its own
// owner/repo pair so gitdirs never collide inside the one shared store.
const memoryStore = new MemoryObjectStore();
const memoryGitFs = createGitFs(memoryStore);

vi.mock("../git-fs", () => ({
	gitFs: memoryGitFs,
	detectLooseObjectsHint: vi.fn().mockResolvedValue(undefined),
	prefetchAllPacks: vi.fn().mockResolvedValue(undefined),
	invalidateRepoGitStorage: vi.fn(),
	invalidateGitStorageKeys: vi.fn(),
	registerRepoGitdir: (owner: string, repo: string) =>
		`repos/${owner}/${repo}/git`,
}));

vi.mock("../git-storage-naming", () => ({
	getRepoGitStorageRoot: (owner: string, repo: string) =>
		`repos/${owner}/${repo}/git`,
	getRepoGitStoragePrefix: (owner: string, repo: string) =>
		`repos/${owner}/${repo}/git/`,
}));

// The real lock needs Postgres; run the critical section inline instead.
const withRepositoryLockMock = vi.hoisted(() =>
	vi.fn(
		async (_ownerKey: string, _repoName: string, fn: () => Promise<unknown>) =>
			fn(),
	),
);
const afterRepositoryPushMock = vi.hoisted(() => vi.fn());

vi.mock("../git-repo-storage", () => ({
	withRepositoryLock: withRepositoryLockMock,
	afterRepositoryPush: afterRepositoryPushMock,
}));

const { handleInfoRefsIso, handleUploadPackIso, handleReceivePackIso } =
	await import("../git-http-iso");
const { detectLooseObjectsHint, prefetchAllPacks } = await import("../git-fs");

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
			handleInfoRefsIso("u", "r", "git-upload-pack", AUTH_NONE, "main"),
		).rejects.toThrow(GitAuthorizationError);
	});

	it("returns 403 if no write access for receive-pack", async () => {
		await expect(
			handleInfoRefsIso("u", "r", "git-receive-pack", AUTH_READ, "main"),
		).rejects.toThrow(GitAuthorizationError);
	});

	it("returns capability sentinel for empty repo", async () => {
		await seedMemoryRepo("irempty", "r", 0);

		const result = await handleInfoRefsIso(
			"irempty",
			"r",
			"git-upload-pack",
			AUTH_READ,
			"main",
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
			"main",
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
			pktLine(`want ${headOid} side-band-64k\n`),
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

	it("prefetches packs and the loose-object hint before the reachability walk", async () => {
		vi.mocked(detectLooseObjectsHint).mockClear();
		vi.mocked(prefetchAllPacks).mockClear();

		const { headOid } = await seedMemoryRepo("upprefetch", "r", 2);
		const reqBody = Buffer.concat([
			pktLine(`want ${headOid} side-band-64k\n`),
			Buffer.from("0000"),
			pktLine("done\n"),
		]);
		const req = new Request("http://x/git-upload-pack", {
			method: "POST",
			body: reqBody,
		});
		await handleUploadPackIso("upprefetch", "r", req, AUTH_READ);

		expect(vi.mocked(detectLooseObjectsHint)).toHaveBeenCalledWith(
			"upprefetch",
			"r",
		);
		expect(vi.mocked(prefetchAllPacks)).toHaveBeenCalledWith("upprefetch", "r");
	});

	it("returns NAK with pack even when there are 'have' lines (no negotiation)", async () => {
		const { headOid } = await seedMemoryRepo("uphave", "r", 1);

		const reqBody = Buffer.concat([
			pktLine(`want ${headOid} side-band-64k\n`),
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
			pktLine(`want ${sha} side-band-64k\n`),
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
	let repoCounter = 0;
	let repoName: string;
	let gitdir: string;
	const repoFs = { fs: memoryGitFs };

	beforeEach(() => {
		repoCounter += 1;
		repoName = `recv${repoCounter}`;
		gitdir = `repos/u/${repoName}/git`;
		withRepositoryLockMock.mockClear();
		afterRepositoryPushMock.mockClear();
	});

	async function initRepo(): Promise<void> {
		await git.init({
			...repoFs,
			dir: gitdir,
			bare: true,
			defaultBranch: "main",
		});
	}

	function push(body: Uint8Array, ownerDbId?: string) {
		return handleReceivePackIso(
			"u",
			repoName,
			new Request("http://x/git-receive-pack", {
				method: "POST",
				body: body as Uint8Array<ArrayBuffer>,
			}),
			AUTH_WRITE,
			"main",
			ownerDbId,
		);
	}

	const zeroOid = "0".repeat(40);

	it("returns 403 if no write access", async () => {
		const req = new Request("http://x/git-receive-pack", {
			method: "POST",
			body: Buffer.from("0000"),
		});
		await expect(
			handleReceivePackIso("u", "r", req, AUTH_READ, "main"),
		).rejects.toThrow(GitAuthorizationError);
	});

	/**
	 * Build a real packfile for a single new commit, the shape a real push
	 * sends — staged in a separate in-memory repo, as a client's own would be.
	 */
	async function buildPushPack(
		message: string,
		parentOid?: string,
	): Promise<{ packfile: Buffer; commitOid: string }> {
		const staging = {
			fs: createGitFs(new MemoryObjectStore()),
			gitdir: "staging",
		};
		await git.init({ ...staging, dir: staging.gitdir, bare: true });
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

	// The first command line carries the client's capabilities, as git's do.
	function pushBody(command: string, packfile?: Buffer): Buffer {
		return Buffer.concat([
			pktLine(command.replace(/\n$/, "\0report-status\n")),
			Buffer.from("0000"),
			...(packfile ? [packfile] : []),
		]);
	}

	it("parses ref updates, indexes the pack, and writes the ref on a successful push", async () => {
		await initRepo();
		const { packfile, commitOid } = await buildPushPack("first");

		const result = await push(
			pushBody(`${zeroOid} ${commitOid} refs/heads/main\n`, packfile),
		);

		expect(result.status).toBe(200);
		expect(result.headers["Content-Type"]).toBe(
			"application/x-git-receive-pack-result",
		);
		const responseBody = Buffer.from(result.body).toString("utf8");
		expect(responseBody).toContain("unpack ok");
		expect(responseBody).toContain("ok refs/heads/main");

		const headOid = await git.resolveRef({
			...repoFs,
			gitdir,
			ref: "refs/heads/main",
		});
		expect(headOid).toBe(commitOid);
		// The pack and its index went straight into object storage.
		const packKeys = (
			await memoryStore.list(`${gitdir}/objects/pack/`)
		).objects.map((o) => o.key.split("/").pop() ?? "");
		expect(packKeys.some((k) => k.endsWith(".pack"))).toBe(true);
		expect(packKeys.some((k) => k.endsWith(".idx"))).toBe(true);
	});

	it("rejects a non-fast-forward push whose oldOid no longer matches the current ref", async () => {
		await initRepo();
		const first = await buildPushPack("first");
		await push(
			pushBody(
				`${zeroOid} ${first.commitOid} refs/heads/main\n`,
				first.packfile,
			),
		);

		// Client still thinks main is at zeroOid (stale) — server disagrees.
		const second = await buildPushPack("second", first.commitOid);
		const result = await push(
			pushBody(
				`${zeroOid} ${second.commitOid} refs/heads/main\n`,
				second.packfile,
			),
		);

		const responseBody = Buffer.from(result.body).toString("utf8");
		expect(responseBody).toContain("ng refs/heads/main");
		const headOid = await git.resolveRef({
			...repoFs,
			gitdir,
			ref: "refs/heads/main",
		});
		expect(headOid).toBe(first.commitOid); // unchanged
	});

	it("deletes a ref when newOid is all-zero", async () => {
		await initRepo();
		const { packfile, commitOid } = await buildPushPack("first");
		await push(
			pushBody(`${zeroOid} ${commitOid} refs/heads/doomed\n`, packfile),
		);

		const result = await push(
			pushBody(`${commitOid} ${zeroOid} refs/heads/doomed\n`),
		);

		expect(Buffer.from(result.body).toString("utf8")).toContain(
			"ok refs/heads/doomed",
		);
		await expect(
			git.resolveRef({ ...repoFs, gitdir, ref: "refs/heads/doomed" }),
		).rejects.toThrow();
	});

	it("initializes the bare repo in storage if HEAD does not exist", async () => {
		// No initRepo here — handleReceivePackIso's delegate (applyReceivePack)
		// must initialize the repo itself on a first push.
		const { packfile, commitOid } = await buildPushPack("first");

		const result = await push(
			pushBody(`${zeroOid} ${commitOid} refs/heads/main\n`, packfile),
			"owner-db-id",
		);

		expect(result.status).toBe(200);
		expect(await memoryStore.head(`${gitdir}/HEAD`)).not.toBeNull();
	});

	it("runs the push under the repo lock, then does post-push bookkeeping", async () => {
		await initRepo();
		const { packfile, commitOid } = await buildPushPack("first");

		await push(
			pushBody(`${zeroOid} ${commitOid} refs/heads/main\n`, packfile),
			"owner-id",
		);

		expect(withRepositoryLockMock).toHaveBeenCalledTimes(1);
		expect(withRepositoryLockMock).toHaveBeenCalledWith(
			"u",
			repoName,
			expect.any(Function),
		);
		expect(afterRepositoryPushMock).toHaveBeenCalledWith(
			"u",
			repoName,
			"owner-id",
		);
	});

	it("propagates a lock failure", async () => {
		withRepositoryLockMock.mockRejectedValueOnce(new Error("lock timeout"));

		await expect(
			push(pushBody(`${zeroOid} ${"g".repeat(40)} refs/heads/main\n`)),
		).rejects.toThrow("lock timeout");
		expect(afterRepositoryPushMock).not.toHaveBeenCalled();
	});
});

describe("readGitRequestBody", () => {
	it("enforces the cap on a chunked body with no Content-Length", async () => {
		const { readGitRequestBody } = await import("../git-http-iso");
		let sent = 0;
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				sent += 1024;
				controller.enqueue(new Uint8Array(1024));
				if (sent > 1024 * 1024) controller.close();
			},
		});
		const request = new Request("http://x/git-upload-pack", {
			method: "POST",
			body: stream,
			// @ts-expect-error -- Node's fetch requires this for stream bodies
			duplex: "half",
		});
		await expect(readGitRequestBody(request, 64 * 1024)).rejects.toMatchObject({
			statusCode: 413,
		});
		// Stopped reading shortly after the cap, not at the end of the stream.
		expect(sent).toBeLessThan(200 * 1024);
	});

	it("rejects a declared oversize body without reading it", async () => {
		const { readGitRequestBody } = await import("../git-http-iso");
		const request = new Request("http://x/git-upload-pack", {
			method: "POST",
			body: "x".repeat(10),
			headers: { "content-length": String(10 * 1024 * 1024) },
		});
		await expect(readGitRequestBody(request, 1024)).rejects.toMatchObject({
			statusCode: 413,
		});
	});

	it("returns the bytes of a body under the cap", async () => {
		const { readGitRequestBody } = await import("../git-http-iso");
		const body = await readGitRequestBody(
			new Request("http://x/", { method: "POST", body: "0000" }),
			1024,
		);
		expect(new TextDecoder().decode(body)).toBe("0000");
	});
});
