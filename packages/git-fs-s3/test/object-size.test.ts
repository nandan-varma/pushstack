import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import git from "isomorphic-git";
import { describe, expect, it } from "vitest";
import {
	createCachedStore,
	createGitFs,
	createRetryStore,
	getObjectSize,
	getObjectSizes,
	MemoryObjectStore,
	type ObjectStore,
} from "../src/index.js";
import { BATCH_MAX_IN_FLIGHT } from "../src/object-size.js";
import type { Repo } from "../src/ops/index.js";
import { authorNow, commitFilesToBare } from "../src/ops/index.js";
import {
	OBJ_OFS_DELTA,
	OBJ_REF_DELTA,
	readEntryHeader,
} from "../src/pack-entry.js";
import { readPackIndex } from "../src/pack-index.js";

/**
 * `getObjectSize` exists so a caller can reject an oversized object *without*
 * inflating it, which means its answer has to be exact for every way git can
 * store an object — including the deltified entries whose "size" field in the
 * pack entry header describes the delta stream rather than the object. The
 * fixture is a real `git repack -adf` output whose blobs are OFS_DELTAs, so
 * comparing every size against the content isomorphic-git hands back covers
 * both.
 */
const FIXTURE = join(import.meta.dirname, "fixtures/deltified");

async function loadFixture(): Promise<{
	repo: Repo;
	store: MemoryObjectStore;
}> {
	const store = new MemoryObjectStore();
	const walk = async (dir: string): Promise<void> => {
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);
			if (statSync(path).isDirectory()) await walk(path);
			else
				await store.put(
					`git/${path.slice(FIXTURE.length + 1)}`,
					new Uint8Array(readFileSync(path)),
				);
		}
	};
	await walk(FIXTURE);
	return { repo: { fs: createGitFs(store), gitdir: "git", cache: {} }, store };
}

async function indexedObjects(
	store: MemoryObjectStore,
): Promise<Array<{ oid: string; type: number }>> {
	const packDir = "git/objects/pack";
	const names = await store.list(packDir);
	const idx = names.objects.find((o) => o.key.endsWith(".idx"));
	if (!idx) throw new Error("fixture has no pack index");
	const entries = readPackIndex(
		await store.get(idx.key).then((d) => d as Uint8Array),
	);
	if (!entries) throw new Error("fixture pack index is not v2");

	const pack = names.objects.find((o) => o.key.endsWith(".pack"));
	if (!pack) throw new Error("fixture has no pack");
	const bytes = (await store.get(pack.key)) as Uint8Array;

	return entries.map((entry) => ({
		oid: entry.oid,
		type: readEntryHeader(bytes, entry.offset).type,
	}));
}

