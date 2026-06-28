/**
 * Tests for git-http-iso.ts — isomorphic-git HTTP backend (no native git binary).
 * Covers the pkt-line helpers and the info/refs + upload-pack happy paths.
 */

import { describe, expect, it, vi } from "vitest";

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
		deleteRef: vi.fn(),
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

// --- mock node:fs for receive-pack ---
vi.mock("node:fs", () => ({
	default: {},
	promises: {
		mkdir: vi.fn().mockResolvedValue(undefined),
		writeFile: vi.fn().mockResolvedValue(undefined),
		unlink: vi.fn().mockResolvedValue(undefined),
	},
}));

const g = mockGit.default;

// @ts-expect-error - import after mocks
const { handleInfoRefsIso, handleUploadPackIso } = await import(
	"../git-http-iso"
);

const AUTH_READ = { canRead: true, canWrite: false };
const _AUTH_WRITE = { canRead: true, canWrite: true };
const AUTH_NONE = { canRead: false, canWrite: false };

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

		// Build a minimal pkt-line request: want <sha>\ndone\n
		function pktLine(s: string) {
			const b = Buffer.from(s);
			return Buffer.concat([
				Buffer.from((b.length + 4).toString(16).padStart(4, "0")),
				b,
			]);
		}
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
});
