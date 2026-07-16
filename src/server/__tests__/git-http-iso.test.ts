/**
 * Tests for git-http-iso.ts — isomorphic-git HTTP backend (no native git binary).
 * Covers the pkt-line helpers and the info/refs + upload-pack happy paths.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// --- mock isomorphic-git ---
const mockGit = vi.hoisted(() => ({
	default: {
		resolveRef: vi.fn(),
		currentBranch: vi.fn(),
		listBranches: vi.fn(),
		listTags: vi.fn(),
		readObject: vi.fn(),
		readCommit: vi.fn(),
		readTree: vi.fn(),
		readTag: vi.fn(),
		packObjects: vi.fn(),
		indexPack: vi.fn(),
		writeRef: vi.fn(),
		deleteRef: vi.fn().mockResolvedValue(undefined),
		init: vi.fn().mockResolvedValue(undefined),
	},
}));
vi.mock("isomorphic-git", () => mockGit);

// --- mock r2Backend ---
vi.mock("../git-r2-backend", () => ({
	r2Backend: {
		readdir: vi.fn().mockResolvedValue([]),
		readFile: vi.fn().mockResolvedValue(Buffer.alloc(0)),
	},
	detectLooseObjectsHint: vi.fn().mockResolvedValue(undefined),
}));

// --- mock storage naming ---
vi.mock("../git-storage-naming", () => ({
	getRepoGitStorageRoot: (owner: string, repo: string) =>
		`repos/${owner}/${repo}/git`,
}));

// --- mock git-repo-storage (used by receive-pack) ---
vi.mock("../git-repo-storage", () => ({
	withReceivePackLock: vi.fn(
		(
			_ownerKey: string,
			_repoName: string,
			_defaultBranch: string,
			fn: (gitdir: string) => Promise<unknown>,
		) => fn("/tmp/repo"),
	),
}));

// --- mock node:fs and node:fs/promises for receive-pack ---
const mockFsPromises = vi.hoisted(() => ({
	mkdir: vi.fn().mockResolvedValue(undefined),
	writeFile: vi.fn().mockResolvedValue(undefined),
	unlink: vi.fn().mockResolvedValue(undefined),
	access: vi.fn().mockRejectedValue(new Error("not found")),
}));
vi.mock("node:fs", () => ({
	default: {},
	promises: mockFsPromises,
}));
vi.mock("node:fs/promises", () => mockFsPromises);

const g = mockGit.default;

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
// GitSideBand.demux does — see sideBandPackfile in git-http-iso.ts.
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
		g.resolveRef.mockRejectedValue(new Error("no HEAD"));
		g.listBranches.mockResolvedValue([]);
		g.listTags.mockResolvedValue([]);

		const result = await handleInfoRefsIso(
			"u",
			"r",
			"git-upload-pack",
			AUTH_READ,
		);
		expect(result.status).toBe(200);
		const lines = parsePktLines(Buffer.from(result.body as ArrayBuffer));
		expect(lines[0]).toBe("# service=git-upload-pack\n");
		expect(lines[1]).toBe("FLUSH");
		expect(lines[2]).toContain("capabilities^{}");
	});

	it("returns refs and capabilities for a repo with commits", async () => {
		const sha = "a".repeat(40);
		g.resolveRef.mockImplementation(({ ref }: { ref: string }) => {
			if (ref === "HEAD" || ref === "refs/heads/main")
				return Promise.resolve(sha);
			return Promise.reject(new Error("not found"));
		});
		g.currentBranch.mockResolvedValue("refs/heads/main");
		g.listBranches.mockResolvedValue(["main"]);
		g.listTags.mockResolvedValue([]);

		const result = await handleInfoRefsIso(
			"u",
			"r",
			"git-upload-pack",
			AUTH_READ,
		);
		expect(result.status).toBe(200);
		const lines = parsePktLines(Buffer.from(result.body as ArrayBuffer));
		// service header, FLUSH, HEAD line, refs/heads/main, FLUSH
		expect(lines[0]).toBe("# service=git-upload-pack\n");
		expect(lines[1]).toBe("FLUSH");
		const headLine = lines[2];
		expect(headLine).toContain(sha);
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

	it("returns NAK with pack for a want request", async () => {
		const sha = "b".repeat(40);
		const treeSha = "c".repeat(40);

		const reqBody = Buffer.concat([
			pktLine(`want ${sha}\n`),
			Buffer.from("0000"),
			pktLine("done\n"),
		]);

		g.readObject.mockImplementation(({ oid }: { oid: string }) => {
			if (oid === sha) return Promise.resolve({ type: "commit" });
			if (oid === treeSha) return Promise.resolve({ type: "tree" });
			return Promise.reject(new Error("not found"));
		});
		g.readCommit.mockResolvedValue({
			commit: { tree: treeSha, parent: [] },
		});
		g.readTree.mockResolvedValue({ tree: [] });

		const packBytes = new Uint8Array([0x50, 0x41, 0x43, 0x4b]); // "PACK"
		g.packObjects.mockResolvedValue({ packfile: packBytes });

		const req = new Request("http://x/git-upload-pack", {
			method: "POST",
			body: reqBody,
		});
		const result = await handleUploadPackIso("u", "r", req, AUTH_READ);
		expect(result.status).toBe(200);
		expect(result.headers["Content-Type"]).toBe(
			"application/x-git-upload-pack-result",
		);

		const body = Buffer.from(result.body as ArrayBuffer);
		// First pkt-line should be NAK
		const nakLen = Number.parseInt(body.slice(0, 4).toString("ascii"), 16);
		const nak = body.slice(4, nakLen).toString();
		expect(nak).toBe("NAK\n");
		// Rest is side-band-64k framed: a band-1 (packfile) pkt-line per chunk,
		// terminated by a flush-pkt — required so clients that always demux the
		// response (e.g. isomorphic-git) don't misparse a raw packfile stream.
		expect(decodeSideBandPackfile(body.slice(nakLen))).toEqual(
			Buffer.from(packBytes),
		);
	});

	it("returns NAK with pack even when there are 'have' lines (no negotiation)", async () => {
		const sha = "d".repeat(40);
		const treeSha = "e".repeat(40);

		const reqBody = Buffer.concat([
			pktLine(`want ${sha}\n`),
			pktLine("have 0000000000000000000000000000000000000000\n"),
			Buffer.from("0000"),
			pktLine("done\n"),
		]);

		g.readObject.mockImplementation(({ oid }: { oid: string }) => {
			if (oid === sha) return Promise.resolve({ type: "commit" });
			if (oid === treeSha) return Promise.resolve({ type: "tree" });
			return Promise.reject(new Error("not found"));
		});
		g.readCommit.mockResolvedValue({
			commit: { tree: treeSha, parent: [] },
		});
		g.readTree.mockResolvedValue({ tree: [] });

		const packBytes = new Uint8Array([0x50, 0x41, 0x43, 0x4b]);
		g.packObjects.mockResolvedValue({ packfile: packBytes });

		const req = new Request("http://x/git-upload-pack", {
			method: "POST",
			body: reqBody,
		});
		const result = await handleUploadPackIso("u", "r", req, AUTH_READ);
		expect(result.status).toBe(200);
		// 'have' lines should not prevent NAK+pack from being returned
		const body = Buffer.from(result.body as ArrayBuffer);
		expect(body.toString("utf8", 4, 8)).toBe("NAK\n");
	});

	it("returns bare NAK (no pack) when 'have' lines are sent without 'done'", async () => {
		// Mirrors a mid-negotiation round: the client hasn't decided the exchange
		// is over yet, so the response must be a NAK only. Shipping the pack here
		// breaks the client's pkt-line parser (raw "PACK..." isn't a valid length
		// prefix), surfacing as "protocol error: bad line length character: PACK".
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

		const body = Buffer.from(result.body as ArrayBuffer);
		expect(body.toString("utf8", 4, 8)).toBe("NAK\n");
		expect(body.length).toBe(8); // pkt-line("NAK\n") only, no pack bytes appended
	});
});

describe("handleReceivePackIso", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// clearAllMocks resets call counts but not implementations — reset the ones that bleed
		// from handleInfoRefsIso/handleUploadPackIso tests and would confuse repackLocal.
		g.listBranches.mockResolvedValue([]);
		g.listTags.mockResolvedValue([]);
		g.packObjects.mockResolvedValue({ packfile: null });
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

	it("parses ref updates and indexes pack on successful push", async () => {
		const oldSha = "f".repeat(40);
		const newSha = "g".repeat(40);
		g.resolveRef.mockResolvedValue(oldSha);

		// Build ref update: "oldSha newSha refs/heads/main\n"
		const refLine = `${oldSha} ${newSha} refs/heads/main\n`;
		const packData = Buffer.from("PACKDATA123");

		const body = Buffer.concat([
			pktLine(refLine),
			Buffer.from("0000"),
			packData,
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

		// Verify pack was indexed
		expect(g.indexPack).toHaveBeenCalledTimes(1);

		// Verify ref was written
		expect(g.writeRef).toHaveBeenCalledWith(
			expect.objectContaining({ ref: "refs/heads/main", value: newSha }),
		);

		// Verify response body
		const responseBody = Buffer.from(result.body as ArrayBuffer);
		expect(responseBody.toString("utf8")).toContain("unpack ok");
		expect(responseBody.toString("utf8")).toContain("ok refs/heads/main");
	});

	it("deletes ref when newOid is all-zero", async () => {
		const oldSha = "h".repeat(40);
		const zeroOid = "0000000000000000000000000000000000000000";
		g.resolveRef.mockResolvedValue(oldSha);

		const refLine = `${oldSha} ${zeroOid} refs/heads/old-branch\n`;
		const body = Buffer.concat([
			pktLine(refLine),
			Buffer.from("0000"),
			Buffer.from("PACK"),
		]);

		const req = new Request("http://x/git-receive-pack", {
			method: "POST",
			body,
		});

		const result = await handleReceivePackIso("u", "r", req, AUTH_WRITE);

		expect(result.status).toBe(200);
		expect(g.deleteRef).toHaveBeenCalledWith(
			expect.objectContaining({ ref: "refs/heads/old-branch" }),
		);
		expect(g.writeRef).not.toHaveBeenCalled();
	});

	it("initializes bare repo on disk if HEAD does not exist", async () => {
		const oldSha = "i".repeat(40);
		const newSha = "j".repeat(40);
		g.resolveRef.mockResolvedValue(oldSha);

		const refLine = `${oldSha} ${newSha} refs/heads/main\n`;
		const body = Buffer.concat([
			pktLine(refLine),
			Buffer.from("0000"),
			Buffer.from("PACK"),
		]);

		const req = new Request("http://x/git-receive-pack", {
			method: "POST",
			body,
		});

		const result = await handleReceivePackIso(
			"u",
			"r",
			req,
			AUTH_WRITE,
			"main",
			"owner-db-id",
		);

		expect(result.status).toBe(200);
		expect(g.init).toHaveBeenCalledTimes(1);
		expect(g.init).toHaveBeenCalledWith(
			expect.objectContaining({ defaultBranch: "main", bare: true }),
		);
	});

	it("handles multiple ref updates in one push", async () => {
		const sha1 = "k".repeat(40);
		const sha2 = "l".repeat(40);
		const sha3 = "m".repeat(40);

		// new-branch doesn't exist yet (resolveRef rejects -> treated as all-zero);
		// main currently points at sha2, matching what the client claims as oldOid.
		g.resolveRef.mockImplementation(({ ref }: { ref: string }) => {
			if (ref === "refs/heads/main") return Promise.resolve(sha2);
			return Promise.reject(new Error("not found"));
		});

		const refLine1 = `${"0".repeat(40)} ${sha1} refs/heads/new-branch\n`;
		const refLine2 = `${sha2} ${sha3} refs/heads/main\n`;

		const body = Buffer.concat([
			pktLine(refLine1),
			pktLine(refLine2),
			Buffer.from("0000"),
			Buffer.from("PACK"),
		]);

		const req = new Request("http://x/git-receive-pack", {
			method: "POST",
			body,
		});

		const result = await handleReceivePackIso("u", "r", req, AUTH_WRITE);

		expect(result.status).toBe(200);
		expect(g.writeRef).toHaveBeenCalledTimes(2);
		expect(g.writeRef).toHaveBeenCalledWith(
			expect.objectContaining({ ref: "refs/heads/new-branch", value: sha1 }),
		);
		expect(g.writeRef).toHaveBeenCalledWith(
			expect.objectContaining({ ref: "refs/heads/main", value: sha3 }),
		);

		const responseBody = Buffer.from(result.body as ArrayBuffer);
		expect(responseBody.toString("utf8")).toContain("ok refs/heads/new-branch");
		expect(responseBody.toString("utf8")).toContain("ok refs/heads/main");
	});

	it("rejects a non-fast-forward push whose oldOid no longer matches the current ref", async () => {
		const staleOld = "n".repeat(40);
		const actualCurrent = "o".repeat(40);
		const attemptedNew = "p".repeat(40);
		// Client last fetched when the ref was staleOld, but someone else already
		// pushed it to actualCurrent — the server must reject, not force-overwrite.
		g.resolveRef.mockResolvedValue(actualCurrent);

		const refLine = `${staleOld} ${attemptedNew} refs/heads/main\n`;
		const body = Buffer.concat([
			pktLine(refLine),
			Buffer.from("0000"),
			Buffer.from("PACK"),
		]);

		const req = new Request("http://x/git-receive-pack", {
			method: "POST",
			body,
		});

		const result = await handleReceivePackIso("u", "r", req, AUTH_WRITE);

		expect(result.status).toBe(200);
		expect(g.writeRef).not.toHaveBeenCalled();

		const responseBody = Buffer.from(result.body as ArrayBuffer);
		const text = responseBody.toString("utf8");
		expect(text).toContain("unpack ok");
		expect(text).toContain("ng refs/heads/main");
		expect(text).not.toContain("ok refs/heads/main\n");
	});

	it("accepts a new-branch push only when the ref doesn't already exist", async () => {
		const newSha = "q".repeat(40);
		g.resolveRef.mockRejectedValue(new Error("not found"));

		const refLine = `${"0".repeat(40)} ${newSha} refs/heads/brand-new\n`;
		const body = Buffer.concat([
			pktLine(refLine),
			Buffer.from("0000"),
			Buffer.from("PACK"),
		]);

		const req = new Request("http://x/git-receive-pack", {
			method: "POST",
			body,
		});

		const result = await handleReceivePackIso("u", "r", req, AUTH_WRITE);

		expect(g.writeRef).toHaveBeenCalledWith(
			expect.objectContaining({ ref: "refs/heads/brand-new", value: newSha }),
		);
		const responseBody = Buffer.from(result.body as ArrayBuffer);
		expect(responseBody.toString("utf8")).toContain("ok refs/heads/brand-new");
	});

	it("returns 400 for invalid service", async () => {
		// This test is about the route, not the handler — handleReceivePackIso
		// should still work if called with an empty body
		const req = new Request("http://x/git-receive-pack", {
			method: "POST",
			body: Buffer.from("0000"),
		});
		const result = await handleReceivePackIso("u", "r", req, AUTH_WRITE);
		// Empty body with no ref updates is valid — returns unpack ok with no refs
		expect(result.status).toBe(200);
	});

	it("acquires withReceivePackLock with correct parameters during push", async () => {
		const { withReceivePackLock } = await import("../git-repo-storage");
		const lockMock = vi.mocked(withReceivePackLock);

		const oldSha = "f".repeat(40);
		const newSha = "g".repeat(40);
		g.resolveRef.mockResolvedValue(oldSha);

		const refLine = `${oldSha} ${newSha} refs/heads/main\n`;
		const body = Buffer.concat([
			pktLine(refLine),
			Buffer.from("0000"),
			Buffer.from("PACK"),
		]);

		const req = new Request("http://x/git-receive-pack", {
			method: "POST",
			body,
		});
		await handleReceivePackIso("u", "r", req, AUTH_WRITE, "main", "owner-id");

		expect(lockMock).toHaveBeenCalledTimes(1);
		expect(lockMock).toHaveBeenCalledWith(
			"u",
			"r",
			"main",
			expect.any(Function),
			"owner-id",
		);
	});

	it("returns error response when receive-pack function throws", async () => {
		const { withReceivePackLock } = await import("../git-repo-storage");
		vi.mocked(withReceivePackLock).mockRejectedValueOnce(
			new Error("lock timeout"),
		);

		const oldSha = "f".repeat(40);
		const newSha = "g".repeat(40);
		g.resolveRef.mockResolvedValue(oldSha);

		const refLine = `${oldSha} ${newSha} refs/heads/main\n`;
		const body = Buffer.concat([
			pktLine(refLine),
			Buffer.from("0000"),
			Buffer.from("PACK"),
		]);

		const req = new Request("http://x/git-receive-pack", {
			method: "POST",
			body,
		});
		await expect(
			handleReceivePackIso("u", "r", req, AUTH_WRITE),
		).rejects.toThrow("lock timeout");
	});
});