describe("getObjectSize", () => {
	it("matches the real content length of every packed object, deltas included", async () => {
		const { repo, store } = await loadFixture();
		const objects = await indexedObjects(store);

		// The fixture is chosen because it *has* deltas; if it stopped having
		// them this test would silently stop covering the delta path.
		expect(
			objects.filter(
				(o) => o.type === OBJ_OFS_DELTA || o.type === OBJ_REF_DELTA,
			).length,
		).toBeGreaterThan(0);

		for (const { oid } of objects) {
			const { object } = await git.readObject({
				...repo,
				oid,
				format: "content",
			});
			expect(await getObjectSize(repo, oid)).toBe(
				(object as Uint8Array).byteLength,
			);
		}
	});

	it("returns null for a loose object, rather than guessing", async () => {
		const store = new MemoryObjectStore();
		const repo: Repo = { fs: createGitFs(store), gitdir: "git", cache: {} };
		await git.init({ ...repo, dir: "git", bare: true, defaultBranch: "main" });
		const oid = await git.writeBlob({
			...repo,
			blob: new TextEncoder().encode("loose"),
		});

		// A loose object's size lives inside its compressed body, so there is
		// nothing to read cheaply — the caller is told "unknown", not a number.
		expect(await getObjectSize(repo, oid)).toBeNull();
	});

	it("returns null when the store cannot serve ranges", async () => {
		const { repo: fixtureRepo, store } = await loadFixture();
		const [first] = await indexedObjects(store);
		if (!first) throw new Error("fixture has no objects");

		const withoutRange: ObjectStore = {
			get: (k) => store.get(k),
			put: (k, d) => store.put(k, d),
			delete: (k) => store.delete(k),
			head: (k) => store.head(k),
			list: (p, o) => store.list(p, o),
		};
		const repo: Repo = {
			fs: createGitFs(withoutRange),
			gitdir: "git",
			cache: {},
		};

		// Fetching the whole pack to answer a size question is the cost this
		// exists to avoid, so an unsupported store reports "unknown".
		expect(await getObjectSize(repo, first.oid)).toBeNull();
		// The same object *is* measurable through a range-capable store, so the
		// null above is about the store, not about the object.
		expect(await getObjectSize(fixtureRepo, first.oid)).toBeTypeOf("number");
	});

	it("survives the decorator stack a real application builds", async () => {
		// r2 → retry → cache → fs: every wrapper returns a *new* object, so a
		// method that isn't forwarded explicitly is silently dropped — and a
		// dropped `getRange` does not fail, it makes `getObjectSize` answer null,
		// so every size gate quietly reads the whole object instead of refusing
		// it. That is how this bug reached a release: the other tests in this file
		// use a bare store, where the method is never in question.
		const store = new MemoryObjectStore();
		const repo: Repo = {
			fs: createGitFs(createCachedStore(createRetryStore(store))),
			gitdir: "git",
			cache: {},
		};
		const content = new TextEncoder().encode("packed through the whole stack");
		const commitOid = await commitFilesToBare(repo, {
			branch: "main",
			message: "one file",
			author: authorNow("Test", "test@example.com"),
			files: [{ path: "file.txt", content }],
		});

		// `commitFilesToBare` returns the commit; the blob is the interesting
		// object, since its size is what a caller gates on.
		const { commit } = await git.readCommit({ ...repo, oid: commitOid });
		const { tree } = await git.readTree({ ...repo, oid: commit.tree });
		const blobOid = tree.find((entry) => entry.path === "file.txt")?.oid;
		if (!blobOid) throw new Error("blob missing from the committed tree");

		// A null here would mean "size unknown" — exactly the failure this test
		// exists to catch, since a dropped `getRange` makes it null rather than
		// throwing.
		expect(await getObjectSize(repo, blobOid)).toBe(content.byteLength);
	});

	it("reports no range support when the store has none, even through wrappers", async () => {
		const store = new MemoryObjectStore();
		const withoutRange: ObjectStore = {
			get: (k) => store.get(k),
			put: (k, d) => store.put(k, d),
			delete: (k) => store.delete(k),
			head: (k) => store.head(k),
			list: (p, o) => store.list(p, o),
		};
		const repo: Repo = {
			fs: createGitFs(createCachedStore(createRetryStore(withoutRange))),
			gitdir: "git",
			cache: {},
		};
		// Wrapping must not invent the capability.
		expect(
			(repo.fs as { promises: { getRange?: unknown } }).promises.getRange,
		).toBeUndefined();
	});

	it("returns null for an object no pack lists", async () => {
		const { repo } = await loadFixture();
		expect(await getObjectSize(repo, "0".repeat(40))).toBeNull();
	});
});

describe("getObjectSizes", () => {
	it("matches getObjectSize for every object, in one range read per window", async () => {
		const { store } = await loadFixture();
		const objects = await indexedObjects(store);
		let ranges = 0;
		const counting: ObjectStore = {
			get: (k) => store.get(k),
			put: (k, d) => store.put(k, d),
			delete: (k) => store.delete(k),
			head: (k) => store.head(k),
			list: (p, o) => store.list(p, o),
			getRange: (k, s, e) => {
				ranges++;
				return store.getRange(k, s, e);
			},
		};
		const repo: Repo = { fs: createGitFs(counting), gitdir: "git", cache: {} };
		const oids = objects.map((o) => o.oid);
		const missing = "0".repeat(40);
		const sizes = await getObjectSizes(repo, [...oids, missing]);
		const batched = ranges;
		for (const oid of oids) {
			expect(sizes.get(oid)).toBe(await getObjectSize(repo, oid));
			expect(sizes.get(oid)).toBeTypeOf("number");
		}
		expect(sizes.get(missing)).toBeNull();
		// The fixture pack is small: one window covers it.
		expect(batched).toBeLessThanOrEqual(2);
		expect(batched).toBeLessThan(oids.length);
	});

	it("answers null for everything without range support", async () => {
		const { store } = await loadFixture();
		const [first] = await indexedObjects(store);
		const withoutRange: ObjectStore = {
			get: (k) => store.get(k),
			put: (k, d) => store.put(k, d),
			delete: (k) => store.delete(k),
			head: (k) => store.head(k),
			list: (p, o) => store.list(p, o),
		};
		const repo: Repo = {
			fs: createGitFs(withoutRange),
			gitdir: "git",
			cache: {},
		};
		if (!first) throw new Error("fixture has no objects");
		expect((await getObjectSizes(repo, [first.oid])).get(first.oid)).toBeNull();
	});
});

