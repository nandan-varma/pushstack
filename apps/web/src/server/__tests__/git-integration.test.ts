import { beforeAll, describe, expect, it, vi } from "vitest";
import { MAX_INLINE_TEXT_BYTES } from "#/lib/file-view";

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));

import {
	analyzeMerge,
	getBranchDiff,
	getBranches,
	getCommit,
	getCommitDiff,
	getCommitHistory,
	getCommitLog,
	getFileContent,
	getFileHistory,
	getFileView,
	getTree,
} from "../git-read";
import { initBareRepo } from "../git-repo";
import {
	createBranch,
	createCommit,
	deleteBranch,
	deleteFile,
	mergeBranches,
	setDefaultBranch,
} from "../git-write";

const OWNER = "testowner";
const REPO = "testrepo";

const shas = {
	initial: "",
	second: "",
	featureCommit: "",
};

beforeAll(async () => {
	await initBareRepo(OWNER, REPO, "main");

	shas.initial = await createCommit(OWNER, REPO, {
		branch: "main",
		message: "Initial commit",
		files: [{ path: "README.md", content: "# Test Repo\n" }],
		author: { name: "Test User", email: "test@example.com" },
	});

	shas.second = await createCommit(OWNER, REPO, {
		branch: "main",
		message: "Add source file",
		files: [
			{ path: "README.md", content: "# Updated Repo\n\nSome content.\n" },
			{ path: "src/index.js", content: 'console.log("hello");\n' },
		],
		author: { name: "Test User", email: "test@example.com" },
	});

	await createBranch(OWNER, REPO, "feature-branch", "main");

	shas.featureCommit = await createCommit(OWNER, REPO, {
		branch: "feature-branch",
		message: "Add feature file",
		files: [{ path: "feature.txt", content: "feature content\n" }],
		author: { name: "Test User", email: "test@example.com" },
	});
}, 60_000);

describe("getBranches", () => {
	it("lists main and feature-branch", async () => {
		const branches = await getBranches(OWNER, REPO);
		const names = branches.map((b) => b.name);
		expect(names).toContain("main");
		expect(names).toContain("feature-branch");
	});

	it("marks main as default", async () => {
		const branches = await getBranches(OWNER, REPO);
		const main = branches.find((b) => b.name === "main");
		expect(main?.isDefault).toBe(true);
	});

	it("each branch has a valid commit SHA", async () => {
		const branches = await getBranches(OWNER, REPO);
		for (const b of branches) {
			expect(b.commit).toMatch(/^[0-9a-f]{40}$/);
		}
	});
});

describe("createBranch / deleteBranch", () => {
	it("creates a new branch", async () => {
		await createBranch(OWNER, REPO, "temp-branch", "main");
		const branches = await getBranches(OWNER, REPO);
		expect(branches.map((b) => b.name)).toContain("temp-branch");
	});

	it("deletes the branch", async () => {
		await deleteBranch(OWNER, REPO, "temp-branch");
		const branches = await getBranches(OWNER, REPO);
		expect(branches.map((b) => b.name)).not.toContain("temp-branch");
	});
});

describe("setDefaultBranch", () => {
	it("points HEAD at the branch, which listings then report as default", async () => {
		await setDefaultBranch(OWNER, REPO, "feature-branch");
		const branches = await getBranches(OWNER, REPO);
		expect(branches.find((b) => b.isDefault)?.name).toBe("feature-branch");
		await setDefaultBranch(OWNER, REPO, "main");
		const restored = await getBranches(OWNER, REPO);
		expect(restored.find((b) => b.isDefault)?.name).toBe("main");
	});

	it("rejects a branch that doesn't exist", async () => {
		await expect(setDefaultBranch(OWNER, REPO, "missing")).rejects.toThrow();
		const branches = await getBranches(OWNER, REPO);
		expect(branches.find((b) => b.isDefault)?.name).toBe("main");
	});
});

describe("getCommitLog", () => {
	it("returns commits newest-first", async () => {
		const log = await getCommitLog(OWNER, REPO, "main");
		expect(log.length).toBeGreaterThanOrEqual(2);
		expect(log[0].commit.message.trim()).toBe("Add source file");
		expect(log[1].commit.message.trim()).toBe("Initial commit");
	});

	it("respects depth limit", async () => {
		const log = await getCommitLog(OWNER, REPO, "main", 1);
		expect(log).toHaveLength(1);
	});

	it("each entry has oid, message, author", async () => {
		const [commit] = await getCommitLog(OWNER, REPO, "main", 1);
		expect(commit.oid).toMatch(/^[0-9a-f]{40}$/);
		expect(typeof commit.commit.message).toBe("string");
		expect(commit.commit.author.name).toBe("Test User");
		expect(commit.commit.author.email).toBe("test@example.com");
	});
});

