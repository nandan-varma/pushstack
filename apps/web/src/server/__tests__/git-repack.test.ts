/**
 * @vitest-environment node
 *
 * Pack consolidation against real fragmented packs: real isomorphic-git over
 * git-fs.ts's in-memory store, the repo lock over pglite.
 */
import { authorNow, commitFilesToBare } from "git-fs-s3/ops";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));

const { gitFs } = await import("../git-fs");
const { getCommitLog, getTree } = await import("../git-read");
const { initBareRepo, repackRepositoryNow, repoFor } = await import(
	"../git-repo"
);
const { createCommit } = await import("../git-write");

const OWNER = "repackowner";

async function countPacks(name: string): Promise<number> {
	const { gitdir } = repoFor(OWNER, name);
	const entries = await gitFs.promises.readdir(`${gitdir}/objects/pack`);
	return entries.filter((f) => f.endsWith(".pack")).length;
}

describe("repackRepositoryNow", () => {
	beforeAll(async () => {
		await initBareRepo(OWNER, "frag", "main");
		// One pack per commit, bypassing createCommit's own threshold repack.
		for (let i = 1; i <= 5; i++) {
			await commitFilesToBare(repoFor(OWNER, "frag"), {
				branch: "main",
				message: `commit ${i}`,
				author: authorNow("Test", "test@example.com"),
				files: [{ path: `file${i}.txt`, content: `content ${i}\n` }],
			});
		}
	});

	it("consolidates to one pack, removing each stale .pack and .idx", async () => {
		const before = await countPacks("frag");
		expect(before).toBeGreaterThanOrEqual(4);
		expect(await repackRepositoryNow(OWNER, "frag")).toBe(before * 2);
		expect(await countPacks("frag")).toBe(1);
	});

	it("preserves history and content", async () => {
		const log = await getCommitLog(OWNER, "frag", "main", 10);
		expect(log.map((c) => c.commit.message.trim())).toEqual([
			"commit 5",
			"commit 4",
			"commit 3",
			"commit 2",
			"commit 1",
		]);
		const entries = await getTree(OWNER, "frag", "main");
		expect(entries.map((e) => e.path).sort()).toEqual([
			"file1.txt",
			"file2.txt",
			"file3.txt",
			"file4.txt",
			"file5.txt",
		]);
	});

	it("is a no-op once consolidated", async () => {
		expect(await repackRepositoryNow(OWNER, "frag")).toBe(0);
	});
});

describe("web-UI commits", () => {
	it("repack themselves once they cross the threshold", async () => {
		await initBareRepo(OWNER, "web", "main");
		for (let i = 1; i <= 9; i++) {
			await createCommit(OWNER, "web", {
				branch: "main",
				message: `web ${i}`,
				files: [{ path: `w${i}.txt`, content: `${i}\n` }],
				author: { name: "Test", email: "test@example.com" },
			});
		}
		expect(await countPacks("web")).toBeLessThan(4);
		expect(await getCommitLog(OWNER, "web", "main", 20)).toHaveLength(9);
	});
});
