import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetCommitLog = vi.fn();
const mockGetRepoOptions = vi.fn();
const mockFindTreeEntry = vi.fn();
const mockListTreeEntries = vi.fn();
const mockGetCachedObject = vi.fn();
const mockSetCachedObject = vi.fn();

vi.mock("../git-history-ops", () => ({
	getCommitLog: (...args: unknown[]) => mockGetCommitLog(...args),
}));

vi.mock("../git-repo-storage", () => ({
	getRepoOptions: (...args: unknown[]) => mockGetRepoOptions(...args),
}));

vi.mock("../git-tree-ops", () => ({
	findTreeEntry: (...args: unknown[]) => mockFindTreeEntry(...args),
	listTreeEntries: (...args: unknown[]) => mockListTreeEntries(...args),
}));

vi.mock("../git-cache", () => ({
	getCachedObject: (...args: unknown[]) => mockGetCachedObject(...args),
	setCachedObject: (...args: unknown[]) => mockSetCachedObject(...args),
}));

vi.mock("../perf-log", () => ({
	perfNote: vi.fn(),
	perfStep: vi.fn((_label: string, fn: () => Promise<unknown>) => fn()),
}));

import { getLastCommitsForTree } from "../git-last-commit";

function commit(
	oid: string,
	treeOid: string,
	parentOids: string[],
	overrides?: { message?: string; author?: string; timestamp?: number },
): {
	oid: string;
	commit: {
		message: string;
		tree: string;
		parent: string[];
		author: {
			name: string;
			email: string;
			timestamp: number;
			timezoneOffset: number;
		};
	};
} {
	return {
		oid,
		commit: {
			message: overrides?.message ?? `commit ${oid}`,
			tree: treeOid,
			parent: parentOids,
			author: {
				name: overrides?.author ?? "Test Author",
				email: "test@example.com",
				timestamp: overrides?.timestamp ?? 1_700_000_000,
				timezoneOffset: 0,
			},
		},
	};
}

const REPO = { dir: "/repos/alice/myrepo/git", fs: {} };

beforeEach(() => {
	vi.clearAllMocks();
	mockGetRepoOptions.mockResolvedValue(REPO);
	mockGetCachedObject.mockReturnValue(null);
});

