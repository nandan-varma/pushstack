/**
 * Regression coverage for repackRepository's pack trailer.
 *
 * buildVerifiedPack used to compute the trailing SHA-1 as a chained hash
 * (sha1(prevHash ++ chunk) repeated per chunk) instead of a single sha1 over
 * every preceding byte — a different, wrong value, since Web Crypto's
 * subtle.digest has no incremental mode. isomorphic-git's own pack reader
 * verifies this trailer on every subsequent read, so a corrupted trailer
 * doesn't fail loudly at repack time — it fails later, on the next clone or
 * log, with "Packfile trailer mismatch". These tests read the repacked pack
 * straight back through real isomorphic-git calls so that failure mode can't
 * hide.
 */
import git from "isomorphic-git";
import { describe, expect, it, vi } from "vitest";
import {
	consolidateKeptPacks,
	repackRepository,
} from "../../src/http/repack.js";
import { rawFs } from "../../src/http/types.js";
import { createGitFs, MemoryObjectStore } from "../../src/index.js";
import {
	authorNow,
	commitFilesToBare,
	type Repo,
	withPackedWrites,
} from "../../src/ops/index.js";
import { parsePackFileName } from "../../src/pack-files.js";

const author = authorNow("Test", "test@example.com");

function makeRepo(): { repo: Repo; store: MemoryObjectStore } {
	const store = new MemoryObjectStore();
	const fs = createGitFs(store);
	return { repo: { fs, gitdir: "repos/alice/blog/git", cache: {} }, store };
}

async function seed(repo: Repo, commitCount: number) {
	await git.init({
		...repo,
		dir: repo.gitdir,
		bare: true,
		defaultBranch: "main",
	});
	for (let i = 0; i < commitCount; i++) {
		await commitFilesToBare(repo, {
			branch: "main",
			message: `commit ${i}\n`,
			author,
			files: [{ path: "file.txt", content: `content ${i}\n` }],
		});
	}
}

/** Fool countPacks' threshold check — its content is never read, only counted. */
async function addDummyPackFiles(repo: Repo, count: number) {
	const fsp = rawFs(repo);
	await fsp.mkdir(`${repo.gitdir}/objects/pack`, { recursive: true });
	for (let i = 0; i < count; i++) {
		await fsp.writeFile(
			`${repo.gitdir}/objects/pack/dummy-${i}.pack`,
			new Uint8Array([0]),
		);
	}
}

/**
 * isomorphic-git resolves an object from loose storage first if present,
 * falling back to packed storage only when no loose copy exists — so a
 * naive "read it back after repacking" test would keep silently reading the
 * pre-existing loose copies commitFilesToBare wrote, never touching the new
 * pack's trailer-verification path at all. Deleting the loose objects here
 * forces every subsequent read through the packed path.
 */
async function deleteLooseObjects(repo: Repo, store: MemoryObjectStore) {
	const prefix = `${repo.gitdir}/objects/`;
	const { objects } = await store.list(prefix);
	for (const { key } of objects) {
		if (key.includes("/pack/")) continue;
		await store.delete(key);
	}
}

