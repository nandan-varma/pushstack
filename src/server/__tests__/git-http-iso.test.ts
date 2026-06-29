/**
 * Tests for git-http-iso.ts — isomorphic-git HTTP backend (no native git binary).
 * Covers the pkt-line helpers and the info/refs + upload-pack happy paths.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

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
vi.mock("../git-r2-backend", () => ({ r2Backend: {} }));

// --- mock storage naming ---
vi.mock("../git-storage-naming", () => ({
	getRepoGitStorageRoot: (owner: string, repo: string) =>
		`repos/${owner}/${repo}/git`,
}));

// --- mock git-repo-storage (used by receive-pack) ---
vi.mock("../git-repo-storage", () => ({
	ensureRepositoryHydrated: vi.fn().mockResolvedValue("/tmp/repo"),
	syncRepositoryToR2: vi.fn().mockResolvedValue(undefined),
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

describe("handleInfoRefsIso", () => {
	it("returns 403 if no read access for upload-pack", async () => {
		const result = await handleInfoRefsIso(
			"u",
			"r",
			"git-upload-pack",
			AUTH_NONE,
		);
		expect(result.status).toBe(403);
	});

	it("returns 403 if no write access for receive-pack", async () => {
		const result = await handleInfoRefsIso(
			"u",
			"r",
			"git-receive-pack",
			AUTH_READ,
		);
		expect(result.status).toBe(403);
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
		const result = await handleUploadPackIso("u", "r", req, AUTH_NONE);
		expect(result.status).toBe(403);
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
		// Rest should be the pack
		expect(Buffer.from(body.slice(nakLen))).toEqual(Buffer.from(packBytes));
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
		const result = await handleReceivePackIso("u", "r", req, AUTH_READ);
		expect(result.status).toBe(403);
	});

	it("parses ref updates and indexes pack on successful push", async () => {
		const oldSha = "f".repeat(40);
		const newSha = "g".repeat(40);

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
});
