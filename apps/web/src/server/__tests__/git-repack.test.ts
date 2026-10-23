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

// Boot the database (pglite) at collection, not inside the first test that
// takes the repo lock: under a loaded full run that boot alone can pass 5s.
await import("#/db");
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

/**
 * Consolidation runs after the refs have moved, so its failure must never be
 * reported as a failed write — a user retry would then create a second commit.
 * The storage fault stands in for an R2 write whose retries were exhausted.
 */
describe("a failed post-write repack", () => {
	const author = { name: "Test", email: "test@example.com" };

	function failPackWrites(after: number): {
		restore: () => void;
		packWrites: () => number;
	} {
		const fsp = gitFs.promises;
		const writeFile = fsp.writeFile.bind(fsp);
		let count = 0;
		const spy = vi.spyOn(fsp, "writeFile").mockImplementation((path, data) => {
			if (path.endsWith(".pack") && ++count > after) {
				return Promise.reject(new Error("storage write failed"));
			}
			return writeFile(path, data);
		});
		return { restore: () => spy.mockRestore(), packWrites: () => count };
	}

	it("returns the commit that already landed and warns", async () => {
		await initBareRepo(OWNER, "repackfail", "main");
		// Three packs; the commit under test crosses the repack threshold (4).
		for (let i = 1; i <= 3; i++) {
			await createCommit(OWNER, "repackfail", {
				branch: "main",
				message: `seed ${i}`,
				files: [{ path: `s${i}.txt`, content: `${i}\n` }],
				author,
			});
		}

		// The commit's own packed write is the first .pack (its objects must land
		// for the commit to exist); the consolidated pack is the second and fails.
		const fault = failPackWrites(1);
		const warned: string[] = [];
		const warn = vi
			.spyOn(console, "warn")
			.mockImplementation((message?: unknown) => warned.push(String(message)));
		let sha: string;
		try {
			sha = await createCommit(OWNER, "repackfail", {
				branch: "main",
				message: "survives a failed repack",
				files: [{ path: "keep.txt", content: "kept\n" }],
				author,
			});
		} finally {
			fault.restore();
			warn.mockRestore();
		}

		expect(fault.packWrites()).toBe(2);
		expect(sha).toMatch(/^[0-9a-f]{40}$/);
		const log = await getCommitLog(OWNER, "repackfail", "main", 5);
		expect(log.map((entry) => entry.commit.message.trim())).toContain(
			"survives a failed repack",
		);
		expect(
			warned.some((message) => message.includes("repack after write failed")),
		).toBe(true);
	});

	it("fails an explicit maintenance repack instead of reporting zero", async () => {
		await initBareRepo(OWNER, "manual", "main");
		for (let i = 1; i <= 5; i++) {
			await commitFilesToBare(repoFor(OWNER, "manual"), {
				branch: "main",
				message: `manual ${i}`,
				author: authorNow(author.name, author.email),
				files: [{ path: `m${i}.txt`, content: `${i}\n` }],
			});
		}

		// Unlike the post-write path, an operator's explicit repack must report
		// its failure — "removed 0 files" would read as success.
		const fault = failPackWrites(0);
		try {
			await expect(repackRepositoryNow(OWNER, "manual")).rejects.toThrow(
				"storage write failed",
			);
		} finally {
			fault.restore();
		}
	});
});
