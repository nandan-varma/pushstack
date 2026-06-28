import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("#/lib/r2-operations", () => ({
	downloadFromR2: vi.fn(),
	uploadToR2: vi.fn(),
	deleteFromR2: vi.fn(),
	listR2Files: vi.fn(),
	listAllR2Files: vi.fn(),
	bulkDeleteFromR2: vi.fn(),
	fileExistsInR2: vi.fn(),
}));

vi.mock("../git-cache", () => ({
	getCache: vi.fn(),
	setCache: vi.fn(),
	deleteCache: vi.fn(),
	invalidateCache: vi.fn(),
}));

vi.mock("../git-storage-naming", () => ({
	getRepoGitStoragePrefix: vi.fn(
		(owner: string, repo: string) => `repos/${owner}/${repo}/git/`,
	),
	getRepoGitStorageRoot: vi.fn(
		(owner: string, repo: string) => `repos/${owner}/${repo}`,
	),
}));

import * as r2ops from "#/lib/r2-operations";
import * as cache from "../git-cache";
import { GitObjectNotFoundError, GitRefNotFoundError } from "../git-errors";
import { R2Backend, R2RefBackend } from "../git-r2-backend";

const REPO_PATH = "repos/alice/myrepo/git";

beforeEach(() => {
	vi.clearAllMocks();
});

describe("R2Backend.readFile", () => {
	it("returns cached value without calling R2", async () => {
		const buf = Buffer.from("ref: refs/heads/main");
		vi.mocked(cache.getCache).mockReturnValue(buf);

		const backend = new R2Backend();
		const result = await backend.readFile(`${REPO_PATH}/HEAD`);

		expect(result).toBe(buf);
		expect(r2ops.downloadFromR2).not.toHaveBeenCalled();
	});

	it("fetches from R2 on cache miss and caches the result", async () => {
		const content = Buffer.from("ref: refs/heads/main");
		vi.mocked(cache.getCache).mockReturnValue(null);
		vi.mocked(r2ops.downloadFromR2).mockResolvedValue({
			content,
			size: content.length,
		} as any);

		const backend = new R2Backend();
		const result = await backend.readFile(`${REPO_PATH}/HEAD`);

		expect(r2ops.downloadFromR2).toHaveBeenCalledOnce();
		expect(cache.setCache).toHaveBeenCalledOnce();
		expect(Buffer.isBuffer(result)).toBe(true);
	});

	it("throws ENOENT error on 404", async () => {
		vi.mocked(cache.getCache).mockReturnValue(null);
		vi.mocked(r2ops.downloadFromR2).mockRejectedValue({ name: "NoSuchKey" });

		const backend = new R2Backend();
		await expect(backend.readFile(`${REPO_PATH}/HEAD`)).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	it("returns string when encoding is utf8", async () => {
		const content = Buffer.from("ref: refs/heads/main");
		vi.mocked(cache.getCache).mockReturnValue(null);
		vi.mocked(r2ops.downloadFromR2).mockResolvedValue({
			content,
			size: content.length,
		} as any);

		const backend = new R2Backend();
		const result = await backend.readFile(`${REPO_PATH}/HEAD`, {
			encoding: "utf8",
		});

		expect(typeof result).toBe("string");
		expect(result).toBe("ref: refs/heads/main");
	});
});

describe("R2Backend.writeFile", () => {
	it("uploads to R2 and invalidates cache", async () => {
		vi.mocked(r2ops.uploadToR2).mockResolvedValue(undefined as any);

		const backend = new R2Backend();
		await backend.writeFile(`${REPO_PATH}/HEAD`, Buffer.from("ref: refs/heads/main"));

		expect(r2ops.uploadToR2).toHaveBeenCalledOnce();
		expect(cache.deleteCache).toHaveBeenCalledOnce();
	});

	it("uses text/plain content-type for refs/ paths", async () => {
		vi.mocked(r2ops.uploadToR2).mockResolvedValue(undefined as any);

		const backend = new R2Backend();
		await backend.writeFile(
			`${REPO_PATH}/refs/heads/main`,
			Buffer.from("abc123"),
		);

		expect(r2ops.uploadToR2).toHaveBeenCalledWith(
			expect.any(String),
			expect.any(Buffer),
			"text/plain",
		);
	});

	it("uses text/plain content-type for HEAD file", async () => {
		vi.mocked(r2ops.uploadToR2).mockResolvedValue(undefined as any);

		const backend = new R2Backend();
		await backend.writeFile(`${REPO_PATH}/HEAD`, Buffer.from("ref: refs/heads/main"));

		expect(r2ops.uploadToR2).toHaveBeenCalledWith(
			expect.any(String),
			expect.any(Buffer),
			"text/plain",
		);
	});

	it("uses application/octet-stream for objects/ paths", async () => {
		vi.mocked(r2ops.uploadToR2).mockResolvedValue(undefined as any);

		const backend = new R2Backend();
		await backend.writeFile(
			`${REPO_PATH}/objects/ab/cdef1234`,
			Buffer.from([0x78, 0x01]),
		);

		expect(r2ops.uploadToR2).toHaveBeenCalledWith(
			expect.any(String),
			expect.any(Buffer),
			"application/octet-stream",
		);
	});
});

describe("R2RefBackend.writeRef", () => {
	it("writes ref without expectedValue check when expectedValue is undefined", async () => {
		vi.mocked(r2ops.uploadToR2).mockResolvedValue(undefined as any);

		const backend = new R2RefBackend();
		await backend.writeRef("alice", "myrepo", "refs/heads/main", "abc123");

		expect(r2ops.uploadToR2).toHaveBeenCalledOnce();
		expect(r2ops.downloadFromR2).not.toHaveBeenCalled();
	});

	it("throws conflict error when current ref does not match expectedValue", async () => {
		vi.mocked(cache.getCache).mockReturnValue(null);
		vi.mocked(r2ops.downloadFromR2).mockResolvedValue({
			content: Buffer.from("old-sha\n"),
			size: 8,
		} as any);

		const backend = new R2RefBackend();
		await expect(
			backend.writeRef("alice", "myrepo", "refs/heads/main", "new-sha", "expected-sha"),
		).rejects.toThrow(/conflict/i);
	});

	it("writes successfully when current ref matches expectedValue", async () => {
		vi.mocked(cache.getCache).mockReturnValue(null);
		vi.mocked(r2ops.downloadFromR2).mockResolvedValue({
			content: Buffer.from("expected-sha\n"),
			size: 13,
		} as any);
		vi.mocked(r2ops.uploadToR2).mockResolvedValue(undefined as any);

		const backend = new R2RefBackend();
		await expect(
			backend.writeRef("alice", "myrepo", "refs/heads/main", "new-sha", "expected-sha"),
		).resolves.toBeUndefined();

		expect(r2ops.uploadToR2).toHaveBeenCalledOnce();
	});
});
