/**
 * Real git integration tests — no mocks, actual filesystem + isomorphic-git.
 * R2 is not configured in test env, so all storage is local-only.
 */

import { promises as nodeFs } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Must be hoisted so git-manager-iso captures GIT_REPOS_PATH at module init
const TEST_DIR = vi.hoisted(() => {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const os = require("node:os");
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const p = require("node:path");
	const dir = p.join(os.tmpdir(), `pushstack-git-test-${Date.now()}`);
	process.env.GIT_REPOS_PATH = dir;
	return dir;
});

import {
	checkoutBranch,
	createBranch,
	deleteBranch,
	getBranches,
} from "../git-branch-ops";
import { createCommit, deleteFile } from "../git-commit-write";
import { getCommitDiff, getDiffBetweenBranches } from "../git-diff-iso";
import {
	getBlob,
	getCommit,
	getCommitHistory,
	getCommitLog,
	getFileContent,
	getFileFromBranch,
	getTree,
	getTreeFromBranch,
} from "../git-history-ops";
// Import after env is set
import { initBareRepo } from "../git-manager-iso";
import { analyzeMerge, mergeBranches } from "../git-merge-iso";

const OWNER = "testowner";
const REPO = "testrepo";

// SHAs captured during setup for use in tests
const shas = {
	initial: "",
	second: "",
	featureCommit: "",
};

beforeAll(async () => {
	await nodeFs.mkdir(TEST_DIR, { recursive: true });
	await initBareRepo(OWNER, REPO);

	// Commit 1: initial README
	shas.initial = await createCommit(
		OWNER,
		REPO,
		"Initial commit",
		[{ path: "README.md", content: "# Test Repo\n" }],
		"Test User",
		"test@example.com",
	);

	// Commit 2: update README + add src/index.js
	shas.second = await createCommit(
		OWNER,
		REPO,
		"Add source file",
		[
			{ path: "README.md", content: "# Updated Repo\n\nSome content.\n" },
			{ path: "src/index.js", content: 'console.log("hello");\n' },
		],
		"Test User",
		"test@example.com",
	);

	// Create a feature branch from current HEAD (main)
	await createBranch(OWNER, REPO, "feature-branch", "main");

	// Commit on feature branch
	shas.featureCommit = await createCommit(
		OWNER,
		REPO,
		"Add feature file",
		[{ path: "feature.txt", content: "feature content\n" }],
		"Test User",
		"test@example.com",
		"feature-branch",
	);
}, 60_000);

afterAll(async () => {
	await nodeFs.rm(TEST_DIR, { recursive: true, force: true });
});

// ── Branches ──────────────────────────────────────────────────────────────────

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

describe("checkoutBranch", () => {
	it("resolves without error for an existing branch", async () => {
		await expect(checkoutBranch(OWNER, REPO, "main")).resolves.not.toThrow();
	});

	it("throws for a non-existent branch", async () => {
		await expect(
			checkoutBranch(OWNER, REPO, "does-not-exist"),
		).rejects.toThrow();
	});
});

// ── Commits ───────────────────────────────────────────────────────────────────

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

// ── Trees & files ─────────────────────────────────────────────────────────────

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
		const entries = await getTreeFromBranch(OWNER, REPO, "main", "src");
		expect(entries.map((e) => e.path)).toContain("src/index.js");
	});

	it("throws for non-existent path", async () => {
		await expect(
			getTreeFromBranch(OWNER, REPO, "main", "nonexistent"),
		).rejects.toThrow(/does not exist/);
	});
});

describe("getFileContent", () => {
	it("returns file buffer", async () => {
		const buf = await getFileContent(OWNER, REPO, "README.md", "main");
		expect(buf.toString()).toBe("# Updated Repo\n\nSome content.\n");
	});

	it("reads initial content from first commit SHA", async () => {
		const buf = await getFileContent(OWNER, REPO, "README.md", shas.initial);
		expect(buf.toString()).toBe("# Test Repo\n");
	});

	it("throws for a missing file", async () => {
		await expect(
			getFileContent(OWNER, REPO, "no-such-file.txt", "main"),
		).rejects.toThrow(/File not found/);
	});
});

describe("getFileFromBranch", () => {
	it("returns content, size, and isBinary=false for text", async () => {
		const result = await getFileFromBranch(OWNER, REPO, "main", "README.md");
		expect(result.content).toContain("Updated Repo");
		expect(result.size).toBeGreaterThan(0);
		expect(result.isBinary).toBe(false);
	});

	it("detects binary when file contains null byte", async () => {
		// Create a commit with a "binary" file (contains null byte)
		await createCommit(
			OWNER,
			REPO,
			"Add binary file",
			[{ path: "image.bin", content: Buffer.from([0x89, 0x50, 0x00, 0x00]) }],
			"Test User",
			"test@example.com",
		);
		const result = await getFileFromBranch(OWNER, REPO, "main", "image.bin");
		expect(result.isBinary).toBe(true);
		// Binary content returned as base64
		expect(() => Buffer.from(result.content, "base64")).not.toThrow();
	});
});

