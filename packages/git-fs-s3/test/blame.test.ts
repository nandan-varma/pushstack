import git from "isomorphic-git";
import { describe, expect, it } from "vitest";
import { createGitFs, MemoryObjectStore } from "../src/index.js";
import {
	authorNow,
	BlameLimitError,
	commitFilesToBare,
	getBlame,
	type Repo,
	type ResultCache,
	resultKeyPrefixes,
} from "../src/ops/index.js";

const author = authorNow("Test", "test@example.com");

async function makeRepo(): Promise<Repo> {
	const repo: Repo = {
		fs: createGitFs(new MemoryObjectStore()),
		gitdir: "repos/alice/blog/git",
		cache: {},
	};
	await git.init({
		...repo,
		dir: repo.gitdir,
		bare: true,
		defaultBranch: "main",
	});
	return repo;
}

async function commit(repo: Repo, message: string, content: string) {
	return commitFilesToBare(repo, {
		branch: "main",
		message,
		author,
		files: [{ path: "src/a.txt", content }],
	});
}

function memoryCache(): ResultCache & { store: Map<string, unknown> } {
	const store = new Map<string, unknown>();
	return {
		store,
		get: <T>(key: string) => (store.get(key) as T) ?? null,
		set: (key, value) => {
			store.set(key, value);
		},
	};
}

describe("getBlame diff budgets", () => {
	it("marks lines boundary once the cumulative diff work is spent", async () => {
		const repo = await makeRepo();
		const c1 = await commit(repo, "one\n", "a\nb\nc\n");
		await commit(repo, "two\n", "a\nb\nc\nd\n");
		const c3 = await commit(repo, "three\n", "a\nb\nc\nd\ne\n");
		const blame = await getBlame(repo, {
			ref: "main",
			filePath: "src/a.txt",
			maxDiffWork: 1,
		});
		expect(blame.truncated).toBe(true);
		expect(blame.ranges).toEqual([
			{ startLine: 1, endLine: 5, sha: c3, boundary: true },
		]);
		const full = await getBlame(repo, { ref: "main", filePath: "src/a.txt" });
		expect(full.truncated).toBe(false);
		expect(full.ranges[0]?.sha).toBe(c1);
	});

	it("marks lines boundary when a revision pair exceeds the edit-script cap", async () => {
		const repo = await makeRepo();
		const lines = (prefix: string) =>
			Array.from({ length: 2500 }, (_, i) => `${prefix}${i}`).join("\n");
		await commit(repo, "old\n", `${lines("x")}\n`);
		const rewritten = await commit(repo, "rewrite\n", `${lines("y")}\n`);
		const blame = await getBlame(repo, { ref: "main", filePath: "src/a.txt" });
		expect(blame.truncated).toBe(true);
		expect(blame.ranges).toEqual([
			{ startLine: 1, endLine: 2500, sha: rewritten, boundary: true },
		]);
	});
});

describe("getBlame merges", () => {
	it("passes lines to the second parent instead of the merge", async () => {
		const repo = await makeRepo();
		const base = await commit(repo, "base\n", "a\nb\nc\n");
		await git.branch({ ...repo, dir: repo.gitdir, ref: "side", object: base });
		const c1 = await commit(repo, "main edit\n", "A\nb\nc\n");
		const c2 = await commitFilesToBare(repo, {
			branch: "side",
			message: "side edit\n",
			author,
			files: [{ path: "src/a.txt", content: "a\nb\nC\n" }],
		});
		const blob = await git.writeBlob({
			...repo,
			blob: new TextEncoder().encode("A\nb\nC\n"),
		});
		const src = await git.writeTree({
			...repo,
			tree: [{ path: "a.txt", mode: "100644", type: "blob", oid: blob }],
		});
		const root = await git.writeTree({
			...repo,
			tree: [{ path: "src", mode: "040000", type: "tree", oid: src }],
		});
		const identity = {
			name: "Test",
			email: "test@example.com",
			timestamp: 1,
			timezoneOffset: 0,
		};
		const merge = await git.writeCommit({
			...repo,
			commit: {
				message: "merge side\n",
				tree: root,
				parent: [c1, c2],
				author: identity,
				committer: identity,
			},
		});
		await git.writeRef({
			...repo,
			ref: "refs/heads/main",
			value: merge,
			force: true,
		});

		const blame = await getBlame(repo, { ref: "main", filePath: "src/a.txt" });
		expect(blame.ranges).toEqual([
			{ startLine: 1, endLine: 1, sha: c1 },
			{ startLine: 2, endLine: 2, sha: base },
			{ startLine: 3, endLine: 3, sha: c2 },
		]);
		expect(blame.commits[merge]).toBeUndefined();
	});
});

