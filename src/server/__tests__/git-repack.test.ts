/**
 * Real git integration test for repackLocal / repackRepositoryNow — no mocks,
 * actual filesystem, actual `git` subprocess. This path has no coverage from
 * git-http-iso.test.ts (which mocks isomorphic-git and node:fs entirely, so
 * repackLocal's real-git spawn calls never execute there — the pack-count
 * threshold guard always short-circuits first against mocked, empty fs
 * state) — this file exists specifically to exercise the real consolidation
 * logic against real fragmented packs, the exact scenario production hit.
 */

import { execFile } from "node:child_process";
import { promises as nodeFs } from "node:fs";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const execFileAsync = promisify(execFile);

// Must be hoisted so git-manager-iso captures GIT_REPOS_PATH at module init
const TEST_DIR = vi.hoisted(() => {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const os = require("node:os");
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const p = require("node:path");
	const dir = p.join(os.tmpdir(), `pushstack-repack-test-${Date.now()}`);
	process.env.GIT_REPOS_PATH = dir;
	return dir;
});

// Import after env is set
import { createCommit } from "../git-commit-write";
import { getCommitLog, getTree } from "../git-history-ops";
import { repackRepositoryNow } from "../git-http-iso";
import { getRepoPath, initBareRepo } from "../git-manager-iso";

const OWNER = "repacktestowner";
const REPO = "repacktestrepo";

async function countLocalPacks(): Promise<number> {
	const packDir = `${getRepoPath(OWNER, REPO)}/objects/pack`;
	try {
		const entries = await nodeFs.readdir(packDir);
		return entries.filter((f) => f.endsWith(".pack")).length;
	} catch {
		return 0;
	}
}

beforeAll(async () => {
	await nodeFs.mkdir(TEST_DIR, { recursive: true });
	await initBareRepo(OWNER, REPO);

	const repoPath = getRepoPath(OWNER, REPO);

	// Fragment into several packs the same way real pushes do: each commit
	// writes loose objects (via isomorphic-git's writeBlob/writeTree/writeCommit
	// inside createCommit), then `git repack -q` (no -a, no -d) packs just the
	// currently-loose objects into a *new* pack file, leaving any earlier packs
	// untouched — repeat a few times and packs accumulate exactly like
	// consecutive `pushstack-recv-*.pack` files did in production.
	for (let i = 1; i <= 5; i++) {
		await createCommit(
			OWNER,
			REPO,
			`commit ${i}`,
			[{ path: `file${i}.txt`, content: `content ${i}\n` }],
			"Test",
			"test@example.com",
			"main",
		);
		await execFileAsync("git", ["repack", "-q"], { cwd: repoPath });
	}
});

afterAll(async () => {
	await nodeFs.rm(TEST_DIR, { recursive: true, force: true });
});

describe("repackRepositoryNow", () => {
	it("starts with multiple fragmented packs", async () => {
		expect(await countLocalPacks()).toBeGreaterThanOrEqual(4);
	});

	it("consolidates to a single pack and reports the removed count", async () => {
		const packsBefore = await countLocalPacks();

		const result = await repackRepositoryNow(OWNER, REPO, "main");

		expect(result.removedPacks).toBeGreaterThan(0);
		// Each stale pack contributes both a .pack and a .idx path
		expect(result.removedPacks).toBe(packsBefore * 2);
		expect(await countLocalPacks()).toBe(1);
	});

	it("preserves the exact commit history after consolidating", async () => {
		const log = await getCommitLog(OWNER, REPO, "main", 10);
		expect(log.map((c) => c.commit.message.trim())).toEqual([
			"commit 5",
			"commit 4",
			"commit 3",
			"commit 2",
			"commit 1",
		]);
	});

	it("preserves every file's content after consolidating", async () => {
		const entries = await getTree(OWNER, REPO, "main", "");
		const names = entries.map((e) => e.path).sort();
		expect(names).toEqual([
			"file1.txt",
			"file2.txt",
			"file3.txt",
			"file4.txt",
			"file5.txt",
		]);
	});

	it("is a no-op (returns zero) when already consolidated", async () => {
		const result = await repackRepositoryNow(OWNER, REPO, "main");
		expect(result.removedPacks).toBe(0);
		expect(await countLocalPacks()).toBe(1);
	});
});
