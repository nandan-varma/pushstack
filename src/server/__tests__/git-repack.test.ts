/**
 * @vitest-environment node
 *
 * Real isomorphic-git integration test for repackRepositoryNow (delegates
 * to git-fs-s3's repackRepository) — no mocks: the real gitFs stack over
 * git-fs.ts's in-memory object store (R2 isn't configured in tests), no
 * native `git` binary anywhere (including fixture setup).
 * This file exists specifically to exercise the real consolidation logic
 * against real fragmented packs, the exact scenario production hit. Needs the real `node` environment (not the
 * project default `jsdom`): repackRepository's pack compression uses
 * `Blob.stream()` + `CompressionStream`, which jsdom's `Blob` polyfill
 * doesn't implement.
 */

import { authorNow, commitFilesToBare } from "git-fs-s3/ops";
import { beforeAll, describe, expect, it, vi } from "vitest";

// DATABASE_URL: src/db/index.ts throws at import time if it's unset, and
// under the `node` environment (see the docblock above) Vite's .env.local
// auto-load into process.env doesn't reach this module graph the way it does
// under the project's default jsdom environment. The value itself doesn't
// matter — `db` is mocked below (withRepositoryLock needs a reachable
// Postgres for its lease-row CAS; see helpers/fake-repo-lock-db.ts).
vi.hoisted(() => {
	process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
});

const lockStore = vi.hoisted(() => new Map());

vi.mock("../../db", async () => {
	const { createFakeRepoLockDb } = await import("./helpers/fake-repo-lock-db");
	return { db: createFakeRepoLockDb(lockStore as never) };
});

vi.mock("drizzle-orm", async (importOriginal) => {
	const { fakeRepoLockDrizzleOrmOverrides } = await import(
		"./helpers/fake-repo-lock-db"
	);
	const actual = await importOriginal<typeof import("drizzle-orm")>();
	return { ...actual, ...fakeRepoLockDrizzleOrmOverrides() };
});

// Import after env is set
import { getCommitLog, getTreeFromBranch } from "../git-history-ops";
import { repackRepositoryNow } from "../git-http-iso";
import { getBareRepoOptions, initBareRepo } from "../git-manager-iso";

const OWNER = "repacktestowner";
const REPO = "repacktestrepo";

const repo = () => getBareRepoOptions(OWNER, REPO);

async function countPacks(): Promise<number> {
	const { fs, gitdir } = repo();
	const entries = await fs.promises
		.readdir(`${gitdir}/objects/pack`)
		.catch(() => [] as string[]);
	return entries.filter((f) => f.endsWith(".pack")).length;
}

beforeAll(async () => {
	await initBareRepo(OWNER, REPO, "main");

	// Fragment into several packs the way real writes do: every commit
	// (git-fs-s3's commitFilesToBare) stores its objects as one new pack.
	// Called directly rather than through createCommit, which would
	// consolidate them again once they cross the repack threshold.
	for (let i = 1; i <= 5; i++) {
		await commitFilesToBare(repo(), {
			branch: "main",
			message: `commit ${i}`,
			author: authorNow("Test", "test@example.com"),
			files: [{ path: `file${i}.txt`, content: `content ${i}\n` }],
		});
	}
});

describe("repackRepositoryNow", () => {
	it("starts with multiple fragmented packs", async () => {
		expect(await countPacks()).toBeGreaterThanOrEqual(4);
	});

	it("consolidates to a single pack and reports the removed count", async () => {
		const packsBefore = await countPacks();

		const result = await repackRepositoryNow(OWNER, REPO);

		expect(result.removedFiles).toBeGreaterThan(0);
		// Each stale pack contributes both a .pack and a .idx path
		expect(result.removedFiles).toBe(packsBefore * 2);
		expect(await countPacks()).toBe(1);
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
		const entries = await getTreeFromBranch(OWNER, REPO, "main", "");
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
		const result = await repackRepositoryNow(OWNER, REPO);
		expect(result.removedFiles).toBe(0);
		expect(await countPacks()).toBe(1);
	});
});

describe("web-UI commits stay consolidated", () => {
	it("repacks once commits cross the pack threshold, keeping history intact", async () => {
		const { createCommit } = await import("../git-commit-write");
		const owner = "repacktestowner";
		const name = "webcommits";
		await initBareRepo(owner, name, "main");
		for (let i = 1; i <= 9; i++) {
			await createCommit(owner, name, {
				branch: "main",
				message: `web ${i}`,
				files: [{ path: `w${i}.txt`, content: `${i}\n` }],
				author: { name: "Test", email: "test@example.com" },
			});
		}
		const { fs, gitdir } = getBareRepoOptions(owner, name);
		const packs = (await fs.promises.readdir(`${gitdir}/objects/pack`)).filter(
			(f: string) => f.endsWith(".pack"),
		);
		expect(packs.length).toBeLessThan(4);
		const log = await getCommitLog(owner, name, "main", 20);
		expect(log).toHaveLength(9);
	});
});