describe("getBlame", () => {
	it("attributes each line to the commit that introduced it", async () => {
		const repo = await makeRepo();
		const c1 = await commit(repo, "one\n", "a\nb\nc\n");
		const c2 = await commit(repo, "two\n", "a\nB\nc\nd\n");
		const c3 = await commit(repo, "three\n", "a\nB\nc\nd\ne\n");

		const blame = await getBlame(repo, { ref: "main", filePath: "src/a.txt" });
		expect(blame.lines).toEqual(["a", "B", "c", "d", "e"]);
		expect(blame.truncated).toBe(false);
		expect(blame.ranges).toEqual([
			{ startLine: 1, endLine: 1, sha: c1 },
			{ startLine: 2, endLine: 2, sha: c2 },
			{ startLine: 3, endLine: 3, sha: c1 },
			{ startLine: 4, endLine: 4, sha: c2 },
			{ startLine: 5, endLine: 5, sha: c3 },
		]);
		expect(blame.commits[c2]).toMatchObject({
			message: "two",
			authorName: "Test",
			parentSha: c1,
		});
		expect(blame.commits[c1]?.parentSha).toBeUndefined();
	});

	it("blames at an older ref and groups consecutive lines", async () => {
		const repo = await makeRepo();
		const c1 = await commit(repo, "one\n", "a\nb\n");
		await commit(repo, "two\n", "a\nb\nc\nd\n");
		const blame = await getBlame(repo, { ref: c1, filePath: "src/a.txt" });
		expect(blame.ranges).toEqual([{ startLine: 1, endLine: 2, sha: c1 }]);
	});

	it("attributes everything to the commit that created the file", async () => {
		const repo = await makeRepo();
		await commitFilesToBare(repo, {
			branch: "main",
			message: "root\n",
			author,
			files: [{ path: "other.txt", content: "x\n" }],
		});
		const created = await commit(repo, "add\n", "a\nb\n");
		await commit(repo, "edit\n", "a\nb\nc\n");
		const blame = await getBlame(repo, { ref: "main", filePath: "src/a.txt" });
		expect(blame.ranges[0]).toEqual({ startLine: 1, endLine: 2, sha: created });
	});

	it("reports a boundary when the depth budget ends the walk", async () => {
		const repo = await makeRepo();
		await commit(repo, "one\n", "a\nb\n");
		const c2 = await commit(repo, "two\n", "a\nb\nc\n");
		const c3 = await commit(repo, "three\n", "a\nb\nc\nd\n");
		const blame = await getBlame(repo, {
			ref: "main",
			filePath: "src/a.txt",
			maxDepth: 2,
		});
		expect(blame.truncated).toBe(true);
		expect(blame.ranges).toEqual([
			// The oldest visible commit gets every unresolved line, flagged.
			{ startLine: 1, endLine: 3, sha: c2, boundary: true },
			{ startLine: 4, endLine: 4, sha: c3 },
		]);
	});

	it("refuses files over the size, line and binary limits", async () => {
		const repo = await makeRepo();
		await commit(repo, "one\n", "a\nb\nc\n");
		await expect(
			getBlame(repo, { ref: "main", filePath: "src/a.txt", maxFileBytes: 2 }),
		).rejects.toMatchObject({ metric: "bytes", statusCode: 406 });
		await expect(
			getBlame(repo, { ref: "main", filePath: "src/a.txt", maxLines: 2 }),
		).rejects.toBeInstanceOf(BlameLimitError);
		await commit(repo, "bin\n", "a\u0000b");
		await expect(
			getBlame(repo, { ref: "main", filePath: "src/a.txt" }),
		).rejects.toMatchObject({ metric: "binary" });
	});

	it("throws not-found for a missing path or ref", async () => {
		const repo = await makeRepo();
		await commit(repo, "one\n", "a\n");
		await expect(
			getBlame(repo, { ref: "main", filePath: "nope.txt" }),
		).rejects.toMatchObject({ statusCode: 404 });
		await expect(
			getBlame(repo, { ref: "ghost", filePath: "src/a.txt" }),
		).rejects.toMatchObject({ statusCode: 404 });
	});

	it("memoizes per head and path under an evictable prefix", async () => {
		const repo = await makeRepo();
		await commit(repo, "one\n", "a\n");
		const resultCache = memoryCache();
		const first = await getBlame(
			repo,
			{ ref: "main", filePath: "src/a.txt" },
			{ resultCache },
		);
		const second = await getBlame(
			repo,
			{ ref: "main", filePath: "src/a.txt" },
			{ resultCache },
		);
		expect(second).toBe(first);
		const keys = [...resultCache.store.keys()].filter((key) =>
			key.startsWith("blame:"),
		);
		expect(keys).toHaveLength(1);
		expect(
			resultKeyPrefixes(repo.gitdir).some((p) => keys[0]?.startsWith(p)),
		).toBe(true);
	});
});
