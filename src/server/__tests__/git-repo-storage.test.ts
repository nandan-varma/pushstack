/**
 * Tests for git-repo-storage.ts — the write-path foundation.
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

// File-wide: a stale/never-released entry from one test (e.g. the
// deliberately-never-acquired lease in the "times out" test) must not leak
// into unrelated tests using the same "owner/repo" key and make them hang
// until the 60s lease TTL.
beforeEach(() => {
	lockStore.clear();
});

vi.mock("../git-manager-iso", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../git-manager-iso")>();
	return { ...actual, invalidateRepoGitCache: vi.fn() };
});

vi.mock("../git-cache", () => ({
	getCachedObject: vi.fn(),
	setCachedObject: vi.fn(),
	invalidateObjectCache: vi.fn(),
}));

const dbUpdateSet = vi.hoisted(() => vi.fn());

vi.mock("../../db", async () => {
	const { createFakeRepoLockDb } = await import("./helpers/fake-repo-lock-db");
	const db = createFakeRepoLockDb(lockStore);
	return {
		db: {
			...db,
			update: () => ({
				set: (values: Record<string, unknown>) => {
					// Lease renewals go to the fake lock table; everything else
					// (storage-size bookkeeping) is recorded for assertions.
					if (!("expiresAt" in values)) dbUpdateSet(values);
					return db.update().set(values);
				},
			}),
		},
	};
});

vi.mock("../perf-log", () => ({
	logError: vi.fn(),
	logWarn: vi.fn(),
	perfNote: vi.fn(),
	perfR2: vi.fn((_label: string, fn: () => Promise<unknown>) => fn()),
	perfStep: vi.fn((_label: string, fn: () => Promise<unknown>) => fn()),
	recordCacheHit: vi.fn(),
	recordCacheMiss: vi.fn(),
}));

import { resultKeyPrefixes } from "git-fs-s3/ops";
import { invalidateObjectCache } from "../git-cache";
import { listRepoStorage, putStorageObject } from "../git-fs";
import { invalidateRepoGitCache } from "../git-manager-iso";
import {
	afterRepositoryPush,
	deleteRepositoryStorage,
	renameRepositoryStorage,
	withRepositoryLock,
} from "../git-repo-storage";
import {
	getRepoGitStoragePrefix,
	getRepoGitStorageRoot,
} from "../git-storage-naming";

const mockInvalidateObjectCache = vi.mocked(invalidateObjectCache);
const mockInvalidateRepoGitCache = vi.mocked(invalidateRepoGitCache);

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
		const held = lockStore.get("o/long");
		expect(held).toBeDefined();

		// Well past the 60s lease: the heartbeat must have pushed expiry out.
		await vi.advanceTimersByTimeAsync(150_000);
		const row = lockStore.get("o/long");
		expect(row?.holder).toBe(held?.holder);
		expect(row?.expiresAt).toBeGreaterThan(Date.now());

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

		// The ops.* result-cache keys are namespaced `<kind>:${gitdir}:...` by
		// git-fs-s3/ops itself, not by this app — invalidation here must use
		// the exact same gitdir getRepoOptions/getBareRepoOptions resolve for
		// reads, or these calls silently clear nothing. Regression coverage
		// for a real bug: this used to invalidate hand-rolled
		// `result:tree:${owner}/${repo}/`-shaped prefixes that never matched
		// the library's actual key scheme.
		const prefixes = resultKeyPrefixes(getRepoGitStorageRoot("o", "r"));
		expect(prefixes.length).toBeGreaterThan(0);
		for (const prefix of prefixes) {
			expect(mockInvalidateObjectCache).toHaveBeenCalledWith(prefix);
		}
		expect(mockInvalidateRepoGitCache).toHaveBeenCalledWith("o", "r");
	});

	it("records the repo's stored size when given its owner", async () => {
		await seedRepo("sized", "r", ["HEAD", "objects/pack/a.pack"]);

		afterRepositoryPush("sized", "r", "owner-db-id");

		await vi.waitFor(() =>
			expect(dbUpdateSet).toHaveBeenCalledWith(
				expect.objectContaining({
					diskUsage: "HEAD".length + "objects/pack/a.pack".length,
					backupR2Key: "repos/sized/r",
				}),
			),
		);
	});

	it("skips storage accounting without an owner", () => {
		afterRepositoryPush("o", "r");
		expect(dbUpdateSet).not.toHaveBeenCalled();
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