describe("getCommit", () => {
	it("returns commit by SHA", async () => {
		const c = await getCommit(OWNER, REPO, shas.initial);
		expect(c.oid).toBe(shas.initial);
		expect(c.commit.message.trim()).toBe("Initial commit");
	});

	it("throws for an unknown SHA", async () => {
		await expect(getCommit(OWNER, REPO, "0".repeat(40))).rejects.toThrow();
	});
});

describe("getCommitHistory (pagination)", () => {
	it("skip=0 limit=1 returns newest commit", async () => {
		const history = await getCommitHistory(OWNER, REPO, "main", 1, 0);
		expect(history).toHaveLength(1);
		expect(history[0].commit.message.trim()).toBe("Add source file");
	});

	it("skip=1 limit=1 returns second commit", async () => {
		const history = await getCommitHistory(OWNER, REPO, "main", 1, 1);
		expect(history).toHaveLength(1);
		expect(history[0].commit.message.trim()).toBe("Initial commit");
	});

	it("skip past end returns empty array", async () => {
		const history = await getCommitHistory(OWNER, REPO, "main", 10, 999);
		expect(history).toHaveLength(0);
	});
});

describe("getFileHistory", () => {
	it("returns every commit that touched the file, newest first", async () => {
		const { entries } = await getFileHistory(OWNER, REPO, "main", "README.md");
		expect(entries.map((e) => e.sha)).toEqual([shas.second, shas.initial]);
	});

	it("only includes commits that changed this specific file", async () => {
		const { entries } = await getFileHistory(
			OWNER,
			REPO,
			"main",
			"src/index.js",
		);
		expect(entries.map((e) => e.sha)).toEqual([shas.second]);
	});

	it("resolves history scoped to a branch's own commits", async () => {
		const { entries } = await getFileHistory(
			OWNER,
			REPO,
			"feature-branch",
			"feature.txt",
		);
		expect(entries.map((e) => e.sha)).toEqual([shas.featureCommit]);
	});

	it("returns empty, non-truncated result for a file that never existed", async () => {
		const result = await getFileHistory(OWNER, REPO, "main", "nope.txt");
		expect(result).toEqual({ entries: [], truncated: false });
	});

	it("marks truncated when limit cuts off older matching commits", async () => {
		const result = await getFileHistory(OWNER, REPO, "main", "README.md", 1);
		expect(result.entries.map((e) => e.sha)).toEqual([shas.second]);
		expect(result.truncated).toBe(true);
	});

	it("escalates to full depth when a shallow (banner) walk finds nothing", async () => {
		// maxDepth=1 only fetches "second" — its parent ("initial") falls
		// outside the window, so a bare shallow walk can't confirm anything
		// and would otherwise report zero entries for a file that does have
		// history. The wrapper should retry at full depth and find it.
		const result = await getFileHistory(OWNER, REPO, "main", "README.md", 1, 1);
		expect(result.entries.map((e) => e.sha)).toEqual([shas.second]);
	});
});

describe("getTree (root)", () => {
	it("lists root entries on main", async () => {
		const entries = await getTree(OWNER, REPO, "main", "");
		const names = entries.map((e) => e.path);
		expect(names).toContain("README.md");
		expect(names).toContain("src");
	});

	it("marks files as blob and dirs as tree", async () => {
		const entries = await getTree(OWNER, REPO, "main", "");
		const readme = entries.find((e) => e.path === "README.md");
		const src = entries.find((e) => e.path === "src");
		expect(readme?.type).toBe("blob");
		expect(src?.type).toBe("tree");
	});
});

describe("getTree (subdirectory)", () => {
	it("lists contents of src/", async () => {
		const entries = await getTree(OWNER, REPO, "main", "src");
		expect(entries.map((e) => e.path)).toContain("src/index.js");
	});

	it("throws for non-existent path", async () => {
		await expect(getTree(OWNER, REPO, "main", "nonexistent")).rejects.toThrow(
			/does not exist/,
		);
	});
});

describe("getFileContent", () => {
	it("returns file buffer", async () => {
		const buf = await getFileContent(OWNER, REPO, "README.md", "main");
		expect(new TextDecoder().decode(buf)).toBe(
			"# Updated Repo\n\nSome content.\n",
		);
	});

	it("reads initial content from first commit SHA", async () => {
		const buf = await getFileContent(OWNER, REPO, "README.md", shas.initial);
		expect(new TextDecoder().decode(buf)).toBe("# Test Repo\n");
	});

	it("throws for a missing file", async () => {
		await expect(
			getFileContent(OWNER, REPO, "no-such-file.txt", "main"),
		).rejects.toThrow(/File not found/);
	});
});