describe("repackRepository", () => {
	it("produces a pack whose trailer isomorphic-git accepts on read-back", async () => {
		const { repo, store } = makeRepo();
		await seed(repo, 5);
		await addDummyPackFiles(repo, 4);

		const stalePaths = await repackRepository(repo, { threshold: 4 });

		expect(
			stalePaths.filter((p) => p.startsWith("objects/pack/dummy-")),
		).toHaveLength(4);

		// Force every subsequent read through the new pack (see
		// deleteLooseObjects's comment) so isomorphic-git's own packfile
		// trailer verification (readObjectPacked -> _checksumVerified) on the
		// new pack actually runs — a wrong trailer throws "Packfile trailer
		// mismatch" here, not at repack time.
		await deleteLooseObjects(repo, store);

		const log = await git.log({ ...repo, ref: "main" });
		expect(log.length).toBe(5);
		expect(log[0]?.commit.message).toBe("commit 4\n");

		const headOid = await git.resolveRef({ ...repo, ref: "refs/heads/main" });
		const { blob } = await git.readBlob({
			...repo,
			oid: headOid,
			filepath: "file.txt",
		});
		expect(new TextDecoder().decode(blob)).toBe("content 4\n");
	});

	it("independently verifies the trailer bytes match sha1 of the pack body", async () => {
		const { repo } = makeRepo();
		await seed(repo, 3);
		await addDummyPackFiles(repo, 4);

		await repackRepository(repo, { threshold: 4 });

		const fsp = rawFs(repo);
		const packDir = `${repo.gitdir}/objects/pack`;
		const entries = await fsp.readdir(packDir);
		const packFile = entries.find((f) => f.endsWith(".pack"));
		expect(packFile).toBeDefined();

		const packData = await fsp.readFile(`${packDir}/${packFile}`);
		const bytes =
			packData instanceof Uint8Array
				? packData
				: new TextEncoder().encode(packData as string);

		const body = bytes.subarray(0, bytes.length - 20);
		const trailer = bytes.subarray(bytes.length - 20);
		const expected = new Uint8Array(
			await crypto.subtle.digest("SHA-1", new Uint8Array(body)),
		);
		expect(Array.from(trailer)).toEqual(Array.from(expected));
	});

	it("skips repacking below the pack-count threshold", async () => {
		const { repo } = makeRepo();
		await seed(repo, 2);
		await addDummyPackFiles(repo, 2);

		const stalePaths = await repackRepository(repo, { threshold: 5 });
		expect(stalePaths).toEqual([]);
	});

	it("consolidates fully packed repos by reusing entries, never growing", async () => {
		const { repo, store } = makeRepo();
		await git.init({
			...repo,
			dir: repo.gitdir,
			bare: true,
			defaultBranch: "main",
		});
		const fsp = rawFs(repo);
		const packDir = `${repo.gitdir}/objects/pack`;

		async function packLoose(): Promise<string> {
			const { objects } = await store.list(`${repo.gitdir}/objects/`);
			const oids = objects
				.map(({ key }) => /objects\/([0-9a-f]{2})\/([0-9a-f]{38})$/.exec(key))
				.filter((m): m is RegExpExecArray => m !== null)
				.map((m) => `${m[1]}${m[2]}`);
			const { filename } = await git.packObjects({
				...repo,
				oids,
				write: true,
			});
			await git.indexPack({ ...repo, dir: packDir, filepath: filename });
			await deleteLooseObjects(repo, store);
			return filename.replace(/\.pack$/, "");
		}

		await commitFilesToBare(repo, {
			branch: "main",
			message: "big\n",
			author,
			files: Array.from({ length: 20 }, (_, i) => ({
				path: `f${i}.txt`,
				// Incompressible, so this pack really dominates the small ones.
				content: Array.from({ length: 500 }, () =>
					Math.random().toString(36),
				).join(""),
			})),
		});
		async function packBytes(): Promise<number> {
			const { objects } = await store.list(`${packDir}/`);
			return objects
				.filter(
					({ key }) =>
						parsePackFileName(key.slice(packDir.length + 1))?.kind === "pack",
				)
				.reduce((sum, { size }) => sum + size, 0);
		}

		const base = await packLoose();
		await fsp.writeFile(`${packDir}/${base}.bitmap`, new Uint8Array([1]));
		const small: string[] = [];
		for (let i = 0; i < 3; i++) {
			await commitFilesToBare(repo, {
				branch: "main",
				message: `small ${i}\n`,
				author,
				files: [{ path: "small.txt", content: `${i}\n` }],
			});
			small.push(await packLoose());
		}

		const sourceBytes = await packBytes();
		const stale = await repackRepository(repo, { threshold: 4 });

		expect(stale).toEqual(
			expect.arrayContaining([
				`objects/pack/${base}.pack`,
				`objects/pack/${base}.bitmap`,
				...small.map((n) => `objects/pack/${n}.pack`),
			]),
		);
		const remaining = await fsp.readdir(packDir);
		expect(remaining.filter((f) => f.endsWith(".pack"))).toHaveLength(1);
		expect(await packBytes()).toBeLessThanOrEqual(sourceBytes);

		const log = await git.log({ ...repo, ref: "main" });
		expect(log.map((c) => c.commit.message)).toEqual([
			"small 2\n",
			"small 1\n",
			"small 0\n",
			"big\n",
		]);
		const head = log[0]?.oid as string;
		const { blob } = await git.readBlob({
			...repo,
			oid: head,
			filepath: "f3.txt",
		});
		expect(blob.length).toBeGreaterThan(1000);
	});

	it("propagates a failed consolidation instead of reporting success", async () => {
		const { repo } = makeRepo();
		await seed(repo, 3);
		await addDummyPackFiles(repo, 4);

		// Storage fails on the new, consolidated pack — after every pack was
		// read, so the only thing that breaks is the write.
		const fsp = rawFs(repo);
		const writeFile = fsp.writeFile.bind(fsp);
		const spy = vi
			.spyOn(fsp, "writeFile")
			.mockImplementation((path, data) =>
				path.endsWith(".pack")
					? Promise.reject(new Error("storage write failed"))
					: writeFile(path, data),
			);
		try {
			// Swallowing this would make callers (a web commit, a push, an explicit
			// maintenance repack) believe consolidation succeeded.
			await expect(repackRepository(repo, { threshold: 4 })).rejects.toThrow(
				"storage write failed",
			);
		} finally {
			spy.mockRestore();
		}
	});

	it("keeps every ref's history when one ref read fails during consolidation", async () => {
		const { repo } = makeRepo();
		await seed(repo, 2);
		const featureTip = await commitFilesToBare(repo, {
			branch: "feature",
			message: "feature\n",
			author,
			files: [{ path: "feature.txt", content: "feature\n" }],
		});
		await addDummyPackFiles(repo, 4);

		const packDir = `${repo.gitdir}/objects/pack`;
		const before = (await rawFs(repo).readdir(packDir)).sort();

		// Treating an unreadable tip as "this ref has nothing to keep" drops
		// feature's history from the consolidated pack, and the cleanup below
		// then deletes the pack that still held it — a dangling branch.
		const realResolveRef = git.resolveRef;
		const spy = vi
			.spyOn(git, "resolveRef")
			.mockImplementation((args) =>
				args.ref === "refs/heads/feature"
					? Promise.reject(new Error("storage read failed"))
					: realResolveRef(args),
			);
		try {
			await expect(repackRepository(repo, { threshold: 4 })).rejects.toThrow(
				"storage read failed",
			);
		} finally {
			spy.mockRestore();
		}

		expect((await rawFs(repo).readdir(packDir)).sort()).toEqual(before);
		await expect(
			git.readCommit({ ...repo, oid: featureTip }),
		).resolves.toBeDefined();
	});

	it("removes .bitmap/.rev files of packs it replaces", async () => {
		const { repo } = makeRepo();
		await seed(repo, 2);
		await addDummyPackFiles(repo, 4);
		const fsp = rawFs(repo);
		await fsp.writeFile(
			`${repo.gitdir}/objects/pack/dummy-0.bitmap`,
			new Uint8Array([0]),
		);
		await fsp.writeFile(
			`${repo.gitdir}/objects/pack/dummy-0.rev`,
			new Uint8Array([0]),
		);

		const stale = await repackRepository(repo, { threshold: 4 });

		expect(stale).toContain("objects/pack/dummy-0.bitmap");
		expect(stale).toContain("objects/pack/dummy-0.rev");
	});
});

