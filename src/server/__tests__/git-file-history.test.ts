import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetCommitLog = vi.fn();
const mockGetRepoOptions = vi.fn();
const mockFindTreeEntry = vi.fn();
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
}));

vi.mock("../git-cache", () => ({
	getCachedObject: (...args: unknown[]) => mockGetCachedObject(...args),
	setCachedObject: (...args: unknown[]) => mockSetCachedObject(...args),
}));

vi.mock("../perf-log", () => ({
	perfNote: vi.fn(),
	perfStep: vi.fn((_label: string, fn: () => Promise<unknown>) => fn()),
}));

import { getFileHistory } from "../git-file-history";

function commit(
	oid: string,
	treeOid: string,
	parentOids: string[],
	overrides?: { message?: string },
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
				name: "Test",
				email: "test@test.com",
				timestamp: 1000,
				timezoneOffset: 0,
			},
		},
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockGetRepoOptions.mockResolvedValue({ fs: {}, gitdir: "/fake" });
	mockGetCachedObject.mockReturnValue(null);
});

const OWNER = "owner";
const REPO = "repo";
const BRANCH = "main";

describe("getFileHistory", () => {
	it("returns empty entries when commit log is empty", async () => {
		mockGetCommitLog.mockResolvedValue([]);

		const result = await getFileHistory(OWNER, REPO, BRANCH, "file.txt");
		expect(result).toEqual({ entries: [], truncated: false });
	});

	it("returns only the initial commit when file never changed after that", async () => {
		const commits = [
			commit("c3", "tree-c3", ["c2"]),
			commit("c2", "tree-c2", ["c1"]),
			commit("c1", "tree-c1", []),
		];
		mockGetCommitLog.mockResolvedValue(commits);
		// All commits have the same tree entry oid → file didn't change after initial commit
		mockFindTreeEntry.mockResolvedValue({
			path: "file.txt",
			oid: "same-oid",
			type: "blob",
			mode: "100644",
		});

		const result = await getFileHistory(OWNER, REPO, BRANCH, "file.txt");
		// The initial commit (c1, no parent) is always included since parentOid is null
		expect(result.entries).toHaveLength(1);
		expect(result.entries[0].sha).toBe("c1");
		expect(result.truncated).toBe(false);
	});

	it("finds commits that changed the file", async () => {
		const commits = [
			commit("c3", "tree-c3", ["c2"]),
			commit("c2", "tree-c2", ["c1"]),
			commit("c1", "tree-c1", []),
		];
		mockGetCommitLog.mockResolvedValue(commits);

		// c3: oid changed (new content), c2: same as c1 (no change), c1: first version
		mockFindTreeEntry
			.mockResolvedValueOnce({
				path: "file.txt",
				oid: "v3",
				type: "blob",
				mode: "100644",
			}) // c3 tree
			.mockResolvedValueOnce({
				path: "file.txt",
				oid: "v1",
				type: "blob",
				mode: "100644",
			}) // c2 tree (same as c1)
			.mockResolvedValueOnce({
				path: "file.txt",
				oid: "v1",
				type: "blob",
				mode: "100644",
			}) // c1 tree
			.mockResolvedValueOnce({
				path: "file.txt",
				oid: "v1",
				type: "blob",
				mode: "100644",
			}); // c1 parent (null parent → resolveOid(null))

		const result = await getFileHistory(OWNER, REPO, BRANCH, "file.txt");
		// c3 has oid v3, parent c2 has oid v1 → different → include
		// c2 has oid v1, parent c1 has oid v1 → same → skip
		// c1 has oid v1, no parent → include
		expect(result.entries).toHaveLength(2);
		expect(result.entries[0].sha).toBe("c3");
		expect(result.entries[1].sha).toBe("c1");
	});

	it("respects limit parameter", async () => {
		const commits = Array.from({ length: 10 }, (_, i) =>
			commit(`c${i}`, `tree-${i}`, i < 9 ? [`c${i + 1}`] : []),
		);
		mockGetCommitLog.mockResolvedValue(commits);
		// Every commit changes the file
		mockFindTreeEntry.mockImplementation(
			async (_repo: unknown, treeOid: string) => ({
				path: "file.txt",
				oid: `blob-${treeOid}`,
				type: "blob" as const,
				mode: "100644",
			}),
		);

		const result = await getFileHistory(OWNER, REPO, BRANCH, "file.txt", 2);
		expect(result.entries).toHaveLength(2);
		expect(result.truncated).toBe(true);
	});

	it("sets truncated when depth cap hit before parent found", async () => {
		// Two commits where c2's parent (c1) is not in the log (depth cap)
		const commits = [
			commit("c2", "tree-c2", ["c1"]),
			// c1 is missing from the log
		];
		mockGetCommitLog.mockResolvedValue(commits);
		mockFindTreeEntry.mockResolvedValue({
			path: "file.txt",
			oid: "v2",
			type: "blob",
			mode: "100644",
		});

		const result = await getFileHistory(OWNER, REPO, BRANCH, "file.txt");
		// c2 has parent c1 not in log → truncated, but c2 itself might still be included
		// depending on whether the parent check happens before or after inclusion
		expect(result.truncated).toBe(true);
	});

	it("caches result in object cache", async () => {
		const commits = [commit("c1", "tree-c1", [])];
		mockGetCommitLog.mockResolvedValue(commits);
		mockFindTreeEntry.mockResolvedValue({
			path: "file.txt",
			oid: "v1",
			type: "blob",
			mode: "100644",
		});

		await getFileHistory(OWNER, REPO, BRANCH, "file.txt");
		expect(mockSetCachedObject).toHaveBeenCalledWith(
			expect.stringContaining("result:file-history:"),
			expect.objectContaining({ entries: expect.any(Array) }),
		);
	});

	it("returns cached result when available", async () => {
		const cachedResult = {
			entries: [
				{
					sha: "cached",
					message: "cached",
					authorName: "T",
					authorEmail: "t@t.com",
					createdAt: "2024-01-01",
				},
			],
			truncated: false,
		};
		mockGetCachedObject.mockReturnValue(cachedResult);

		const result = await getFileHistory(OWNER, REPO, BRANCH, "file.txt");
		expect(result).toBe(cachedResult);
	});
});