describe("getFileView", () => {
	it("returns small text inline", async () => {
		const result = await getFileView(OWNER, REPO, "main", "README.md");
		expect(result.kind).toBe("text");
		if (result.kind !== "text") return;
		expect(result.content).toContain("Updated Repo");
		expect(result.size).toBeGreaterThan(0);
	});

	it("reports binary files by size only (a NUL byte means binary)", async () => {
		await createCommit(OWNER, REPO, {
			branch: "main",
			message: "Add binary file",
			files: [
				{
					path: "image.bin",
					content: new Uint8Array([0x89, 0x50, 0x00, 0x00]),
				},
			],
			author: { name: "Test User", email: "test@example.com" },
		});
		const result = await getFileView(OWNER, REPO, "main", "image.bin");
		expect(result).toEqual({ kind: "binary", size: 4 });
	});

	it("doesn't inline text over the display limit", async () => {
		await createCommit(OWNER, REPO, {
			branch: "main",
			message: "Add large file",
			files: [
				{ path: "big.txt", content: "x".repeat(MAX_INLINE_TEXT_BYTES + 1) },
			],
			author: { name: "Test User", email: "test@example.com" },
		});
		const result = await getFileView(OWNER, REPO, "main", "big.txt");
		expect(result).toEqual({
			kind: "too-large",
			size: MAX_INLINE_TEXT_BYTES + 1,
		});
	});
});

describe("createCommit", () => {
	it("rejects a commit to a branch that doesn't exist", async () => {
		await expect(
			createCommit(OWNER, REPO, {
				branch: "no-such-branch",
				message: "stray",
				files: [{ path: "stray.txt", content: "x" }],
				author: { name: "Test User", email: "test@example.com" },
			}),
		).rejects.toThrow("Branch no-such-branch does not exist");
		const branches = await getBranches(OWNER, REPO);
		expect(branches.map((b) => b.name)).not.toContain("no-such-branch");
	});

	it("makes the first commit of an empty repository", async () => {
		await initBareRepo(OWNER, "empty-repo", "main");
		await createCommit(OWNER, "empty-repo", {
			branch: "main",
			message: "first",
			files: [{ path: "a.txt", content: "a" }],
			author: { name: "Test User", email: "test@example.com" },
		});
		const [head] = await getCommitLog(OWNER, "empty-repo", "main", 5);
		expect(head?.commit.message.trim()).toBe("first");
		expect(head?.commit.parent).toEqual([]);
	});

	it("new file appears in tree", async () => {
		await createCommit(OWNER, REPO, {
			branch: "main",
			message: "Add new-file.txt",
			files: [{ path: "new-file.txt", content: "new content\n" }],
			author: { name: "Test User", email: "test@example.com" },
		});
		const entries = await getTree(OWNER, REPO, "main", "");
		expect(entries.map((e) => e.path)).toContain("new-file.txt");
	});

	it("updated file has new content", async () => {
		await createCommit(OWNER, REPO, {
			branch: "main",
			message: "Update new-file.txt",
			files: [{ path: "new-file.txt", content: "updated content\n" }],
			author: { name: "Test User", email: "test@example.com" },
		});
		const buf = await getFileContent(OWNER, REPO, "new-file.txt", "main");
		expect(new TextDecoder().decode(buf)).toBe("updated content\n");
	});

	it("commit appears at HEAD of log", async () => {
		const log = await getCommitLog(OWNER, REPO, "main", 1);
		expect(log[0].commit.message.trim()).toBe("Update new-file.txt");
	});
});

describe("deleteFile", () => {
	it("removes file from tree", async () => {
		await createCommit(OWNER, REPO, {
			branch: "main",
			message: "Pre-delete commit",
			files: [{ path: "to-delete.txt", content: "bye\n" }],
			author: { name: "Test User", email: "test@example.com" },
		});

		await deleteFile(OWNER, REPO, {
			branch: "main",
			filePath: "to-delete.txt",
			message: "Remove to-delete.txt",
			author: { name: "Test User", email: "test@example.com" },
		});

		const entries = await getTree(OWNER, REPO, "main", "");
		expect(entries.map((e) => e.path)).not.toContain("to-delete.txt");
	});

	it("delete creates a new commit", async () => {
		const [head] = await getCommitLog(OWNER, REPO, "main", 1);
		expect(head.commit.message.trim()).toBe("Remove to-delete.txt");
	});
});