describe("repackRepository — pack listing failures (#92)", () => {
	it("rejects when the pack directory can't be listed, instead of reporting nothing to do", async () => {
		const { repo } = makeRepo();
		await seed(repo, 4);
		const fsp = rawFs(repo);
		const spy = vi
			.spyOn(fsp, "readdir")
			.mockRejectedValue(new Error("storage listing failed"));
		try {
			await expect(repackRepository(repo, { threshold: 4 })).rejects.toThrow(
				"storage listing failed",
			);
		} finally {
			spy.mockRestore();
		}
	});

	it("still treats an empty repository's missing pack directory as nothing to do", async () => {
		const { repo } = makeRepo();
		await git.init({ ...repo, dir: repo.gitdir, bare: true });
		await expect(repackRepository(repo, { threshold: 1 })).resolves.toEqual([]);
	});
});

describe("repackRepository — kept packs", () => {
	/** A blob no ref reaches, written as its own pack with a `.keep` until `until`. */
	async function writeUnreachableBlob(repo: Repo, until: Date) {
		return withPackedWrites(
			repo,
			(packed) =>
				git.writeBlob({
					...packed,
					blob: new TextEncoder().encode("orphan\n"),
				}),
			{ keepUntil: until },
		);
	}

	const packBases = async (repo: Repo) =>
		(await rawFs(repo).readdir(`${repo.gitdir}/objects/pack`))
			.map((name: string) => parsePackFileName(name))
			.filter((file) => file !== null);

	it("keeps an unexpired pack's unreachable objects and doesn't count it", async () => {
		const { repo } = makeRepo();
		await seed(repo, 3);
		const now = new Date("2026-01-01T00:00:00Z");
		const oid = await writeUnreachableBlob(
			repo,
			new Date("2026-01-01T01:00:00Z"),
		);
		// 3 unkept packs: below the threshold of 4, the kept one doesn't count.
		expect(await repackRepository(repo, { threshold: 4, now })).toEqual([]);
		await seed(repo, 1);
		const stale = await repackRepository(repo, { threshold: 4, now });
		expect(stale.length).toBeGreaterThan(0);
		repo.cache = {};
		const { blob } = await git.readBlob({ ...repo, oid });
		expect(new TextDecoder().decode(blob)).toBe("orphan\n");
		const files = await packBases(repo);
		expect(files.filter((file) => file.kind === "keep")).toHaveLength(1);
	});

	it("drops an expired pack with its .keep and unreachable objects", async () => {
		const { repo } = makeRepo();
		await seed(repo, 4);
		const oid = await writeUnreachableBlob(
			repo,
			new Date("2026-01-01T01:00:00Z"),
		);
		const stale = await repackRepository(repo, {
			threshold: 4,
			now: new Date("2026-01-02T00:00:00Z"),
		});
		expect(stale.some((path) => path.endsWith(".keep"))).toBe(true);
		const files = await packBases(repo);
		expect(files.filter((file) => file.kind === "keep")).toEqual([]);
		repo.cache = {};
		await expect(git.readBlob({ ...repo, oid })).rejects.toThrow();
	});

	it("keeps a pack whose .keep isn't ours indefinitely, as git does", async () => {
		const { repo } = makeRepo();
		await seed(repo, 4);
		const [first] = (await packBases(repo)).filter((f) => f.kind === "pack");
		await rawFs(repo).writeFile(
			`${repo.gitdir}/objects/pack/${first?.base}.keep`,
			"receive-pack 123 on host\n",
		);
		// Only 3 unkept packs remain: nothing to do.
		expect(await repackRepository(repo, { threshold: 4 })).toEqual([]);
		await seed(repo, 1);
		const stale = await repackRepository(repo, { threshold: 4 });
		expect(stale.some((path) => path.includes(first?.base as string))).toBe(
			false,
		);
	});
});

