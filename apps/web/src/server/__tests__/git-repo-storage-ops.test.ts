import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("#/db", async () => ({
	db: await (await import("../../test/test-db")).createTestDb(),
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

import { invalidateRepoCache } from "git-edge";
import { resultKeyPrefixes } from "git-fs-s3/ops";
import { invalidateResultCache } from "../git-cache";
import { listRepoStorage, putStorageObject } from "../git-fs";
import {
	afterRepositoryPush,
	deleteRepositoryStorage,
	renameRepositoryStorage,
} from "../git-repo";
import {
	getRepoGitStoragePrefix,
	getRepoGitStorageRoot,
} from "../git-storage-naming";

const mockInvalidateObjectCache = vi.mocked(invalidateResultCache);
const mockInvalidateRepoGitCache = vi.mocked(invalidateRepoCache);

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
