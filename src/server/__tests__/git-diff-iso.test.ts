import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGit = vi.hoisted(() => ({
	default: {
		resolveRef: vi.fn(),
		readBlob: vi.fn(),
		readTree: vi.fn(),
		readCommit: vi.fn(),
		walk: vi.fn(),
		TREE: vi.fn(),
	},
}));

vi.mock("isomorphic-git", () => mockGit);

vi.mock("../git-manager-iso", () => ({
	getBareRepoOptions: vi.fn(() => ({
		fs: {},
		gitdir: "/tmp/gitdir",
	})),
}));

vi.mock("../git-repo-storage", () => ({
	ensureRepositoryHydrated: vi.fn(),
}));

vi.mock("#/lib/r2", () => ({ isR2Configured: vi.fn(() => true) }));

const mockGetCommit = vi.fn();
const mockGetFileContent = vi.fn();
vi.mock("../git-operations-iso", () => ({
	getCommit: (...args: unknown[]) => mockGetCommit(...args),
	getFileContent: (...args: unknown[]) => mockGetFileContent(...args),
}));

const g = mockGit.default;

const { getCommitDiff, getDiffBetweenBranches } = await import(
	"../git-diff-iso"
);

function makeOid(prefix: string): string {
	return prefix.padEnd(40, "0");
}

describe("getCommitDiff", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns all added files for initial commit (no parent)", async () => {
		const commitSha = makeOid("a");
		const treeSha = makeOid("b");

		mockGetCommit.mockResolvedValue({
			oid: commitSha,
			commit: { tree: treeSha, parent: [] },
		});

		g.readTree.mockResolvedValue({
			tree: [
				{ path: "README.md", type: "blob", oid: makeOid("c") },
				{ path: "src/index.js", type: "blob", oid: makeOid("d") },
			],
		});

		mockGetFileContent
			.mockResolvedValueOnce(Buffer.from("# Hello\n"))
			.mockResolvedValueOnce(Buffer.from('console.log("hi");\n'));

		const result = await getCommitDiff("owner", "repo", commitSha);

		expect(result.totalFiles).toBe(2);
		expect(result.totalAdditions).toBeGreaterThan(0);
		expect(result.files[0].status).toBe("added");
		expect(result.files[1].status).toBe("added");
	});

	it("returns diff between commit and its parent", async () => {
		const parentSha = makeOid("p");
		const commitSha = makeOid("a");
		const treeSha = makeOid("b");

		mockGetCommit.mockResolvedValue({
			oid: commitSha,
			commit: { tree: treeSha, parent: [parentSha] },
		});

		const treeEntry = (name: string, oid: string) => ({
			type: () => Promise.resolve("blob"),
			oid: () => Promise.resolve(oid),
		});

		g.walk.mockResolvedValue([
			{
				path: "file.txt",
				status: "modified",
				additions: 1,
				deletions: 1,
				patch: "diff --git a/file.txt b/file.txt",
			},
		]);

		const result = await getCommitDiff("owner", "repo", commitSha);

		expect(result.totalFiles).toBe(1);
		expect(result.files[0].status).toBe("modified");
		expect(result.files[0].path).toBe("file.txt");
	});
});

describe("getDiffBetweenBranches", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns diff between two branches", async () => {
		const baseSha = makeOid("b");
		const compareSha = makeOid("c");

		g.resolveRef
			.mockResolvedValueOnce(baseSha)
			.mockResolvedValueOnce(compareSha);

		g.walk.mockResolvedValue([
			{
				path: "file.txt",
				status: "modified",
				additions: 3,
				deletions: 1,
				patch: "diff --git a/file.txt b/file.txt",
			},
		]);

		const result = await getDiffBetweenBranches(
			"owner",
			"repo",
			"main",
			"feature",
		);

		expect(g.resolveRef).toHaveBeenCalledTimes(2);
		expect(result.totalFiles).toBe(1);
		expect(result.files[0].status).toBe("modified");
		expect(result.files[0].patch).toContain("diff --git");
	});

	it("returns empty diff for identical branches", async () => {
		const sha = makeOid("x");

		g.resolveRef.mockResolvedValue(sha);

		g.walk.mockResolvedValue([]);

		const result = await getDiffBetweenBranches(
			"owner",
			"repo",
			"main",
			"main",
		);

		expect(result.totalFiles).toBe(0);
	});

	it("handles deleted files in diff", async () => {
		const baseSha = makeOid("b");
		const compareSha = makeOid("c");

		g.resolveRef
			.mockResolvedValueOnce(baseSha)
			.mockResolvedValueOnce(compareSha);

		const deleteContent = Buffer.from("old content\n");
		g.readBlob.mockResolvedValue({ blob: deleteContent });

		const walkEntry = (name: string, type: string) => ({
			type: () => Promise.resolve(type),
			oid: () => Promise.resolve(makeOid("x")),
		});

		g.walk.mockImplementation(async ({ map }: { map: Function }) => {
			const result = await map("old.txt", [
				walkEntry("old.txt", "blob"),
				undefined,
			]);
			return [result];
		});

		const result = await getDiffBetweenBranches(
			"owner",
			"repo",
			"main",
			"feature",
		);

		expect(result.totalFiles).toBe(1);
		expect(result.files[0].status).toBe("deleted");
	});
});