describe("consolidateKeptPacks", () => {
	const until = new Date("2026-01-02T00:00:00Z");
	const now = new Date("2026-01-01T00:00:00Z");

	async function writeKeptBlobs(
		repo: Repo,
		count: number,
		keepUntil = until,
		from = 0,
	) {
		const oids: string[] = [];
		for (let i = from; i < from + count; i++) {
			oids.push(
				await withPackedWrites(
					repo,
					(packed) =>
						git.writeBlob({
							...packed,
							blob: new TextEncoder().encode(`kept ${i}\n`),
						}),
					{ keepUntil },
				),
			);
		}
		return oids;
	}

	const kinds = async (repo: Repo) =>
		(await rawFs(repo).readdir(`${repo.gitdir}/objects/pack`))
			.map((name: string) => parsePackFileName(name))
			.filter((file) => file !== null)
			.map((file) => file.kind);

	it("merges kept packs into one kept pack past the threshold", async () => {
		const { repo } = makeRepo();
		await seed(repo, 1);
		const oids = await writeKeptBlobs(repo, 3);
		expect(
			await consolidateKeptPacks(repo, { threshold: 4, keepUntil: until, now }),
		).toEqual([]);
		oids.push(
			...(await writeKeptBlobs(repo, 1, new Date("2026-01-03T00:00:00Z"), 3)),
		);
		const removed = await consolidateKeptPacks(repo, {
			threshold: 4,
			keepUntil: until,
			now,
		});
		expect(removed.filter((path) => path.endsWith(".pack"))).toHaveLength(4);
		// One commit pack, one merged kept pack.
		expect((await kinds(repo)).filter((kind) => kind === "keep")).toHaveLength(
			1,
		);
		expect((await kinds(repo)).filter((kind) => kind === "pack")).toHaveLength(
			2,
		);
		repo.cache = {};
		for (const [i, oid] of oids.entries()) {
			const { blob } = await git.readBlob({ ...repo, oid });
			expect(new TextDecoder().decode(blob)).toBe(`kept ${i}\n`);
		}
		// The merged keep lasts as long as the longest one it replaced.
		const keepName = (
			await rawFs(repo).readdir(`${repo.gitdir}/objects/pack`)
		).find((name: string) => name.endsWith(".keep"));
		const content = await rawFs(repo).readFile(
			`${repo.gitdir}/objects/pack/${keepName}`,
		);
		expect(new TextDecoder().decode(content as Uint8Array)).toContain(
			"2026-01-03T00:00:00.000Z",
		);
	});

	it("leaves expired and foreign keeps to repack", async () => {
		const { repo } = makeRepo();
		await seed(repo, 1);
		await writeKeptBlobs(repo, 4, new Date("2025-01-01T00:00:00Z"));
		expect(
			await consolidateKeptPacks(repo, { threshold: 4, keepUntil: until, now }),
		).toEqual([]);
	});
});