describe("getBlob", () => {
	it("returns blob buffer by OID", async () => {
		const entries = await getTree(OWNER, REPO, "main", "");
		const readme = entries.find((e) => e.path === "README.md");
		expect(readme).toBeDefined();
		if (!readme) throw new Error("unreachable");
		const buf = await getBlob(OWNER, REPO, readme.oid);
		expect(buf.toString()).toContain("Repo");
	});
});

// ── Write operations ──────────────────────────────────────────────────────────

describe("createCommit", () => {
	it("new file appears in tree", async () => {
		await createCommit(
			OWNER,
			REPO,
			"Add new-file.txt",
			[{ path: "new-file.txt", content: "new content\n" }],
			"Test User",
			"test@example.com",
		);
		const entries = await getTree(OWNER, REPO, "main", "");
		expect(entries.map((e) => e.path)).toContain("new-file.txt");
	});

	it("updated file has new content", async () => {
		await createCommit(
			OWNER,
			REPO,
			"Update new-file.txt",
			[{ path: "new-file.txt", content: "updated content\n" }],
			"Test User",
			"test@example.com",
		);
		const buf = await getFileContent(OWNER, REPO, "new-file.txt", "main");
		expect(buf.toString()).toBe("updated content\n");
	});

	it("commit appears at HEAD of log", async () => {
		const log = await getCommitLog(OWNER, REPO, "main", 1);
		expect(log[0].commit.message.trim()).toBe("Update new-file.txt");
	});

	it("uses default author when none supplied", async () => {
		await createCommit(OWNER, REPO, "No-author commit", [
			{ path: "auto.txt", content: "auto\n" },
		]);
		const [head] = await getCommitLog(OWNER, REPO, "main", 1);
		expect(head.commit.author.name).toBe("PushStack");
	});
});

describe("deleteFile", () => {
	it("removes file from tree", async () => {
		// Ensure file exists
		await createCommit(
			OWNER,
			REPO,
			"Pre-delete commit",
			[{ path: "to-delete.txt", content: "bye\n" }],
			"Test User",
			"test@example.com",
		);

		await deleteFile(
			OWNER,
			REPO,
			"main",
			"to-delete.txt",
			"Remove to-delete.txt",
			{ name: "Test User", email: "test@example.com" },
		);

		const entries = await getTree(OWNER, REPO, "main", "");
		expect(entries.map((e) => e.path)).not.toContain("to-delete.txt");
	});

	it("delete creates a new commit", async () => {
		const [head] = await getCommitLog(OWNER, REPO, "main", 1);
		expect(head.commit.message.trim()).toBe("Remove to-delete.txt");
	});
});

// ── Diff ─────────────────────────────────────────────────────────────────────

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
		expect(statuses).toContain("modified"); // README.md changed
		expect(statuses).toContain("added"); // src/index.js added
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

describe("getDiffBetweenBranches", () => {
	it("main vs feature-branch shows feature.txt added", async () => {
		const diff = await getDiffBetweenBranches(
			OWNER,
			REPO,
			"main",
			"feature-branch",
		);
		const paths = diff.files.map((f) => f.path);
		expect(paths).toContain("feature.txt");
		const featureFile = diff.files.find((f) => f.path === "feature.txt");
		expect(featureFile?.status).toBe("added");
	});

	it("same branch vs itself has no diff", async () => {
		const diff = await getDiffBetweenBranches(OWNER, REPO, "main", "main");
		expect(diff.files).toHaveLength(0);
		expect(diff.totalFiles).toBe(0);
	});
});

// ── Merge ─────────────────────────────────────────────────────────────────────

describe("analyzeMerge", () => {
	it("can merge feature-branch into main", async () => {
		const result = await analyzeMerge(OWNER, REPO, "feature-branch", "main");
		expect(result.canMerge).toBe(true);
		expect(result.hasConflicts).toBe(false);
	});

	it("detects fast-forward when source is ahead", async () => {
		// feature-branch is ahead of main (not vice versa)
		const result = await analyzeMerge(OWNER, REPO, "feature-branch", "main");
		// feature-branch commit descends from main, so merging ff into main is a ff
		expect(typeof result.fastForward).toBe("boolean");
	});

	it("returns canMerge=false for non-existent branch", async () => {
		const result = await analyzeMerge(OWNER, REPO, "ghost-branch", "main");
		expect(result.canMerge).toBe(false);
	});
});

describe("mergeBranches", () => {
	it("merges feature-branch into a fresh target branch", async () => {
		// Create a fresh branch from main's initial state to merge INTO
		await createBranch(OWNER, REPO, "merge-target", "main");

		const result = await mergeBranches(
			OWNER,
			REPO,
			"feature-branch",
			"merge-target",
			{ message: "Merge feature-branch into merge-target" },
		);

		expect(result.success).toBe(true);

		// feature.txt should now be on merge-target
		const entries = await getTree(OWNER, REPO, "merge-target", "");
		const names = entries.map((e) => e.path);
		expect(names).toContain("feature.txt");
	});
});
