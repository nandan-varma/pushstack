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
	getCachedObject: vi.fn(),
	setCachedObject: vi.fn(),
	deleteCachedObject: vi.fn(),
	invalidateObjectCache: vi.fn(),
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
import { R2Backend } from "../git-r2-backend";

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
			contentType: undefined,
			size: content.length,
			etag: undefined,
		});

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
			contentType: undefined,
			size: content.length,
			etag: undefined,
		});

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
		vi.mocked(r2ops.uploadToR2).mockResolvedValue({
			key: "mock-key",
			bucketName: "mock-bucket",
		});

		const backend = new R2Backend();
		await backend.writeFile(
			`${REPO_PATH}/HEAD`,
			Buffer.from("ref: refs/heads/main"),
		);

		expect(r2ops.uploadToR2).toHaveBeenCalledOnce();
		expect(cache.deleteCache).toHaveBeenCalledTimes(2); // file + parent dir listing
	});

	it("uses text/plain content-type for refs/ paths", async () => {
		vi.mocked(r2ops.uploadToR2).mockResolvedValue({
			key: "mock-key",
			bucketName: "mock-bucket",
		});

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
		vi.mocked(r2ops.uploadToR2).mockResolvedValue({
			key: "mock-key",
			bucketName: "mock-bucket",
		});

		const backend = new R2Backend();
		await backend.writeFile(
			`${REPO_PATH}/HEAD`,
			Buffer.from("ref: refs/heads/main"),
		);

		expect(r2ops.uploadToR2).toHaveBeenCalledWith(
			expect.any(String),
			expect.any(Buffer),
			"text/plain",
		);
	});

	it("uses application/octet-stream for objects/ paths", async () => {
		vi.mocked(r2ops.uploadToR2).mockResolvedValue({
			key: "mock-key",
			bucketName: "mock-bucket",
		});

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

	// Regression: a directory stat'd (and negatively cached) as "missing" before
	// it had any content must stop being reported missing once a file is written
	// under it — including the gitdir root itself, since that's stat'd on every
	// isomorphic-git operation. invalidateObjectCache(cacheKey) only reaches the
	// written file's own key (and any of its descendants), never its ancestors,
	// so ancestor stat markers have to be cleared explicitly.
	it("clears stat markers on every ancestor directory, including the repo root", async () => {
		vi.mocked(r2ops.uploadToR2).mockResolvedValue({
			key: "mock-key",
			bucketName: "mock-bucket",
		});

		const backend = new R2Backend();
		await backend.writeFile(
			`${REPO_PATH}/refs/heads/main`,
			Buffer.from("abc123"),
		);

		const clearedKeys = vi
			.mocked(cache.deleteCachedObject)
			.mock.calls.map(([key]) => key);
		expect(clearedKeys).toEqual(
			expect.arrayContaining([
				"alice/myrepo/refs/heads",
				"alice/myrepo/refs",
				"alice/myrepo/",
			]),
		);
	});
});

describe("R2Backend.unlink", () => {
	it("clears stat markers on every ancestor directory", async () => {
		vi.mocked(r2ops.deleteFromR2).mockResolvedValue(undefined);

		const backend = new R2Backend();
		await backend.unlink(`${REPO_PATH}/refs/heads/main`);

		const clearedKeys = vi
			.mocked(cache.deleteCachedObject)
			.mock.calls.map(([key]) => key);
		expect(clearedKeys).toEqual(
			expect.arrayContaining([
				"alice/myrepo/refs/heads",
				"alice/myrepo/refs",
				"alice/myrepo/",
			]),
		);
	});
});

describe("R2Backend.rmdir", () => {
	it("clears stat markers on every ancestor directory", async () => {
		vi.mocked(r2ops.listAllR2Files).mockResolvedValue([]);

		const backend = new R2Backend();
		await backend.rmdir(`${REPO_PATH}/refs/heads`);

		const clearedKeys = vi
			.mocked(cache.deleteCachedObject)
			.mock.calls.map(([key]) => key);
		expect(clearedKeys).toEqual(
			expect.arrayContaining(["alice/myrepo/refs", "alice/myrepo/"]),
		);
	});
});