describe("getLastCommitsForTree", () => {
	it("returns empty object when commit log is empty", async () => {
		mockGetCommitLog.mockResolvedValue([]);

		const result = await getLastCommitsForTree("alice", "myrepo", "main", "");

		expect(result).toEqual({});
	});

	it("returns empty object when head directory does not exist", async () => {
		const commits = [commit("c1", "tree1", [])];
		mockGetCommitLog.mockResolvedValue(commits);
		mockFindTreeEntry.mockResolvedValue(null);

		const result = await getLastCommitsForTree(
			"alice",
			"myrepo",
			"main",
			"nonexistent",
		);

		expect(result).toEqual({});
	});

	it("returns cached result on cache hit, skipping history walk entirely", async () => {
		const commits = [commit("c1", "tree1", [])];
		mockGetCommitLog.mockResolvedValue(commits);
		const cached = {
			"src/": {
				sha: "cached1",
				message: "cached",
				authorName: "a",
				authorEmail: "e",
				createdAt: "",
			},
		};
		mockGetCachedObject.mockReturnValue(cached);

		const result = await getLastCommitsForTree("alice", "myrepo", "main", "");

		expect(result).toBe(cached);
		expect(mockFindTreeEntry).not.toHaveBeenCalled();
	});

	it("resolves last commit for each directory child (single-commit repo)", async () => {
		const commits = [commit("c1", "tree1", [])];
		mockGetCommitLog.mockResolvedValue(commits);
		mockGetCachedObject.mockReturnValue(null);

		// Head tree has a "src" directory
		mockFindTreeEntry.mockResolvedValue({
			type: "tree",
			oid: "dir_tree1",
			path: "src",
		});

		// dir_tree1 has two children
		mockListTreeEntries.mockResolvedValue([
			{ path: "src/a.ts", oid: "blob_a", type: "blob" },
			{ path: "src/b.ts", oid: "blob_b", type: "blob" },
		]);

		const result = await getLastCommitsForTree("alice", "myrepo", "main", "");

		expect(result["src/a.ts"]).toBeDefined();
		expect(result["src/a.ts"].sha).toBe("c1");
		expect(result["src/a.ts"].message).toBe("commit c1");
		expect(result["src/b.ts"]).toBeDefined();
		expect(result["src/b.ts"].sha).toBe("c1");
	});

	it("detects change only in the commit that differs from its parent", async () => {
		// Three-commit chain: c3 → c2 → c1. c2 changes b.ts from c1.
		const commits = [
			commit("c3", "tree3", ["c2"]),
			commit("c2", "tree2", ["c1"]),
			commit("c1", "tree1", []),
		];
		mockGetCommitLog.mockResolvedValue(commits);
		mockGetCachedObject.mockReturnValue(null);

		mockFindTreeEntry.mockImplementation(
			async (_repo: unknown, treeOid: string) => {
				const map: Record<string, string> = {
					tree3: "dir_tree3",
					tree2: "dir_tree2",
					tree1: "dir_tree1",
				};
				return map[treeOid]
					? { type: "tree", oid: map[treeOid], path: "" }
					: null;
			},
		);

		// dir_tree3 children (head)
		mockListTreeEntries.mockResolvedValueOnce([
			{ path: "src/a.ts", oid: "blob_a3", type: "blob" },
			{ path: "src/b.ts", oid: "blob_b3", type: "blob" },
		]);
		// dir_tree2 children (c2) — a.ts same as c3, b.ts same as c3
		mockListTreeEntries.mockResolvedValueOnce([
			{ path: "src/a.ts", oid: "blob_a3", type: "blob" },
			{ path: "src/b.ts", oid: "blob_b3", type: "blob" },
		]);
		// dir_tree1 children (c1) — a.ts same, b.ts different
		mockListTreeEntries.mockResolvedValueOnce([
			{ path: "src/a.ts", oid: "blob_a3", type: "blob" },
			{ path: "src/b.ts", oid: "blob_b1", type: "blob" },
		]);

		const result = await getLastCommitsForTree("alice", "myrepo", "main", "");

		// b.ts changed between c2 and c1 → attributed to c2
		expect(result["src/b.ts"]).toBeDefined();
		expect(result["src/b.ts"].sha).toBe("c2");
		// a.ts never changed across c3→c2→c1, but c1 (root, no parent) always
		// attributes all remaining entries because parentChildren is empty.
		expect(result["src/a.ts"]).toBeDefined();
		expect(result["src/a.ts"].sha).toBe("c1");
	});

	it("skips commits where dir tree oid matches parent (no change)", async () => {
		const commits = [
			commit("c3", "tree3", ["c2"]),
			commit("c2", "tree2", ["c1"]),
			commit("c1", "tree1", []),
		];
		mockGetCommitLog.mockResolvedValue(commits);
		mockGetCachedObject.mockReturnValue(null);

		// Head tree: "src" dir
		mockFindTreeEntry.mockResolvedValueOnce({
			type: "tree",
			oid: "dir_tree2",
			path: "src",
		});
		// c2 tree: same dir oid as head (no change from c3->c2)
		mockFindTreeEntry.mockResolvedValueOnce({
			type: "tree",
			oid: "dir_tree2",
			path: "src",
		});
		// c1 tree: different dir oid
		mockFindTreeEntry.mockResolvedValueOnce({
			type: "tree",
			oid: "dir_tree1",
			path: "src",
		});

		// Children for the distinct dir oids
		mockListTreeEntries.mockResolvedValueOnce([
			{ path: "src/a.ts", oid: "blob_a2", type: "blob" },
		]);
		mockListTreeEntries.mockResolvedValueOnce([
			{ path: "src/a.ts", oid: "blob_a1", type: "blob" },
		]);

		const result = await getLastCommitsForTree("alice", "myrepo", "main", "");

		// "src/a.ts" differs between dir_tree2 and dir_tree1, attributed to c2 (the commit
		// that actually changed it, since c3 didn't touch it).
		expect(result["src/a.ts"]).toBeDefined();
		expect(result["src/a.ts"].sha).toBe("c2");
	});

	it("returns empty object when treePath is a non-directory entry", async () => {
		const commits = [commit("c1", "tree1", [])];
		mockGetCommitLog.mockResolvedValue(commits);
		mockGetCachedObject.mockReturnValue(null);

		// findTreeEntry returns a blob, not a tree
		mockFindTreeEntry.mockResolvedValue({
			type: "blob",
			oid: "blob1",
			path: "README.md",
		});

		const result = await getLastCommitsForTree(
			"alice",
			"myrepo",
			"main",
			"README.md",
		);

		expect(result).toEqual({});
	});

	it("caches result after walk completes", async () => {
		const commits = [commit("c1", "tree1", [])];
		mockGetCommitLog.mockResolvedValue(commits);
		mockGetCachedObject.mockReturnValue(null);

		mockFindTreeEntry.mockResolvedValue({
			type: "tree",
			oid: "dir_tree1",
			path: "src",
		});
		mockListTreeEntries.mockResolvedValue([
			{ path: "src/a.ts", oid: "blob_a", type: "blob" },
		]);

		await getLastCommitsForTree("alice", "myrepo", "main", "");

		expect(mockSetCachedObject).toHaveBeenCalledWith(
			expect.stringContaining("result:last-commits:alice/myrepo/"),
			expect.any(Object),
		);
	});

	it("stops processing remaining entries once all are resolved in the sequential loop", async () => {
		const commits = [
			commit("c3", "tree3", ["c2"]),
			commit("c2", "tree2", ["c1"]),
			commit("c1", "tree1", []),
		];
		mockGetCommitLog.mockResolvedValue(commits);
		mockGetCachedObject.mockReturnValue(null);

		// Each commit has a different root tree → different dir OIDs
		mockFindTreeEntry.mockImplementation(
			async (_repo: unknown, treeOid: string) => {
				const map: Record<string, string> = {
					tree3: "dir_tree3",
					tree2: "dir_tree2",
					tree1: "dir_tree1",
				};
				return map[treeOid]
					? { type: "tree", oid: map[treeOid], path: "" }
					: null;
			},
		);

		// dir_tree3 children (head)
		mockListTreeEntries.mockResolvedValueOnce([
			{ path: "src/a.ts", oid: "blob_a3", type: "blob" },
		]);
		// dir_tree2 children (parent of c3)
		mockListTreeEntries.mockResolvedValueOnce([
			{ path: "src/a.ts", oid: "blob_a2", type: "blob" },
		]);
		// dir_tree1 children (parent of c2) — may not be needed if resolved early
		mockListTreeEntries.mockResolvedValue([]);

		const result = await getLastCommitsForTree("alice", "myrepo", "main", "");

		// src/a.ts changed between dir_tree3 and dir_tree2 → attributed to c3
		expect(result["src/a.ts"]).toBeDefined();
		expect(result["src/a.ts"].sha).toBe("c3");
		// Only 1 entry in remaining, so after c3 is resolved, remaining is empty
		// and the inner loop breaks. c2 and c1 are skipped in the sequential phase.
	});

	it("attributes change to the commit that introduced it (skips parentless first commit)", async () => {
		const commits = [commit("c2", "tree2", ["c1"]), commit("c1", "tree1", [])];
		mockGetCommitLog.mockResolvedValue(commits);
		mockGetCachedObject.mockReturnValue(null);

		// Mock findTreeEntry to return different dir OIDs per commit tree
		mockFindTreeEntry.mockImplementation(
			async (_repo: unknown, treeOid: string) => {
				const map: Record<string, string> = {
					tree2: "dir_tree2",
					tree1: "dir_tree1",
				};
				return map[treeOid]
					? { type: "tree", oid: map[treeOid], path: "" }
					: null;
			},
		);

		// dir_tree2 children (c2's root)
		mockListTreeEntries.mockResolvedValueOnce([
			{ path: "src/a.ts", oid: "blob_a2", type: "blob" },
		]);
		// dir_tree1 children (c1's root — the "parent" for c2, but c1 has no parent)
		mockListTreeEntries.mockResolvedValueOnce([
			{ path: "src/a.ts", oid: "blob_a1", type: "blob" },
		]);

		const result = await getLastCommitsForTree("alice", "myrepo", "main", "");

		expect(result["src/a.ts"]).toBeDefined();
		expect(result["src/a.ts"].sha).toBe("c2");
	});

	it("handles multiple directory children with different last commits", async () => {
		const commits = [
			commit("c3", "tree3", ["c2"]),
			commit("c2", "tree2", ["c1"]),
			commit("c1", "tree1", []),
		];
		mockGetCommitLog.mockResolvedValue(commits);
		mockGetCachedObject.mockReturnValue(null);

		// Mock findTreeEntry to return different dir OIDs per commit tree
		mockFindTreeEntry.mockImplementation(
			async (_repo: unknown, treeOid: string) => {
				const map: Record<string, string> = {
					tree3: "dir_tree3",
					tree2: "dir_tree2",
					tree1: "dir_tree1",
				};
				return map[treeOid]
					? { type: "tree", oid: map[treeOid], path: "" }
					: null;
			},
		);

		// Children at dir_tree3 (head)
		mockListTreeEntries.mockResolvedValueOnce([
			{ path: "src/a.ts", oid: "blob_a3", type: "blob" },
			{ path: "src/b.ts", oid: "blob_b3", type: "blob" },
		]);
		// Children at dir_tree2 (c2)
		mockListTreeEntries.mockResolvedValueOnce([
			{ path: "src/a.ts", oid: "blob_a2", type: "blob" },
			{ path: "src/b.ts", oid: "blob_b3", type: "blob" }, // same as c3
		]);
		// Children at dir_tree1 (c1)
		mockListTreeEntries.mockResolvedValueOnce([
			{ path: "src/a.ts", oid: "blob_a2", type: "blob" }, // same as c2
			{ path: "src/b.ts", oid: "blob_b1", type: "blob" }, // different from c2
		]);

		const result = await getLastCommitsForTree("alice", "myrepo", "main", "");

		expect(result["src/a.ts"].sha).toBe("c3");
		expect(result["src/b.ts"].sha).toBe("c2");
	});

	it("does not re-resolve children for the same tree oid (memoization)", async () => {
		const commits = [
			commit("c3", "tree3", ["c2"]),
			commit("c2", "tree2", ["c1"]),
			commit("c1", "tree1", []),
		];
		mockGetCommitLog.mockResolvedValue(commits);
		mockGetCachedObject.mockReturnValue(null);

		// All three commits map to the same dir OID via findTreeEntry
		mockFindTreeEntry.mockImplementation(
			async (_repo: unknown, _treeOid: string) => {
				return { type: "tree", oid: "same_dir_tree", path: "" };
			},
		);

		// listTreeEntries called once for the shared dir oid
		mockListTreeEntries.mockResolvedValue([
			{ path: "src/a.ts", oid: "blob_a", type: "blob" },
		]);

		const result = await getLastCommitsForTree("alice", "myrepo", "main", "");

		// listTreeEntries should only be called once for the shared dir oid
		expect(mockListTreeEntries).toHaveBeenCalledTimes(1);

		// c3 vs c2: same dirOid → skip. c2 vs c1: same dirOid → skip.
		// c1 (root, no parent): parentDirOid = null, which differs from "same_dir_tree"
		// → processes and attributes src/a.ts to c1
		expect(result["src/a.ts"]).toBeDefined();
		expect(result["src/a.ts"].sha).toBe("c1");
	});

	it("toLastCommitInfo formats timestamps as ISO strings", async () => {
		const timestamp = 1_700_000_000;
		const commits = [commit("c1", "tree1", [], { timestamp })];
		mockGetCommitLog.mockResolvedValue(commits);
		mockGetCachedObject.mockReturnValue(null);

		mockFindTreeEntry.mockResolvedValue({
			type: "tree",
			oid: "dir1",
			path: "src",
		});
		mockListTreeEntries.mockResolvedValue([
			{ path: "src/a.ts", oid: "blob_a", type: "blob" },
		]);

		const result = await getLastCommitsForTree("alice", "myrepo", "main", "");

		expect(result["src/a.ts"].createdAt).toBe(
			new Date(timestamp * 1000).toISOString(),
		);
	});

	it("returns empty when commits exist but treePath dir has no children", async () => {
		const commits = [commit("c1", "tree1", [])];
		mockGetCommitLog.mockResolvedValue(commits);
		mockGetCachedObject.mockReturnValue(null);

		mockFindTreeEntry.mockResolvedValue({
			type: "tree",
			oid: "empty_tree",
			path: "empty",
		});
		mockListTreeEntries.mockResolvedValue([]);

		const result = await getLastCommitsForTree(
			"alice",
			"myrepo",
			"main",
			"empty",
		);

		expect(result).toEqual({});
	});
});