describe("repackRepository — pull request roots", () => {
	/** A commit that only `refs/pull/7/head` names once its branch is gone. */
	async function prOnlyCommit(repo: Repo, namePull: boolean) {
		await seed(repo, 2);
		const tip = await commitFilesToBare(repo, {
			branch: "topic",
			message: "pr work\n",
			author,
			files: [{ path: "pr.txt", content: "pr\n" }],
		});
		if (namePull) {
			await git.writeRef({ ...repo, ref: "refs/pull/7/head", value: tip });
		}
		await git.deleteRef({ ...repo, ref: "refs/heads/topic" });
		await addDummyPackFiles(repo, 4);
		return tip;
	}

	it("keeps objects reachable only from refs/pull/<n>/head", async () => {
		const { repo, store } = makeRepo();
		const tip = await prOnlyCommit(repo, true);

		await repackRepository(repo, { threshold: 4 });
		await deleteLooseObjects(repo, store);

		const { blob } = await git.readBlob({
			...repo,
			oid: tip,
			filepath: "pr.txt",
		});
		expect(new TextDecoder().decode(blob)).toBe("pr\n");
	});

	it("drops the same commit once no ref names it (control for the test above)", async () => {
		const { repo, store } = makeRepo();
		const tip = await prOnlyCommit(repo, false);

		await repackRepository(repo, { threshold: 4 });
		await deleteLooseObjects(repo, store);

		await expect(git.readCommit({ ...repo, oid: tip })).rejects.toThrow();
	});
});
