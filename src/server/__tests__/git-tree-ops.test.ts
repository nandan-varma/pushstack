import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReadTree = vi.hoisted(() => vi.fn());
const mockWriteTree = vi.hoisted(() => vi.fn());

vi.mock("isomorphic-git", () => ({
	default: {
		readTree: (...args: unknown[]) => mockReadTree(...args),
		writeTree: (...args: unknown[]) => mockWriteTree(...args),
	},
}));

import {
	deleteFromTree,
	findTreeEntry,
	listTreeEntries,
	upsertTree,
} from "../git-tree-ops";

const repo = { fs: {}, gitdir: "/fake" };

beforeEach(() => {
	vi.clearAllMocks();
});

// ── upsertTree ─────────────────────────────────────────────────────────────

describe("upsertTree", () => {
	it("creates entries in an empty tree", async () => {
		mockWriteTree.mockResolvedValue("new-tree-oid");

		const entries = new Map([["file.txt", "blob-oid-1"]]);
		const result = await upsertTree(repo, undefined, entries);

		expect(result).toBe("new-tree-oid");
		expect(mockWriteTree).toHaveBeenCalledWith({
			...repo,
			tree: expect.arrayContaining([
				expect.objectContaining({
					path: "file.txt",
					oid: "blob-oid-1",
					type: "blob",
				}),
			]),
		});
	});

	it("adds entries to an existing tree without removing existing entries", async () => {
		mockReadTree.mockResolvedValue({
			tree: [
				{ path: "existing.txt", oid: "old-oid", type: "blob", mode: "100644" },
			],
		});
		mockWriteTree.mockResolvedValue("updated-oid");

		const entries = new Map([["new.txt", "blob-oid-2"]]);
		await upsertTree(repo, "parent-tree-oid", entries);

		const writtenTree = mockWriteTree.mock.calls[0][0].tree;
		expect(writtenTree).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ path: "existing.txt", oid: "old-oid" }),
				expect.objectContaining({ path: "new.txt", oid: "blob-oid-2" }),
			]),
		);
	});

	it("creates nested directory structure from flat paths", async () => {
		// a/b/file.txt requires 3 writeTree calls: file level, b level, root level
		mockWriteTree
			.mockResolvedValueOnce("file-tree-oid")
			.mockResolvedValueOnce("b-tree-oid")
			.mockResolvedValueOnce("root-tree-oid");

		const entries = new Map([["a/b/file.txt", "blob-oid"]]);
		const result = await upsertTree(repo, undefined, entries);

		expect(result).toBe("root-tree-oid");
		expect(mockWriteTree).toHaveBeenCalledTimes(3);
	});

	it("handles mixed direct + nested entries", async () => {
		mockWriteTree
			.mockResolvedValueOnce("subdir-oid")
			.mockResolvedValueOnce("root-oid");

		const entries = new Map([
			["top.txt", "blob-1"],
			["sub/inner.txt", "blob-2"],
		]);
		const result = await upsertTree(repo, undefined, entries);

		expect(result).toBe("root-oid");
		const rootTree = mockWriteTree.mock.calls[1][0].tree;
		expect(rootTree).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ path: "top.txt", type: "blob" }),
				expect.objectContaining({ path: "sub", type: "tree" }),
			]),
		);
	});

	it("updates an existing entry's blob oid", async () => {
		mockReadTree.mockResolvedValue({
			tree: [
				{ path: "file.txt", oid: "old-oid", type: "blob", mode: "100644" },
			],
		});
		mockWriteTree.mockResolvedValue("new-oid");

		const entries = new Map([["file.txt", "new-blob-oid"]]);
		await upsertTree(repo, "parent-oid", entries);

		const writtenTree = mockWriteTree.mock.calls[0][0].tree;
		expect(writtenTree).toEqual([
			expect.objectContaining({ path: "file.txt", oid: "new-blob-oid" }),
		]);
	});
});

// ── deleteFromTree ──────────────────────────────────────────────────────────

