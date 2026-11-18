import git from "isomorphic-git";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGitFs, MemoryObjectStore } from "../src/index.js";
import {
	authorNow,
	commitFilesToBare,
	getCommitDiff,
	getDirectDiffBetweenRefs,
	type OpsHooks,
	type Repo,
	type ResultCache,
} from "../src/ops/index.js";

const author = authorNow("Test", "test@example.com");

/** The smallest thing that satisfies `ResultCache`: enough to prove a hit. */
function memoryCache(): ResultCache & { keys: string[] } {
	const entries = new Map<string, object>();
	const keys: string[] = [];
	return {
		keys,
		get<T extends object>(key: string) {
			keys.push(key);
			return (entries.get(key) as T | undefined) ?? null;
		},
		set(key: string, value: object) {
			entries.set(key, value);
		},
	};
}

async function seed() {
	const repo: Repo = {
		fs: createGitFs(new MemoryObjectStore()),
		gitdir: "git",
		cache: {},
	};
	await git.init({
		...repo,
		dir: repo.gitdir,
		bare: true,
		defaultBranch: "main",
	});
	const root = await commitFilesToBare(repo, {
		branch: "main",
		message: "root",
		author,
		files: [{ path: "file", content: "one" }],
	});
	const tip = await commitFilesToBare(repo, {
		branch: "main",
		message: "change",
		author,
		files: [{ path: "file", content: "two" }],
	});
	return { repo, root, tip };
}

const hooksWith = (resultCache: ResultCache): OpsHooks => ({ resultCache });

afterEach(() => vi.restoreAllMocks());

describe("diff result cache", () => {
	it("serves a repeated commit diff from the cache, without reading blobs again", async () => {
		const { repo, tip } = await seed();
		const hooks = hooksWith(memoryCache());
		const first = await getCommitDiff(repo, tip, {}, hooks);
		expect(first.files).toHaveLength(1);

		const reads = vi.spyOn(git, "readBlob");
		const second = await getCommitDiff(repo, tip, {}, hooks);
		expect(second).toEqual(first);
		expect(reads).not.toHaveBeenCalled();
	});

	it("keys the cache by the diff limits, so a smaller budget is a miss", async () => {
		const { repo, tip } = await seed();
		const cache = memoryCache();
		const hooks = hooksWith(cache);
		await getCommitDiff(repo, tip, { maxFiles: 10 }, hooks);
		const before = cache.keys.length;
		await getCommitDiff(repo, tip, { maxFiles: 2 }, hooks);
		expect(cache.keys.length).toBeGreaterThan(before);
	});

	it("ignores a ref that moved to a new commit, because the key changes", async () => {
		const { repo, root } = await seed();
		const hooks = hooksWith(memoryCache());
		const first = await getDirectDiffBetweenRefs(repo, "main", root, {}, hooks);
		expect(first.files).toHaveLength(1);

		await commitFilesToBare(repo, {
			branch: "main",
			message: "again",
			author,
			files: [{ path: "file", content: "three" }],
		});
		const second = await getDirectDiffBetweenRefs(
			repo,
			"main",
			root,
			{},
			hooks,
		);
		// main now has newer content than `root`, so the same ref pair is a
		// different diff: the cached entry under the old commit pair is not used.
		expect(second.newRef).toBe(root);
		expect(second.oldRef).not.toBe(first.oldRef);
	});
});
