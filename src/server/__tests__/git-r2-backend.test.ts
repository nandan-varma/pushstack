import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("#/lib/r2-operations", () => ({
	downloadFromR2: vi.fn(),
	uploadToR2: vi.fn(),
	deleteFromR2: vi.fn(),
	listR2Files: vi.fn(),
	listAllR2Files: vi.fn(),
	bulkDeleteFromR2: vi.fn(),
	fileExistsInR2: vi.fn(),
	headR2Object: vi.fn(),
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
		(owner: string, repo: string) => `repos/${owner}/${repo}/git`,
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

	// Regression: "packed-refs" and "shallow" are files nothing in this codebase
	// ever writes (all refs are always loose; this app never advertises or
	// creates shallow clones) — isomorphic-git probes both on essentially every
	// ref resolution / merge, so they must 404 without ever touching R2.
	it.each([
		"packed-refs",
		"shallow",
	])("throws ENOENT for %s without calling R2", async (structurallyAbsentPath) => {
		vi.mocked(cache.getCache).mockReturnValue(null);

		const backend = new R2Backend();
		await expect(
			backend.readFile(`${REPO_PATH}/${structurallyAbsentPath}`),
		).rejects.toMatchObject({ code: "ENOENT" });
		expect(r2ops.downloadFromR2).not.toHaveBeenCalled();
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
	// so a stale "missing" ancestor marker has to be cleared explicitly.
	it("clears a 'missing' stat marker on every ancestor directory, including the repo root", async () => {
		vi.mocked(r2ops.uploadToR2).mockResolvedValue({
			key: "mock-key",
			bucketName: "mock-bucket",
		});
		vi.mocked(cache.getCachedObject).mockReturnValue({ kind: "missing" });

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

	// A "dir" marker is already correct (a write underneath it can only ever
	// keep it a directory) — clearing it anyway would force the next stat() to
	// pay a full HeadObject+ListObjects round trip for a fact that hadn't
	// changed. Measured: this was costing several seconds per commit by
	// invalidating the gitdir root's own "dir" marker on every object write.
	it("does not clear a 'dir' stat marker on ancestor directories", async () => {
		vi.mocked(r2ops.uploadToR2).mockResolvedValue({
			key: "mock-key",
			bucketName: "mock-bucket",
		});
		vi.mocked(cache.getCachedObject).mockReturnValue({ kind: "dir" });

		const backend = new R2Backend();
		await backend.writeFile(
			`${REPO_PATH}/refs/heads/main`,
			Buffer.from("abc123"),
		);

		expect(cache.deleteCachedObject).not.toHaveBeenCalled();
	});
});

describe("R2Backend.unlink", () => {
	it("clears a 'missing' stat marker on every ancestor directory", async () => {
		vi.mocked(r2ops.deleteFromR2).mockResolvedValue({
			deleted: true,
			key: "mock-key",
		});
		vi.mocked(cache.getCachedObject).mockReturnValue({ kind: "missing" });

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

	it("does not clear a 'dir' stat marker on ancestor directories", async () => {
		vi.mocked(r2ops.deleteFromR2).mockResolvedValue({
			deleted: true,
			key: "mock-key",
		});
		vi.mocked(cache.getCachedObject).mockReturnValue({ kind: "dir" });

		const backend = new R2Backend();
		await backend.unlink(`${REPO_PATH}/refs/heads/main`);

		expect(cache.deleteCachedObject).not.toHaveBeenCalled();
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

	it("bulk-deletes all files under the prefix and invalidates cache", async () => {
		const files = [
			{ key: "repos/alice/myrepo/git/refs/heads/main", size: 10 },
			{ key: "repos/alice/myrepo/git/refs/heads/dev", size: 20 },
		];
		vi.mocked(r2ops.listAllR2Files).mockResolvedValue(files);

		const backend = new R2Backend();
		await backend.rmdir(`${REPO_PATH}/refs/heads`);

		expect(r2ops.bulkDeleteFromR2).toHaveBeenCalledWith([
			"repos/alice/myrepo/git/refs/heads/main",
			"repos/alice/myrepo/git/refs/heads/dev",
		]);
		expect(cache.invalidateCache).toHaveBeenCalled();
		expect(cache.invalidateObjectCache).toHaveBeenCalled();
	});

	it("clears 'dir' markers unconditionally (unlike writeFile which preserves them)", async () => {
		// rmdir can empty out a directory entirely, turning "dir" back to "missing"
		vi.mocked(r2ops.listAllR2Files).mockResolvedValue([]);
		vi.mocked(cache.getCachedObject).mockReturnValue({ kind: "dir" });

		const backend = new R2Backend();
		await backend.rmdir(`${REPO_PATH}/refs/heads`);

		// rmdir uses deleteCachedObject unconditionally (not just for "missing")
		expect(cache.deleteCachedObject).toHaveBeenCalled();
	});
});

describe("R2Backend.stat", () => {
	it("throws ENOENT for structurally absent paths (packed-refs, shallow)", async () => {
		const backend = new R2Backend();

		await expect(
			backend.stat(`${REPO_PATH}/packed-refs`),
		).rejects.toMatchObject({ code: "ENOENT" });
		await expect(backend.stat(`${REPO_PATH}/shallow`)).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	it("returns file stat from content cache", async () => {
		const buf = Buffer.from("content");
		vi.mocked(cache.getCache).mockReturnValue(buf);

		const backend = new R2Backend();
		const stat = await backend.stat(`${REPO_PATH}/HEAD`);

		expect(stat.isFile()).toBe(true);
		expect(stat.size).toBe(buf.length);
		expect(r2ops.headR2Object).not.toHaveBeenCalled();
	});

	it("returns dir stat from cached 'dir' marker", async () => {
		vi.mocked(cache.getCache).mockReturnValue(null);
		vi.mocked(cache.getCachedObject).mockReturnValue({ kind: "dir" });

		const backend = new R2Backend();
		const stat = await backend.stat(`${REPO_PATH}/refs`);

		expect(stat.isDirectory()).toBe(true);
		expect(r2ops.headR2Object).not.toHaveBeenCalled();
	});

	it("throws ENOENT from cached 'missing' marker", async () => {
		vi.mocked(cache.getCache).mockReturnValue(null);
		vi.mocked(cache.getCachedObject).mockReturnValue({ kind: "missing" });

		const backend = new R2Backend();
		await expect(
			backend.stat(`${REPO_PATH}/refs/heads/nonexistent`),
		).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("skips loose-object path prefix check for performance", async () => {
		// A loose-object path like objects/ab/cdef... is never a directory,
		// so the ListObjects fallback is skipped — only HeadObject runs
		vi.mocked(cache.getCache).mockReturnValue(null);
		vi.mocked(cache.getCachedObject).mockReturnValue(null);
		vi.mocked(r2ops.headR2Object).mockResolvedValue(null);

		const backend = new R2Backend();
		await expect(
			backend.stat(
				`${REPO_PATH}/objects/ab/cdef1234567890abcdef1234567890abcdef12`,
			),
		).rejects.toMatchObject({ code: "ENOENT" });

		// headR2Object was called, but listR2Files was NOT called (loose-object shortcut)
		expect(r2ops.headR2Object).toHaveBeenCalled();
		expect(r2ops.listR2Files).not.toHaveBeenCalled();
	});
});

describe("R2Backend.readFile", () => {
	it("short-circuits to ENOENT when loose object hint is 'none'", async () => {
		vi.mocked(cache.getCache).mockReturnValue(null);
		vi.mocked(cache.getCachedObject).mockImplementation((key: string) => {
			if (key === "loose-hint:alice/myrepo") return { kind: "none" };
			return null;
		});

		const backend = new R2Backend();
		await expect(
			backend.readFile(
				`${REPO_PATH}/objects/ab/cdef1234567890abcdef1234567890abcdef12`,
			),
		).rejects.toMatchObject({ code: "ENOENT" });

		expect(r2ops.downloadFromR2).not.toHaveBeenCalled();
	});

	it("throws ENOENT from missing marker cache hit", async () => {
		vi.mocked(cache.getCache).mockReturnValue(null);
		vi.mocked(cache.getCachedObject).mockImplementation((key: string) => {
			if (key === "alice/myrepo/refs/heads/main") return { kind: "missing" };
			return null;
		});

		const backend = new R2Backend();
		await expect(
			backend.readFile(`${REPO_PATH}/refs/heads/main`),
		).rejects.toMatchObject({ code: "ENOENT" });

		expect(r2ops.downloadFromR2).not.toHaveBeenCalled();
	});

	it("stores MISSING marker and throws ENOENT on R2 404", async () => {
		vi.mocked(cache.getCache).mockReturnValue(null);
		vi.mocked(cache.getCachedObject).mockReturnValue(null);
		vi.mocked(r2ops.downloadFromR2).mockRejectedValue({ name: "NoSuchKey" });

		const backend = new R2Backend();
		await expect(
			backend.readFile(`${REPO_PATH}/refs/heads/main`),
		).rejects.toMatchObject({ code: "ENOENT" });

		expect(cache.setCachedObject).toHaveBeenCalledWith(
			"alice/myrepo/refs/heads/main",
			expect.objectContaining({ kind: "missing" }),
		);
	});

	it("coalesces concurrent reads for the same R2 key", async () => {
		vi.mocked(cache.getCache).mockReturnValue(null);
		vi.mocked(cache.getCachedObject).mockReturnValue(null);
		const content = Buffer.from("shared content");
		vi.mocked(r2ops.downloadFromR2).mockResolvedValue({
			content,
			contentType: undefined,
			size: content.length,
			etag: undefined,
		});

		const backend = new R2Backend();
		const [r1, r2] = await Promise.all([
			backend.readFile(`${REPO_PATH}/HEAD`),
			backend.readFile(`${REPO_PATH}/HEAD`),
		]);

		// Only one R2 call made for two concurrent reads
		expect(r2ops.downloadFromR2).toHaveBeenCalledTimes(1);
		expect(Buffer.compare(r1, r2)).toBe(0);
	});
});

describe("R2Backend.writeFile", () => {
	it("converts string data to buffer before uploading", async () => {
		vi.mocked(r2ops.uploadToR2).mockResolvedValue({
			key: "mock-key",
			bucketName: "mock-bucket",
		});

		const backend = new R2Backend();
		await backend.writeFile(`${REPO_PATH}/HEAD`, "ref: refs/heads/main");

		expect(r2ops.uploadToR2).toHaveBeenCalledWith(
			expect.any(String),
			expect.any(Buffer),
			expect.any(String),
		);
		const uploadedBuffer = vi.mocked(r2ops.uploadToR2).mock
			.calls[0][1] as Buffer;
		expect(uploadedBuffer.toString()).toBe("ref: refs/heads/main");
	});

	it("sets loose object hint to 'present' when writing a loose object", async () => {
		vi.mocked(r2ops.uploadToR2).mockResolvedValue({
			key: "mock-key",
			bucketName: "mock-bucket",
		});

		const backend = new R2Backend();
		await backend.writeFile(
			`${REPO_PATH}/objects/ab/cdef1234567890abcdef1234567890abcdef12`,
			Buffer.from([0x78]),
		);

		expect(cache.setCachedObject).toHaveBeenCalledWith(
			"loose-hint:alice/myrepo",
			expect.objectContaining({ kind: "present" }),
		);
	});
});

describe("prefetchAllPacks", () => {
	it("skips prefetch when pack file count exceeds the limit", async () => {
		const { prefetchAllPacks } = await import("../git-r2-backend");
		// Mock readdir to return >60 files (30 packs * 2 files each = 60 is the limit)
		const files = Array.from({ length: 62 }, (_, i) => ({
			key: `repos/alice/myrepo/git/objects/pack/pack-${i}.pack`,
			size: 100,
		}));
		vi.mocked(r2ops.listAllR2Files).mockResolvedValue(files);

		await prefetchAllPacks("alice", "myrepo");

		// readFile should not be called for individual pack files (early return)
		expect(r2ops.downloadFromR2).not.toHaveBeenCalled();
	});

	it("detects loose objects hint and prefetches pack files", async () => {
		const { prefetchAllPacks } = await import("../git-r2-backend");
		// readdir returns 2 pack files (1 pack pair)
		vi.mocked(r2ops.listAllR2Files).mockResolvedValue([
			{ key: "repos/alice/myrepo/git/objects/pack/pack-abc.pack", size: 1000 },
			{ key: "repos/alice/myrepo/git/objects/pack/pack-abc.idx", size: 500 },
		]);
		// listR2Files for detectLooseObjectsHint — returns 1 item that's NOT a loose object
		vi.mocked(r2ops.listR2Files).mockResolvedValue([
			{ key: "repos/alice/myrepo/git/objects/pack/pack-abc.pack" },
		]);
		// readFile for each pack file
		vi.mocked(r2ops.downloadFromR2).mockResolvedValue({
			content: Buffer.from("pack-data"),
			contentType: undefined,
			size: 9,
			etag: undefined,
		});

		await prefetchAllPacks("alice", "myrepo");

		// Loose hint should be set (no loose objects found)
		expect(cache.setCachedObject).toHaveBeenCalledWith(
			"loose-hint:alice/myrepo",
			expect.objectContaining({ kind: "none" }),
		);
		// Both pack files should have been downloaded
		expect(r2ops.downloadFromR2).toHaveBeenCalledTimes(2);
	});

	it("returns early if readdir fails (no pack directory)", async () => {
		const { prefetchAllPacks } = await import("../git-r2-backend");
		vi.mocked(r2ops.listAllR2Files).mockRejectedValue(new Error("not found"));

		await prefetchAllPacks("alice", "myrepo");

		// Should not throw — just returns silently
		expect(r2ops.downloadFromR2).not.toHaveBeenCalled();
	});
});