describe("getCommitDiff", () => {
	it("initial commit has all files as 'added'", async () => {
		const diff = await getCommitDiff(OWNER, REPO, shas.initial);
		expect(diff.totalFiles).toBeGreaterThan(0);
		for (const f of diff.files) {
			expect(f.status).toBe("added");
			expect(f.deletions).toBe(0);
		}
	});

	it("second commit shows modified and added files", async () => {
		const diff = await getCommitDiff(OWNER, REPO, shas.second);
		const statuses = diff.files.map((f) => f.status);
		expect(statuses).toContain("modified");
		expect(statuses).toContain("added");
	});

	it("diff has correct totals", async () => {
		const diff = await getCommitDiff(OWNER, REPO, shas.second);
		expect(diff.totalFiles).toBe(diff.files.length);
		expect(diff.totalAdditions).toBe(
			diff.files.reduce((s, f) => s + f.additions, 0),
		);
		expect(diff.totalDeletions).toBe(
			diff.files.reduce((s, f) => s + f.deletions, 0),
		);
	});
});

describe("getBranchDiff", () => {
	it("main vs feature-branch shows feature.txt added", async () => {
		const diff = await getBranchDiff(OWNER, REPO, "main", "feature-branch");
		const paths = diff.files.map((f) => f.path);
		expect(paths).toContain("feature.txt");
		const featureFile = diff.files.find((f) => f.path === "feature.txt");
		expect(featureFile?.status).toBe("added");
	});

	it("same branch vs itself has no diff", async () => {
		const diff = await getBranchDiff(OWNER, REPO, "main", "main");
		expect(diff.files).toHaveLength(0);
		expect(diff.totalFiles).toBe(0);
	});
});

describe("analyzeMerge", () => {
	it("can merge feature-branch into main", async () => {
		const result = await analyzeMerge(OWNER, REPO, "feature-branch", "main");
		expect(result.canMerge).toBe(true);
		expect(result.hasConflicts).toBe(false);
	});

	it("detects fast-forward when source is ahead", async () => {
		const result = await analyzeMerge(OWNER, REPO, "feature-branch", "main");
		expect(typeof result.fastForward).toBe("boolean");
	});

	it("returns canMerge=false for non-existent branch", async () => {
		const result = await analyzeMerge(OWNER, REPO, "ghost-branch", "main");
		expect(result.canMerge).toBe(false);
	});
});

describe("mergeBranches", () => {
	it("merges feature-branch into a fresh target branch", async () => {
		await createBranch(OWNER, REPO, "merge-target", "main");

		const result = await mergeBranches(
			OWNER,
			REPO,
			"feature-branch",
			"merge-target",
			{ message: "Merge feature-branch into merge-target" },
		);

		expect(result.success).toBe(true);

		const entries = await getTree(OWNER, REPO, "merge-target", "");
		const names = entries.map((e) => e.path);
		expect(names).toContain("feature.txt");
	});
});

describe("submodule browsing", () => {
	it("reads gitlinks at a pinned revision, preserves them through web edits, and includes history", async () => {
		const git = (await import("isomorphic-git")).default;
		const { repoFor } = await import("../git-repo");
		const repo = repoFor(OWNER, "submodules");
		await initBareRepo(OWNER, "submodules", "main");
		const oid = "1".repeat(40);
		const blob = await git.writeBlob({
			...repo,
			blob: new TextEncoder().encode(
				'[submodule "lib"]\npath=lib\nurl=../library.git\n',
			),
		});
		const tree = await git.writeTree({
			...repo,
			tree: [
				{ path: ".gitmodules", type: "blob", mode: "100644", oid: blob },
				{ path: "lib", type: "commit", mode: "160000", oid },
			],
		});
		const author = { name: "T", email: "t@t", timestamp: 1, timezoneOffset: 0 };
		const first = await git.writeCommit({
			...repo,
			commit: {
				tree,
				parent: [],
				message: "Add submodule\n",
				author,
				committer: author,
			},
		});
		await git.writeRef({ ...repo, ref: "refs/heads/main", value: first });
		expect(await getFileView(OWNER, "submodules", "main", "lib")).toEqual({
			kind: "submodule",
			oid,
			url: "../library.git",
		});
		await expect(
			getFileContent(OWNER, "submodules", "lib", "main"),
		).rejects.toThrow();
		await createCommit(OWNER, "submodules", {
			branch: "main",
			message: "Unrelated web edit",
			files: [{ path: "README.md", content: "hello" }],
			author: { name: "T", email: "t@t" },
		});
		expect(await getTree(OWNER, "submodules", "main")).toContainEqual({
			path: "lib",
			type: "commit",
			mode: "160000",
			oid,
		});
		expect(
			(await getFileHistory(OWNER, "submodules", "main", "lib")).entries.map(
				(e) => e.sha,
			),
		).toEqual([first]);
		expect(await getFileView(OWNER, "submodules", first, "lib")).toEqual({
			kind: "submodule",
			oid,
			url: "../library.git",
		});
	});
});
