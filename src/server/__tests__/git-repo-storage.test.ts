/**
 * Tests for git-repo-storage.ts — the write-path foundation.
 * Covers withRepositoryLock serialization, getRepoOptions hydration skip,
 * qualifyBranchRef (already tested in qualify-branch-ref.test.ts, but
 * also exercises the non-reentrancy constraint of withRepositoryLock).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let lockCalls = 0;
let maxLockConcurrency = 0;

function resetLockTracking() {
	lockCalls = 0;
	maxLockConcurrency = 0;
}

vi.mock("#/lib/r2", () => ({
	isR2Configured: vi.fn(() => true),
}));

// See helpers/fake-repo-lock-db.ts for what this fake db/lockStore actually
// simulates and why `eq`/`and`/`lt` need mocking alongside it.
const lockStore = vi.hoisted(
	() => new Map<string, { holder: string; expiresAt: number }>(),
);

vi.mock("drizzle-orm", async (importOriginal) => {
	const { fakeRepoLockDrizzleOrmOverrides } = await import(
		"./helpers/fake-repo-lock-db"
	);
	const actual = await importOriginal<typeof import("drizzle-orm")>();
	return { ...actual, ...fakeRepoLockDrizzleOrmOverrides() };
});

// File-wide, not just inside the `withRepositoryLock` describe block:
// `lockStore` backs every call to withRepositoryLock, which
// getRepoOptions/ensureRepositoryHydrated/syncRepositoryToR2 (tested in
// their own describe blocks below) all go through internally. Without this,
// a stale/never-released entry from one test (e.g. the deliberately-never-
// acquired lease in the "times out" test) leaks into unrelated tests using
// the same "owner/repo" key and makes them hang until the 60s lease TTL.
beforeEach(() => {
	lockStore.clear();
});

vi.mock("../git-manager-iso", () => ({
	getBareRepoOptions: vi.fn(() => ({ fs: {}, gitdir: "/fake/gitdir" })),
	ensureGitBaseDir: vi.fn(() => Promise.resolve()),
	getRepoPath: vi.fn(
		(owner: string, repo: string) => `/tmp/pushstack-repos/${owner}/${repo}`,
	),
	initBareRepo: vi.fn(() => Promise.resolve("/tmp/repo")),
	invalidateRepoGitCache: vi.fn(),
	getRepoDiskUsage: vi.fn(() => Promise.resolve(1024)),
}));

vi.mock("#/lib/r2-operations", () => ({
	downloadFromR2: vi.fn(),
	uploadToR2: vi.fn(),
	deleteFromR2: vi.fn(),
	listR2Files: vi.fn(),
	listAllR2Files: vi.fn(() => Promise.resolve([])),
	bulkDeleteFromR2: vi.fn(),
	bulkUploadToR2: vi.fn(() => Promise.resolve([])),
	bulkCopyInR2: vi.fn(() => Promise.resolve([])),
}));

vi.mock("../git-cache", () => ({
	getCachedObject: vi.fn(),
	setCachedObject: vi.fn(),
	deleteCachedObject: vi.fn(),
	invalidateObjectCache: vi.fn(),
}));

vi.mock("../git-fs", () => ({
	invalidateRepoGitStorage: vi.fn(),
}));

vi.mock("../../db", async () => {
	const { createFakeRepoLockDb } = await import("./helpers/fake-repo-lock-db");
	return { db: createFakeRepoLockDb(lockStore) };
});

vi.mock("../perf-log", () => ({
	logError: vi.fn(),
	logWarn: vi.fn(),
	perfNote: vi.fn(),
	perfStep: vi.fn((_label: string, fn: () => Promise<unknown>) => fn()),
}));

import { promises as nodeFs } from "node:fs";
import { resultKeyPrefixes } from "git-fs-s3/ops";
import { isR2Configured } from "#/lib/r2";
import {
	bulkCopyInR2,
	bulkDeleteFromR2,
	bulkUploadToR2,
	downloadFromR2,
	listAllR2Files,
} from "#/lib/r2-operations";
import { invalidateObjectCache } from "../git-cache";
import { invalidateRepoGitStorage } from "../git-fs";
import {
	ensureGitBaseDir,
	getRepoPath,
	initBareRepo,
	invalidateRepoGitCache,
} from "../git-manager-iso";
import {
	deleteRepositoryFromR2,
	ensureRepositoryHydrated,
	getRepoOptions,
	renameRepositoryStorage,
	syncRepositoryToR2,
	withRepositoryLock,
} from "../git-repo-storage";
import { getRepoGitStorageRoot } from "../git-storage-naming";

const mockListAllR2Files = vi.mocked(listAllR2Files);
const mockBulkUploadToR2 = vi.mocked(bulkUploadToR2);
const mockBulkDeleteFromR2 = vi.mocked(bulkDeleteFromR2);
const mockBulkCopyInR2 = vi.mocked(bulkCopyInR2);
const mockDownloadFromR2 = vi.mocked(downloadFromR2);
const mockInvalidateStorage = vi.mocked(invalidateRepoGitStorage);
const mockInvalidateObjectCache = vi.mocked(invalidateObjectCache);
const mockInvalidateRepoGitCache = vi.mocked(invalidateRepoGitCache);
const mockInitBareRepo = vi.mocked(initBareRepo);
const mockGetRepoPath = vi.mocked(getRepoPath);

describe("withRepositoryLock", () => {
	beforeEach(() => {
		resetLockTracking();
		lockStore.clear();
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("executes the function and returns its result", async () => {
		const result = await withRepositoryLock("owner", "repo", async () => {
			return "result";
		});
		expect(result).toBe("result");
	});

	it("serializes concurrent calls for the same repo", async () => {
		const trackConcurrency = async (value: string): Promise<string> => {
			lockCalls++;
			maxLockConcurrency = Math.max(maxLockConcurrency, lockCalls);
			await new Promise((resolve) => setTimeout(resolve, 10));
			lockCalls--;
			return value;
		};

		await Promise.all([
			withRepositoryLock("owner", "repo", () => trackConcurrency("a")),
			withRepositoryLock("owner", "repo", () => trackConcurrency("b")),
		]);

		expect(maxLockConcurrency).toBe(1);
	});

	it("allows concurrent calls for different repos", async () => {
		let concurrent = 0;
		let maxConcurrent = 0;

		const trackConcurrency = async (value: string): Promise<string> => {
			concurrent++;
			maxConcurrent = Math.max(maxConcurrent, concurrent);
			await new Promise((resolve) => setTimeout(resolve, 10));
			concurrent--;
			return value;
		};

		await Promise.all([
			withRepositoryLock("owner", "repo-a", () => trackConcurrency("a")),
			withRepositoryLock("owner", "repo-b", () => trackConcurrency("b")),
		]);

		expect(maxConcurrent).toBe(2);
	});

	it("releases the lock even when the function throws", async () => {
		const error = new Error("test error");

		await expect(
			withRepositoryLock("owner", "repo", async () => {
				throw error;
			}),
		).rejects.toThrow("test error");

		const result = await withRepositoryLock("owner", "repo", async () => {
			return "ok";
		});
		expect(result).toBe("ok");
	});

	// The old in-process promise-chain mutex happened to serve queued waiters
	// in strict FIFO order — a side effect of its implementation, not a
	// documented guarantee. The DB-lease lock polls with jittered intervals
	// (see acquireRepoLock), so ordering among waiters is no longer
	// deterministic; what must still hold is mutual exclusion — no two
	// critical sections ever overlap.
	it("serializes 3 concurrent calls for the same repo with no overlap", async () => {
		let active = 0;
		let maxActive = 0;

		const run = async (delayMs: number, value: string): Promise<string> => {
			active++;
			maxActive = Math.max(maxActive, active);
			await new Promise((resolve) => setTimeout(resolve, delayMs));
			active--;
			return value;
		};

		const results = await Promise.all([
			withRepositoryLock("owner", "repo", () => run(30, "1")),
			withRepositoryLock("owner", "repo", () => run(10, "2")),
			withRepositoryLock("owner", "repo", () => run(10, "3")),
		]);

		expect(maxActive).toBe(1);
		expect(results.sort()).toEqual(["1", "2", "3"]);
	});

	it("cleans up the lock entry after the last call completes", async () => {
		await withRepositoryLock("owner", "repo", async () => "done");

		expect(lockStore.has("owner/repo")).toBe(false);

		const result = await withRepositoryLock("owner", "repo", async () => "ok");
		expect(result).toBe("ok");
	});

	it("takes over a lease that already expired instead of waiting out the poll timeout", async () => {
		lockStore.set("owner/repo", {
			holder: "stale-holder",
			expiresAt: Date.now() - 1000,
		});

		const result = await withRepositoryLock("owner", "repo", async () => "ok");
		expect(result).toBe("ok");
	});

	it("times out waiting for a lease that never expires", async () => {
		vi.useFakeTimers();
		lockStore.set("owner/repo", {
			holder: "other-holder",
			expiresAt: Date.now() + 10 * 60_000,
		});

		const attempt = withRepositoryLock("owner", "repo", async () => "ok");
		const assertion = expect(attempt).rejects.toThrow(
			"Timed out waiting for repository lock",
		);
		await vi.advanceTimersByTimeAsync(70_000);
		await assertion;
	});
});

describe("getRepoOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("skips hydration when R2 is configured", async () => {
		vi.mocked(isR2Configured).mockReturnValue(true);

		const result = await getRepoOptions("owner", "repo");

		expect(result).toEqual({ fs: {}, gitdir: "/fake/gitdir" });
	});

	it("triggers hydration when R2 is not configured", async () => {
		vi.mocked(isR2Configured).mockReturnValue(false);

		await getRepoOptions("owner", "repo");

		expect(ensureGitBaseDir).toHaveBeenCalled();
		expect(mockGetRepoPath).toHaveBeenCalledWith("owner", "repo");
	});
});

describe("ensureRepositoryHydrated", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("skips hydration when already hydrated and remote version is older", async () => {
		vi.mocked(isR2Configured).mockReturnValue(true);
		mockListAllR2Files.mockResolvedValue([]);

		await ensureRepositoryHydrated("owner", "repo");

		vi.clearAllMocks();

		const olderDate = new Date("2020-01-01");
		const result = await ensureRepositoryHydrated("owner", "repo", olderDate);

		expect(result).toBe("/tmp/pushstack-repos/owner/repo");
		expect(mockListAllR2Files).not.toHaveBeenCalled();
	});

	it("initializes a bare repo when R2 is not configured and no HEAD exists", async () => {
		vi.mocked(isR2Configured).mockReturnValue(false);
		const accessSpy = vi
			.spyOn(nodeFs, "access")
			.mockRejectedValue(new Error("ENOENT"));

		await ensureRepositoryHydrated("owner", "repo");

		expect(mockInitBareRepo).toHaveBeenCalledWith("owner", "repo", "main");
		accessSpy.mockRestore();
	});

	it("skips init when R2 is not configured and HEAD already exists", async () => {
		vi.mocked(isR2Configured).mockReturnValue(false);
		const accessSpy = vi.spyOn(nodeFs, "access").mockResolvedValue(undefined);

		await ensureRepositoryHydrated("owner", "repo");

		expect(mockInitBareRepo).not.toHaveBeenCalled();
		accessSpy.mockRestore();
	});

	it("downloads R2 files to disk when R2 is configured and files exist", async () => {
		vi.mocked(isR2Configured).mockReturnValue(true);
		mockListAllR2Files.mockResolvedValue([
			{
				key: "repos/o/r/git/HEAD",
				size: 10,
				lastModified: new Date(),
				etag: "a",
			},
			{
				key: "repos/o/r/git/config",
				size: 5,
				lastModified: new Date(),
				etag: "b",
			},
		]);
		mockDownloadFromR2.mockResolvedValue({
			content: Buffer.from("data"),
			contentType: undefined,
			size: 4,
			etag: undefined,
		});

		const mkdirSpy = vi.spyOn(nodeFs, "mkdir").mockResolvedValue(undefined);
		const rmSpy = vi.spyOn(nodeFs, "rm").mockResolvedValue(undefined);
		const writeFileSpy = vi
			.spyOn(nodeFs, "writeFile")
			.mockResolvedValue(undefined);

		const result = await ensureRepositoryHydrated("o", "r");

		expect(result).toBe("/tmp/pushstack-repos/o/r");
		expect(mockDownloadFromR2).toHaveBeenCalledTimes(2);

		mkdirSpy.mockRestore();
		rmSpy.mockRestore();
		writeFileSpy.mockRestore();
	});

	it("initializes a bare repo when R2 is configured but has no files", async () => {
		vi.mocked(isR2Configured).mockReturnValue(true);
		mockListAllR2Files.mockResolvedValue([]);
		const accessSpy = vi
			.spyOn(nodeFs, "access")
			.mockRejectedValue(new Error("ENOENT"));

		await ensureRepositoryHydrated("owner", "repo");

		expect(mockInitBareRepo).toHaveBeenCalled();
		accessSpy.mockRestore();
	});

	it("handles R2 404 mid-hydration gracefully (concurrent repack)", async () => {
		vi.mocked(isR2Configured).mockReturnValue(true);
		mockListAllR2Files.mockResolvedValue([
			{
				key: "repos/o/r/git/HEAD",
				size: 10,
				lastModified: new Date(),
				etag: "a",
			},
			{
				key: "repos/o/r/git/pack-abc.pack",
				size: 100,
				lastModified: new Date(),
				etag: "b",
			},
		]);

		const notFoundErr = new Error("not found");
		(notFoundErr as { code?: string }).code = "NotFound";

		mockDownloadFromR2.mockImplementation(async (key: string) => {
			if (key.includes("pack-abc")) throw notFoundErr;
			return {
				content: Buffer.from("data"),
				contentType: undefined,
				size: 4,
				etag: undefined,
			};
		});

		const mkdirSpy = vi.spyOn(nodeFs, "mkdir").mockResolvedValue(undefined);
		const rmSpy = vi.spyOn(nodeFs, "rm").mockResolvedValue(undefined);
		const writeFileSpy = vi
			.spyOn(nodeFs, "writeFile")
			.mockResolvedValue(undefined);

		const result = await ensureRepositoryHydrated("o", "r");

		expect(result).toBe("/tmp/pushstack-repos/o/r");
		expect(mockDownloadFromR2).toHaveBeenCalledTimes(2);

		mkdirSpy.mockRestore();
		rmSpy.mockRestore();
		writeFileSpy.mockRestore();
	});

	it("re-throws non-404 R2 download errors", async () => {
		vi.mocked(isR2Configured).mockReturnValue(true);
		mockListAllR2Files.mockResolvedValue([
			{
				key: "repos/o/r/git/HEAD",
				size: 10,
				lastModified: new Date(),
				etag: "a",
			},
		]);
		mockDownloadFromR2.mockRejectedValue(new Error("R2 timeout"));

		const mkdirSpy = vi.spyOn(nodeFs, "mkdir").mockResolvedValue(undefined);
		const rmSpy = vi.spyOn(nodeFs, "rm").mockResolvedValue(undefined);

		await expect(ensureRepositoryHydrated("o", "r")).rejects.toThrow(
			"R2 timeout",
		);

		mkdirSpy.mockRestore();
		rmSpy.mockRestore();
	});
});

describe("syncRepositoryToR2", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("no-ops when R2 is not configured (just updates syncedAt)", async () => {
		vi.mocked(isR2Configured).mockReturnValue(false);

		await syncRepositoryToR2("owner", "repo");

		expect(mockBulkUploadToR2).not.toHaveBeenCalled();
	});

	it("uploads new files and deletes stale refs when R2 is configured", async () => {
		vi.mocked(isR2Configured).mockReturnValue(true);
		mockListAllR2Files.mockResolvedValue([
			{
				key: "repos/o/r/git/HEAD",
				size: 10,
				lastModified: new Date(),
				etag: "a",
			},
			{
				key: "repos/o/r/git/refs/heads/old-branch",
				size: 5,
				lastModified: new Date(),
				etag: "b",
			},
		]);
		mockBulkUploadToR2.mockResolvedValue([{ success: true, key: "k" }]);

		const readFileSpy = vi
			.spyOn(nodeFs, "readFile")
			.mockResolvedValue(Buffer.from("content"));
		const readdirSpy = vi.spyOn(nodeFs, "readdir").mockResolvedValue([
			{ name: "HEAD", isDirectory: () => false, isFile: () => true },
			{ name: "config", isDirectory: () => false, isFile: () => true },
		] as never);

		await syncRepositoryToR2("o", "r");

		expect(mockBulkUploadToR2).toHaveBeenCalled();
		expect(mockInvalidateStorage).toHaveBeenCalled();
		expect(mockInvalidateObjectCache).toHaveBeenCalled();
		expect(mockInvalidateRepoGitCache).toHaveBeenCalled();

		// The ops.* result-cache keys are namespaced `<kind>:${gitdir}:...` by
		// git-fs-s3/ops itself, not by this app — invalidation here
		// must use the exact same gitdir getRepoOptions/getBareRepoOptions
		// resolve for reads, or these calls silently clear nothing. Regression
		// coverage for a real bug: this used to invalidate hand-rolled
		// `result:tree:${owner}/${repo}/`-shaped prefixes that never matched
		// the library's actual key scheme.
		for (const prefix of resultKeyPrefixes(getRepoGitStorageRoot("o", "r"))) {
			expect(mockInvalidateObjectCache).toHaveBeenCalledWith(prefix);
		}

		readFileSpy.mockRestore();
		readdirSpy.mockRestore();
	});

	it("throws when bulk upload fails", async () => {
		vi.mocked(isR2Configured).mockReturnValue(true);
		mockListAllR2Files.mockResolvedValue([]);
		mockBulkUploadToR2.mockResolvedValue([
			{ success: false, key: "failed-key", error: "upload fail" },
		]);

		const readFileSpy = vi
			.spyOn(nodeFs, "readFile")
			.mockResolvedValue(Buffer.from("content"));
		const readdirSpy = vi
			.spyOn(nodeFs, "readdir")
			.mockResolvedValue([
				{ name: "HEAD", isDirectory: () => false, isFile: () => true },
			] as never);

		await expect(syncRepositoryToR2("o", "r")).rejects.toThrow(
			"Failed to upload",
		);

		readFileSpy.mockRestore();
		readdirSpy.mockRestore();
	});
});

describe("deleteRepositoryFromR2", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("no-ops when R2 is not configured", async () => {
		vi.mocked(isR2Configured).mockReturnValue(false);

		await deleteRepositoryFromR2("owner", "repo");

		expect(mockListAllR2Files).not.toHaveBeenCalled();
		expect(mockBulkDeleteFromR2).not.toHaveBeenCalled();
	});

	it("deletes all R2 files when files exist", async () => {
		vi.mocked(isR2Configured).mockReturnValue(true);
		mockListAllR2Files.mockResolvedValue([
			{
				key: "repos/o/r/git/HEAD",
				size: 10,
				lastModified: new Date(),
				etag: "a",
			},
			{
				key: "repos/o/r/git/config",
				size: 5,
				lastModified: new Date(),
				etag: "b",
			},
		]);

		await deleteRepositoryFromR2("o", "r");

		expect(mockBulkDeleteFromR2).toHaveBeenCalledWith([
			"repos/o/r/git/HEAD",
			"repos/o/r/git/config",
		]);
	});

	it("skips bulk delete when no files exist", async () => {
		vi.mocked(isR2Configured).mockReturnValue(true);
		mockListAllR2Files.mockResolvedValue([]);

		await deleteRepositoryFromR2("o", "r");

		expect(mockBulkDeleteFromR2).not.toHaveBeenCalled();
	});
});

describe("renameRepositoryStorage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("copies every object to the new prefix and deletes the old ones (R2)", async () => {
		vi.mocked(isR2Configured).mockReturnValue(true);
		mockListAllR2Files.mockResolvedValue([
			{
				key: "repos/o/old-name/git/HEAD",
				size: 10,
				lastModified: new Date(),
				etag: "a",
			},
			{
				key: "repos/o/old-name/git/objects/ab/cdef",
				size: 5,
				lastModified: new Date(),
				etag: "b",
			},
		]);
		mockBulkCopyInR2.mockResolvedValue([
			{ key: "repos/o/new-name/git/HEAD", success: true },
			{ key: "repos/o/new-name/git/objects/ab/cdef", success: true },
		]);

		await renameRepositoryStorage("o", "old-name", "new-name");

		expect(mockBulkCopyInR2).toHaveBeenCalledWith([
			{
				from: "repos/o/old-name/git/HEAD",
				to: "repos/o/new-name/git/HEAD",
			},
			{
				from: "repos/o/old-name/git/objects/ab/cdef",
				to: "repos/o/new-name/git/objects/ab/cdef",
			},
		]);
		expect(mockBulkDeleteFromR2).toHaveBeenCalledWith([
			"repos/o/old-name/git/HEAD",
			"repos/o/old-name/git/objects/ab/cdef",
		]);
		expect(mockInvalidateRepoGitCache).toHaveBeenCalledWith("o", "old-name");
		expect(mockInvalidateRepoGitCache).toHaveBeenCalledWith("o", "new-name");
	});

	it("aborts without deleting old objects when a copy fails (R2)", async () => {
		vi.mocked(isR2Configured).mockReturnValue(true);
		mockListAllR2Files.mockResolvedValue([
			{
				key: "repos/o/old-name/git/HEAD",
				size: 10,
				lastModified: new Date(),
				etag: "a",
			},
		]);
		mockBulkCopyInR2.mockResolvedValue([
			{ key: "repos/o/new-name/git/HEAD", success: false, error: "boom" },
		]);

		await expect(
			renameRepositoryStorage("o", "old-name", "new-name"),
		).rejects.toThrow("Failed to copy");

		expect(mockBulkDeleteFromR2).not.toHaveBeenCalled();
	});

	it("no-ops storage copy when the old prefix has no objects (R2)", async () => {
		vi.mocked(isR2Configured).mockReturnValue(true);
		mockListAllR2Files.mockResolvedValue([]);

		await renameRepositoryStorage("o", "old-name", "new-name");

		expect(mockBulkCopyInR2).not.toHaveBeenCalled();
		expect(mockBulkDeleteFromR2).not.toHaveBeenCalled();
	});

	it("renames the local hydration directory when R2 is not configured", async () => {
		vi.mocked(isR2Configured).mockReturnValue(false);
		const mkdirSpy = vi
			.spyOn(nodeFs, "mkdir")
			.mockResolvedValue(undefined as never);
		const renameSpy = vi.spyOn(nodeFs, "rename").mockResolvedValue(undefined);

		await renameRepositoryStorage("o", "old-name", "new-name");

		expect(renameSpy).toHaveBeenCalledWith(
			"/tmp/pushstack-repos/o/old-name",
			"/tmp/pushstack-repos/o/new-name",
		);

		mkdirSpy.mockRestore();
		renameSpy.mockRestore();
	});

	it("tolerates a missing local directory (nothing hydrated yet under the old name)", async () => {
		vi.mocked(isR2Configured).mockReturnValue(false);
		const mkdirSpy = vi
			.spyOn(nodeFs, "mkdir")
			.mockResolvedValue(undefined as never);
		const enoent = Object.assign(new Error("no such file"), {
			code: "ENOENT",
		});
		const renameSpy = vi.spyOn(nodeFs, "rename").mockRejectedValue(enoent);

		await expect(
			renameRepositoryStorage("o", "old-name", "new-name"),
		).resolves.toBeUndefined();

		mkdirSpy.mockRestore();
		renameSpy.mockRestore();
	});

	it("propagates a non-ENOENT local rename failure", async () => {
		vi.mocked(isR2Configured).mockReturnValue(false);
		const mkdirSpy = vi
			.spyOn(nodeFs, "mkdir")
			.mockResolvedValue(undefined as never);
		const renameSpy = vi
			.spyOn(nodeFs, "rename")
			.mockRejectedValue(new Error("disk full"));

		await expect(
			renameRepositoryStorage("o", "old-name", "new-name"),
		).rejects.toThrow("disk full");

		mkdirSpy.mockRestore();
		renameSpy.mockRestore();
	});
});

describe("qualifyBranchRef", () => {
	it("passes through refs/ prefix", async () => {
		const { qualifyBranchRef } = await import("../git-repo-storage");
		expect(qualifyBranchRef("refs/heads/main")).toBe("refs/heads/main");
	});

	it("passes through HEAD", async () => {
		const { qualifyBranchRef } = await import("../git-repo-storage");
		expect(qualifyBranchRef("HEAD")).toBe("HEAD");
	});

	it("passes through 40-char hex oids", async () => {
		const { qualifyBranchRef } = await import("../git-repo-storage");
		const oid = "a".repeat(40);
		expect(qualifyBranchRef(oid)).toBe(oid);
	});

	it("qualifies bare branch names to refs/heads/", async () => {
		const { qualifyBranchRef } = await import("../git-repo-storage");
		expect(qualifyBranchRef("feature")).toBe("refs/heads/feature");
	});
});