describe("getObjectSizes bounds", () => {
	it("keeps at most BATCH_MAX_IN_FLIGHT range reads in flight for scattered objects", async () => {
		const store = new MemoryObjectStore();
		let inFlight = 0;
		let maxInFlight = 0;
		let ranges = 0;
		const counting: ObjectStore = {
			get: (k) => store.get(k),
			put: (k, d) => store.put(k, d),
			delete: (k) => store.delete(k),
			head: (k) => store.head(k),
			list: (p, o) => store.list(p, o),
			getRange: async (k, s, e) => {
				ranges++;
				inFlight++;
				maxInFlight = Math.max(maxInFlight, inFlight);
				await new Promise((resolve) => setTimeout(resolve, 2));
				inFlight--;
				return store.getRange(k, s, e);
			},
		};
		const repo: Repo = { fs: createGitFs(counting), gitdir: "git", cache: {} };
		// Incompressible 70 KiB blobs: every entry is more than 64 KiB from the
		// next, so no two share a window.
		const files = Array.from({ length: 30 }, (_, i) => {
			const content = new Uint8Array(70 * 1024);
			crypto.getRandomValues(content.subarray(0, 65536));
			crypto.getRandomValues(content.subarray(65536));
			return { path: `f${i}.bin`, content };
		});
		const commitOid = await commitFilesToBare(repo, {
			branch: "main",
			message: "scattered",
			author: authorNow("Test", "test@example.com"),
			files,
		});
		const { commit } = await git.readCommit({ ...repo, oid: commitOid });
		const { tree } = await git.readTree({ ...repo, oid: commit.tree });
		ranges = 0;
		maxInFlight = 0;
		const sizes = await getObjectSizes(
			repo,
			tree.map((entry) => entry.oid),
		);
		for (const entry of tree) expect(sizes.get(entry.oid)).toBe(70 * 1024);
		expect(ranges).toBeGreaterThanOrEqual(files.length);
		expect(maxInFlight).toBeLessThanOrEqual(BATCH_MAX_IN_FLIGHT);
		expect(maxInFlight).toBeGreaterThan(1);
	});

	it("throws when the pack directory listing fails, rather than answering null", async () => {
		const { store } = await loadFixture();
		const [first] = await indexedObjects(store);
		if (!first) throw new Error("fixture has no objects");
		const failingList: ObjectStore = {
			get: (k) => store.get(k),
			put: (k, d) => store.put(k, d),
			delete: (k) => store.delete(k),
			head: (k) => store.head(k),
			list: () => Promise.reject(new Error("storage down")),
			getRange: (k, s, e) => store.getRange(k, s, e),
		};
		const repo: Repo = {
			fs: createGitFs(failingList),
			gitdir: "git",
			cache: {},
		};
		await expect(getObjectSizes(repo, [first.oid])).rejects.toThrow();
		await expect(getObjectSize(repo, first.oid)).rejects.toThrow();
	});
});

describe("existingObjects", () => {
	it("finds packed objects and reports missing ones", async () => {
		const { existingObjects } = await import("../src/index.js");
		const { createGitFs, MemoryObjectStore } = await import("../src/index.js");
		const { withPackedWrites } = await import("../src/ops/index.js");
		const git = (await import("isomorphic-git")).default;
		const repo = {
			fs: createGitFs(new MemoryObjectStore()),
			gitdir: "repos/a/b/git",
			cache: {},
		};
		await git.init({ ...repo, dir: repo.gitdir, bare: true });
		const oid = await withPackedWrites(repo, (packed) =>
			git.writeBlob({ ...packed, blob: new TextEncoder().encode("x") }),
		);
		const missing = "0".repeat(40);
		expect(await existingObjects(repo, [oid, missing])).toEqual(new Set([oid]));
		expect(await existingObjects(repo, [])).toEqual(new Set());
	});
});
