/**
 * The write-path foundation: git-repo-lock.ts (lease lock) and git-repo.ts
 * (post-push bookkeeping, storage-level rename/delete).
 * Covers withRepositoryLock serialization (and its non-reentrancy
 * constraint), post-push bookkeeping, and the storage-level rename/delete —
 * the latter against git-fs.ts's real in-memory object store (R2 isn't
 * configured in tests), so they exercise the actual list/copy/delete calls.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let lockCalls = 0;
let maxLockConcurrency = 0;

function resetLockTracking() {
	lockCalls = 0;
	maxLockConcurrency = 0;
}

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));

vi.mock("git-edge", async (importOriginal) => {
	const actual = await importOriginal<typeof import("git-edge")>();
	return { ...actual, invalidateRepoCache: vi.fn() };
});

vi.mock("../git-cache", () => ({
	invalidateResultCache: vi.fn(),
	opsHooksFor: vi.fn(),
}));

vi.mock("../perf-log", () => ({
	logError: vi.fn(),
	logWarn: vi.fn(),
	perfNote: vi.fn(),
	perfR2: vi.fn((_label: string, fn: () => Promise<unknown>) => fn()),
	perfStep: vi.fn((_label: string, fn: () => Promise<unknown>) => fn()),
	recordCacheHit: vi.fn(),
	recordCacheMiss: vi.fn(),
}));

import { eq } from "drizzle-orm";
import { invalidateRepoCache } from "git-edge";
import { resultKeyPrefixes } from "git-fs-s3/ops";
import { db } from "#/db";
import { repoLocks } from "#/db/app-schema";
import { invalidateResultCache } from "../git-cache";
import { listRepoStorage, putStorageObject } from "../git-fs";
import {
	afterRepositoryPush,
	deleteRepositoryStorage,
	renameRepositoryStorage,
} from "../git-repo";
import { withRepositoryLock } from "../git-repo-lock";
import {
	getRepoGitStoragePrefix,
	getRepoGitStorageRoot,
} from "../git-storage-naming";

const mockInvalidateObjectCache = vi.mocked(invalidateResultCache);
const mockInvalidateRepoGitCache = vi.mocked(invalidateRepoCache);

const lease = (repoKey: string) =>
	db.query.repoLocks.findFirst({ where: eq(repoLocks.repoKey, repoKey) });
const plantLease = (repoKey: string, holder: string, expiresAt: number) =>
	db
		.insert(repoLocks)
		.values({ repoKey, holder, expiresAt: new Date(expiresAt) });

beforeEach(async () => {
	await db.delete(repoLocks);
});

const bytes = (text: string) => new TextEncoder().encode(text);

async function seedRepo(owner: string, repo: string, paths: string[]) {
	const prefix = getRepoGitStoragePrefix(owner, repo);
	for (const path of paths) {
		await putStorageObject(`${prefix}${path}`, bytes(path));
	}
}

async function storedPaths(owner: string, repo: string): Promise<string[]> {
	const prefix = getRepoGitStoragePrefix(owner, repo);
	return (await listRepoStorage(owner, repo))
		.map((object) => object.key.slice(prefix.length))
		.sort();
}

describe("withRepositoryLock", () => {
	beforeEach(() => {
		resetLockTracking();
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

	// Waiters poll with jitter, so their order isn't defined; only mutual
	// exclusion is.
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

		expect(await lease("owner/repo")).toBeUndefined();

		const result = await withRepositoryLock("owner", "repo", async () => "ok");
		expect(result).toBe("ok");
	});

	it("takes over a lease that already expired instead of waiting out the poll timeout", async () => {
		await plantLease("owner/repo", "stale-holder", Date.now() - 1000);

		const result = await withRepositoryLock("owner", "repo", async () => "ok");
		expect(result).toBe("ok");
	});

	it("times out waiting for a lease that never expires", async () => {
		vi.useFakeTimers();
		await plantLease("owner/repo", "other-holder", Date.now() + 10 * 60_000);

		const attempt = withRepositoryLock("owner", "repo", async () => "ok");
		const assertion = expect(attempt).rejects.toThrow(
			"Timed out waiting for repository lock",
		);
		await vi.advanceTimersByTimeAsync(70_000);
		await assertion;
	});
});

describe("withRepositoryLock — lease renewal", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("keeps renewing the lease, so a long critical section isn't taken over", async () => {
		vi.useFakeTimers();
		let release: () => void = () => {};
		const long = withRepositoryLock("o", "long", async () => {
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			return "done";
		});
		// Let the acquire land.
		await vi.advanceTimersByTimeAsync(0);
		const held = await lease("o/long");
		expect(held).toBeDefined();

		// Well past the 60s lease: the heartbeat must have pushed expiry out.
		await vi.advanceTimersByTimeAsync(150_000);
		const row = await lease("o/long");
		expect(row?.holder).toBe(held?.holder);
		expect(row?.expiresAt.getTime()).toBeGreaterThan(Date.now());

		// A competing writer still can't get in.
		let competitorEntered = false;
		const competitor = withRepositoryLock("o", "long", async () => {
			competitorEntered = true;
		});
		await vi.advanceTimersByTimeAsync(5_000);
		expect(competitorEntered).toBe(false);

		release();
		await vi.advanceTimersByTimeAsync(0);
		await expect(long).resolves.toBe("done");
		await vi.advanceTimersByTimeAsync(1_000);
		await competitor;
		expect(competitorEntered).toBe(true);
	});
});

describe("afterRepositoryPush", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("invalidates the ops result caches under the exact gitdir reads use", () => {
		afterRepositoryPush("o", "r");

		// git-fs-s3/ops keys results by gitdir; any other prefix clears nothing.
		const prefixes = resultKeyPrefixes(getRepoGitStorageRoot("o", "r"));
		expect(prefixes.length).toBeGreaterThan(0);
		for (const prefix of prefixes) {
			expect(mockInvalidateObjectCache).toHaveBeenCalledWith(prefix);
		}
		expect(mockInvalidateRepoGitCache).toHaveBeenCalledWith("o", "r");
	});
});

describe("deleteRepositoryStorage", () => {
	it("deletes every object under the repo's prefix, and nothing else", async () => {
		await seedRepo("del", "doomed", ["HEAD", "config", "objects/ab/cdef"]);
		await seedRepo("del", "doomed-sibling", ["HEAD"]);

		await deleteRepositoryStorage("del", "doomed");

		expect(await storedPaths("del", "doomed")).toEqual([]);
		expect(await storedPaths("del", "doomed-sibling")).toEqual(["HEAD"]);
		expect(mockInvalidateRepoGitCache).toHaveBeenCalledWith("del", "doomed");
	});

	it("no-ops on a repo with no storage", async () => {
		await expect(
			deleteRepositoryStorage("del", "never-existed"),
		).resolves.toBeUndefined();
	});
});

describe("renameRepositoryStorage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("moves every object to the new prefix and removes the old ones", async () => {
		await seedRepo("mv", "old-name", [
			"HEAD",
			"objects/ab/cdef",
			"refs/heads/main",
		]);

		await renameRepositoryStorage("mv", "old-name", "new-name");

		expect(await storedPaths("mv", "old-name")).toEqual([]);
		expect(await storedPaths("mv", "new-name")).toEqual([
			"HEAD",
			"objects/ab/cdef",
			"refs/heads/main",
		]);
		const prefix = getRepoGitStoragePrefix("mv", "new-name");
		const head = (await listRepoStorage("mv", "new-name")).find(
			(object) => object.key === `${prefix}HEAD`,
		);
		expect(head?.size).toBe("HEAD".length);
		expect(mockInvalidateRepoGitCache).toHaveBeenCalledWith("mv", "old-name");
		expect(mockInvalidateRepoGitCache).toHaveBeenCalledWith("mv", "new-name");
	});

	it("no-ops when the old prefix has no objects", async () => {
		await renameRepositoryStorage("mv", "empty", "still-empty");
		expect(await storedPaths("mv", "still-empty")).toEqual([]);
	});
});