describe("deleteFromTree", () => {
	it("removes a top-level file from a tree", async () => {
		mockReadTree.mockResolvedValue({
			tree: [
				{ path: "keep.txt", oid: "oid-1", type: "blob", mode: "100644" },
				{ path: "delete-me.txt", oid: "oid-2", type: "blob", mode: "100644" },
			],
		});
		mockWriteTree.mockResolvedValue("new-tree-oid");

		await deleteFromTree(repo, "root-oid", "delete-me.txt");

		const writtenTree = mockWriteTree.mock.calls[0][0].tree;
		expect(writtenTree).toEqual([
			expect.objectContaining({ path: "keep.txt" }),
		]);
	});

	it("removes a nested file and returns updated tree", async () => {
		mockReadTree
			.mockResolvedValueOnce({
				tree: [{ path: "dir", oid: "dir-oid", type: "tree", mode: "040000" }],
			})
			.mockResolvedValueOnce({
				tree: [
					{ path: "keep.md", oid: "oid-1", type: "blob", mode: "100644" },
					{ path: "remove.md", oid: "oid-2", type: "blob", mode: "100644" },
				],
			});
		mockWriteTree
			.mockResolvedValueOnce("dir-new-oid")
			.mockResolvedValueOnce("root-new-oid");

		await deleteFromTree(repo, "root-oid", "dir/remove.md");

		expect(mockWriteTree.mock.calls[0][0].tree).toEqual([
			expect.objectContaining({ path: "keep.md" }),
		]);
		expect(mockWriteTree.mock.calls[1][0].tree).toEqual([
			expect.objectContaining({ path: "dir", oid: "dir-new-oid" }),
		]);
	});
});

// ── findTreeEntry ───────────────────────────────────────────────────────────

describe("findTreeEntry", () => {
	it("returns root tree entry for empty path", async () => {
		const result = await findTreeEntry(repo, "root-oid", "");
		expect(result).toEqual({
			path: "",
			mode: "040000",
			type: "tree",
			oid: "root-oid",
		});
	});

	it("finds a top-level blob", async () => {
		mockReadTree.mockResolvedValue({
			tree: [
				{ path: "README.md", oid: "readme-oid", type: "blob", mode: "100644" },
			],
		});

		const result = await findTreeEntry(repo, "root-oid", "README.md");
		expect(result).toEqual({
			path: "README.md",
			mode: "100644",
			type: "blob",
			oid: "readme-oid",
		});
	});

	it("finds a nested blob", async () => {
		mockReadTree
			.mockResolvedValueOnce({
				tree: [{ path: "src", oid: "src-oid", type: "tree", mode: "040000" }],
			})
			.mockResolvedValueOnce({
				tree: [
					{ path: "index.js", oid: "index-oid", type: "blob", mode: "100644" },
				],
			});

		const result = await findTreeEntry(repo, "root-oid", "src/index.js");
		expect(result).toEqual({
			path: "src/index.js",
			mode: "100644",
			type: "blob",
			oid: "index-oid",
		});
	});

	it("returns null for non-existent path", async () => {
		mockReadTree.mockResolvedValue({
			tree: [{ path: "README.md", oid: "oid", type: "blob", mode: "100644" }],
		});

		const result = await findTreeEntry(repo, "root-oid", "nonexistent.txt");
		expect(result).toBeNull();
	});

	it("returns null when intermediate path is a blob not a tree", async () => {
		mockReadTree.mockResolvedValue({
			tree: [{ path: "file.txt", oid: "oid", type: "blob", mode: "100644" }],
		});

		const result = await findTreeEntry(repo, "root-oid", "file.txt/child");
		expect(result).toBeNull();
	});
});

// ── listTreeEntries ─────────────────────────────────────────────────────────

describe("listTreeEntries", () => {
	it("lists entries in root tree", async () => {
		mockReadTree.mockResolvedValue({
			tree: [
				{ path: "a.txt", oid: "oid-a", type: "blob", mode: "100644" },
				{ path: "b.txt", oid: "oid-b", type: "blob", mode: "100644" },
			],
		});

		const result = await listTreeEntries(repo, "root-oid");
		expect(result).toHaveLength(2);
		expect(result[0]).toEqual({
			path: "a.txt",
			mode: "100644",
			type: "blob",
			oid: "oid-a",
		});
	});

	it("lists entries with prefix", async () => {
		mockReadTree.mockResolvedValue({
			tree: [{ path: "file.txt", oid: "oid", type: "blob", mode: "100644" }],
		});

		const result = await listTreeEntries(repo, "tree-oid", "src");
		expect(result).toHaveLength(1);
		expect(result[0].path).toBe("src/file.txt");
	});
});
