import git from "isomorphic-git";
import { describe, expect, it, vi } from "vitest";
import { rawFs } from "../src/http/types.js";
import { createGitFs, MemoryObjectStore } from "../src/index.js";
import {
	authorNow,
	CopyLimitError,
	commitFilesToBare,
	copyMissingObjects,
	type Repo,
} from "../src/ops/index.js";

const author = authorNow("Test", "test@example.com");

/** Two repositories in one store: a parent and a fork of it. */
function makePair() {
	const store = new MemoryObjectStore();
	const fs = createGitFs(store);
	const parent: Repo = { fs, gitdir: "repos/alice/parent/git", cache: {} };
	const fork: Repo = { fs, gitdir: "repos/bob/fork/git", cache: {} };
	return { store, parent, fork };
}

async function initBare(repo: Repo) {
	await git.init({
		...repo,
		dir: repo.gitdir,
		bare: true,
		defaultBranch: "main",
	});
}

/** Objects a repo stores as loose files (anything not under objects/pack). */
async function looseKeys(store: MemoryObjectStore, repo: Repo) {
	const { objects } = await store.list(`${repo.gitdir}/objects/`);
	return objects
		.map(({ key }) => key)
		.filter((key) => /\/objects\/[0-9a-f]{2}\//.test(key));
}

async function packFiles(repo: Repo) {
	const names = await rawFs(repo)
		.readdir(`${repo.gitdir}/objects/pack`)
		.catch(() => [] as string[]);
	return names.filter((name) => name.endsWith(".pack"));
}

const generous = { maxObjects: 1000, maxBytes: 10 * 1024 * 1024 };

describe("copyMissingObjects", () => {
	it("copies a whole history into an empty repository as readable packs", async () => {
		const { store, parent, fork } = makePair();
		await initBare(parent);
		await initBare(fork);
		await commitFilesToBare(parent, {
			branch: "main",
			message: "one\n",
			author,
			files: [{ path: "dir/file.txt", content: "one\n" }],
		});
		const head = await commitFilesToBare(parent, {
			branch: "main",
			message: "two\n",
			author,
			files: [{ path: "other/keep.txt", content: "keep\n" }],
		});

		const result = await copyMissingObjects(parent, fork, head, generous);

		// Two commits, two root trees, the dir and other subtrees, two blobs.
		expect(result.objects).toBeGreaterThanOrEqual(7);
		expect(result.bytes).toBeGreaterThan(0);
		expect(await packFiles(fork)).toHaveLength(1);
		expect(await looseKeys(store, fork)).toEqual([]);

		const { blob } = await git.readBlob({
			...fork,
			oid: head,
			filepath: "dir/file.txt",
		});
		expect(new TextDecoder().decode(blob)).toBe("one\n");
		expect((await git.log({ ...fork, ref: head })).length).toBe(2);
	});

	it("copies only what changed since the destination's head", async () => {
		const { parent, fork } = makePair();
		await initBare(parent);
		await initBare(fork);
		const base = await commitFilesToBare(parent, {
			branch: "main",
			message: "base\n",
			author,
			files: [
				{ path: "dir/file.txt", content: "a\n" },
				{ path: "other/big.txt", content: "untouched\n" },
			],
		});
		await copyMissingObjects(parent, fork, base, generous);

		const next = await commitFilesToBare(parent, {
			branch: "main",
			message: "next\n",
			author,
			files: [{ path: "dir/file.txt", content: "b\n" }],
		});

		// Commit, root tree, dir tree and the new blob. The untouched `other`
		// subtree and its blob are already in the destination and are skipped.
		const result = await copyMissingObjects(parent, fork, next, {
			...generous,
			haves: [base],
		});
		expect(result.objects).toBe(4);

		const { blob } = await git.readBlob({
			...fork,
			oid: next,
			filepath: "dir/file.txt",
		});
		expect(new TextDecoder().decode(blob)).toBe("b\n");
	});

	it("finds the already-present objects without being told about them", async () => {
		const { parent, fork } = makePair();
		await initBare(parent);
		await initBare(fork);
		const base = await commitFilesToBare(parent, {
			branch: "main",
			message: "base\n",
			author,
			files: [
				{ path: "dir/file.txt", content: "a\n" },
				{ path: "other/big.txt", content: "untouched\n" },
			],
		});
		await copyMissingObjects(parent, fork, base, generous);
		const next = await commitFilesToBare(parent, {
			branch: "main",
			message: "next\n",
			author,
			files: [{ path: "dir/file.txt", content: "b\n" }],
		});

		const result = await copyMissingObjects(parent, fork, next, generous);
		expect(result.objects).toBe(4);
	});

	it("writes nothing when the destination already has the commit", async () => {
		const { parent, fork } = makePair();
		await initBare(parent);
		await initBare(fork);
		const head = await commitFilesToBare(parent, {
			branch: "main",
			message: "only\n",
			author,
			files: [{ path: "a.txt", content: "a\n" }],
		});
		await copyMissingObjects(parent, fork, head, generous);
		const before = await packFiles(fork);

		const result = await copyMissingObjects(parent, fork, head, generous);

		expect(result).toEqual({ objects: 0, bytes: 0 });
		expect(await packFiles(fork)).toEqual(before);
	});

	it("refuses over the object cap before writing anything", async () => {
		const { parent, fork } = makePair();
		await initBare(parent);
		await initBare(fork);
		const head = await commitFilesToBare(parent, {
			branch: "main",
			message: "many\n",
			author,
			files: [
				{ path: "a.txt", content: "a\n" },
				{ path: "b.txt", content: "b\n" },
			],
		});
		// Commit, root tree and two blobs: four objects.
		const before = await packFiles(fork);

		const error = await copyMissingObjects(parent, fork, head, {
			maxObjects: 3,
			maxBytes: 10 * 1024 * 1024,
		}).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(CopyLimitError);
		expect((error as CopyLimitError).metric).toBe("objects");
		expect((error as CopyLimitError).statusCode).toBe(422);
		expect(await packFiles(fork)).toEqual(before);
	});

	it("refuses a large blob from its size alone, without inflating it", async () => {
		const { store, parent, fork } = makePair();
		await initBare(parent);
		await initBare(fork);
		const bigContent = "x".repeat(200_000);
		const head = await commitFilesToBare(parent, {
			branch: "main",
			message: "big\n",
			author,
			files: [{ path: "big.txt", content: bigContent }],
		});
		const { oid: bigOid } = await git.readBlob({
			...parent,
			oid: head,
			filepath: "big.txt",
		});

		const readObject = vi.spyOn(git, "readObject");
		try {
			await expect(
				copyMissingObjects(parent, fork, head, {
					maxObjects: 1000,
					maxBytes: 10_000,
				}),
			).rejects.toMatchObject({ metric: "bytes" });
			const readOids = readObject.mock.calls.map(
				([args]) => (args as { oid: string }).oid,
			);
			expect(readOids).not.toContain(bigOid);
		} finally {
			readObject.mockRestore();
		}
		expect(await packFiles(fork)).toEqual([]);
		expect(await looseKeys(store, fork)).toEqual([]);
	});

	it("copies an annotated tag's target and keeps the tag object", async () => {
		const { parent, fork } = makePair();
		await initBare(parent);
		await initBare(fork);
		const head = await commitFilesToBare(parent, {
			branch: "main",
			message: "tagged\n",
			author,
			files: [{ path: "t.txt", content: "t\n" }],
		});
		await git.annotatedTag({
			...parent,
			ref: "v1",
			object: head,
			tagger: author,
			message: "release\n",
		});
		const tagOid = await git.resolveRef({ ...parent, ref: "refs/tags/v1" });

		await copyMissingObjects(parent, fork, tagOid, generous);

		const tag = await git.readTag({ ...fork, oid: tagOid });
		expect(tag.tag.object).toBe(head);
		expect((await git.readCommit({ ...fork, oid: head })).oid).toBe(head);
	});

	describe("haves", () => {
		it("rejects a have the destination does not hold, writing nothing", async () => {
			const { parent, fork } = makePair();
			await initBare(parent);
			await initBare(fork);
			const head = await commitFilesToBare(parent, {
				branch: "main",
				message: "one\n",
				author,
				files: [{ path: "a.txt", content: "a\n" }],
			});
			const before = await packFiles(fork);

			await expect(
				copyMissingObjects(parent, fork, head, {
					...generous,
					haves: [head],
				}),
			).rejects.toThrow(/is not a commit in the destination/);
			await expect(git.readCommit({ ...fork, oid: head })).rejects.toThrow();
			expect(await packFiles(fork)).toEqual(before);
		});

		it("rejects a have that names a non-commit object", async () => {
			const { parent, fork } = makePair();
			await initBare(parent);
			await initBare(fork);
			const head = await commitFilesToBare(parent, {
				branch: "main",
				message: "one\n",
				author,
				files: [{ path: "a.txt", content: "a\n" }],
			});
			await copyMissingObjects(parent, fork, head, generous);
			const { commit } = await git.readCommit({ ...fork, oid: head });
			await expect(
				copyMissingObjects(parent, fork, head, {
					...generous,
					haves: [commit.tree],
				}),
			).rejects.toThrow(/is not a commit in the destination/);
		});

		it("does not read a have commit from the source", async () => {
			const { parent, fork } = makePair();
			await initBare(parent);
			await initBare(fork);
			const base = await commitFilesToBare(parent, {
				branch: "main",
				message: "base\n",
				author,
				files: [{ path: "a.txt", content: "a\n" }],
			});
			await copyMissingObjects(parent, fork, base, generous);
			const next = await commitFilesToBare(parent, {
				branch: "main",
				message: "next\n",
				author,
				files: [{ path: "a.txt", content: "b\n" }],
			});

			const readObject = vi.spyOn(git, "readObject");
			try {
				const result = await copyMissingObjects(parent, fork, next, {
					...generous,
					haves: [base],
				});
				expect(result.objects).toBe(3);
				const read = readObject.mock.calls.map(
					([args]) => (args as { oid: string }).oid,
				);
				expect(read).not.toContain(base);
			} finally {
				readObject.mockRestore();
			}
			const { blob } = await git.readBlob({
				...fork,
				oid: next,
				filepath: "a.txt",
			});
			expect(new TextDecoder().decode(blob)).toBe("b\n");
		});
	});

	describe("failures", () => {
		it("fails cleanly when the source is missing an object its history names", async () => {
			const { parent, fork } = makePair();
			await initBare(parent);
			await initBare(fork);
			const ghostBlob = "e".repeat(40);
			const tree = await git.writeTree({
				...parent,
				tree: [
					{ path: "ghost.txt", mode: "100644", type: "blob", oid: ghostBlob },
				],
			});
			const head = await git.writeCommit({
				...parent,
				commit: {
					message: "dangling\n",
					tree,
					parent: [],
					author,
					committer: author,
				},
			});

			await expect(
				copyMissingObjects(parent, fork, head, generous),
			).rejects.toThrow();
			expect(await packFiles(fork)).toEqual([]);
			await expect(git.readCommit({ ...fork, oid: head })).rejects.toThrow();
		});

		it("writes nothing when a source read fails partway through", async () => {
			const { parent, fork } = makePair();
			await initBare(parent);
			await initBare(fork);
			const head = await commitFilesToBare(parent, {
				branch: "main",
				message: "two\n",
				author,
				files: [
					{ path: "a.txt", content: "a\n" },
					{ path: "b.txt", content: "b\n" },
				],
			});
			const { commit } = await git.readCommit({ ...parent, oid: head });
			const realReadObject = git.readObject;
			const spy = vi
				.spyOn(git, "readObject")
				.mockImplementation((args) =>
					args.oid === commit.tree
						? Promise.reject(new Error("storage read failed"))
						: realReadObject(args),
				);
			try {
				await expect(
					copyMissingObjects(parent, fork, head, generous),
				).rejects.toThrow("storage read failed");
			} finally {
				spy.mockRestore();
			}
			expect(await packFiles(fork)).toEqual([]);
			await expect(git.readCommit({ ...fork, oid: head })).rejects.toThrow();
		});

		it("writes nothing when the destination fails mid-write", async () => {
			const { parent, fork } = makePair();
			await initBare(parent);
			await initBare(fork);
			const head = await commitFilesToBare(parent, {
				branch: "main",
				message: "two\n",
				author,
				files: [
					{ path: "a.txt", content: "a\n" },
					{ path: "b.txt", content: "b\n" },
				],
			});
			const realWriteObject = git.writeObject;
			let calls = 0;
			const spy = vi.spyOn(git, "writeObject").mockImplementation((args) => {
				calls++;
				if (calls === 2) return Promise.reject(new Error("disk full"));
				return realWriteObject(args);
			});
			try {
				await expect(
					copyMissingObjects(parent, fork, head, generous),
				).rejects.toThrow("disk full");
			} finally {
				spy.mockRestore();
			}
			expect(calls).toBeGreaterThanOrEqual(2);
			expect(await packFiles(fork)).toEqual([]);
			await expect(git.readCommit({ ...fork, oid: head })).rejects.toThrow();
		});

		it("a failure after the pack is written but before its index leaves nothing visible, and a retry completes", async () => {
			const { parent, fork } = makePair();
			await initBare(parent);
			await initBare(fork);
			const head = await commitFilesToBare(parent, {
				branch: "main",
				message: "flush\n",
				author,
				files: [
					{ path: "a.txt", content: "a\n" },
					{ path: "b.txt", content: "b\n" },
				],
			});
			const spy = vi
				.spyOn(git, "indexPack")
				.mockRejectedValueOnce(new Error("index write failed"));
			try {
				await expect(
					copyMissingObjects(parent, fork, head, generous),
				).rejects.toThrow("index write failed");
			} finally {
				spy.mockRestore();
			}

			// The pack reached storage; its index did not, so no reader lists it.
			const names = await rawFs(fork)
				.readdir(`${fork.gitdir}/objects/pack`)
				.catch(() => [] as string[]);
			expect(names.some((name) => name.endsWith(".pack"))).toBe(true);
			expect(names.some((name) => name.endsWith(".idx"))).toBe(false);
			await expect(git.readCommit({ ...fork, oid: head })).rejects.toThrow();

			await copyMissingObjects(parent, fork, head, generous);
			const { blob } = await git.readBlob({
				...fork,
				oid: head,
				filepath: "b.txt",
			});
			expect(new TextDecoder().decode(blob)).toBe("b\n");
		});

		it("bounds loose source objects, which the pack index cannot size", async () => {
			const { parent, fork } = makePair();
			await initBare(parent);
			await initBare(fork);
			// Loose objects: written with plumbing, not packed writes.
			const blob = await git.writeBlob({
				...parent,
				blob: new TextEncoder().encode("y".repeat(5000)),
			});
			const tree = await git.writeTree({
				...parent,
				tree: [{ path: "loose.txt", mode: "100644", type: "blob", oid: blob }],
			});
			const head = await git.writeCommit({
				...parent,
				commit: {
					message: "loose\n",
					tree,
					parent: [],
					author,
					committer: author,
				},
			});

			await expect(
				copyMissingObjects(parent, fork, head, {
					maxObjects: 100,
					maxBytes: 1000,
				}),
			).rejects.toMatchObject({ metric: "bytes" });
			expect(await packFiles(fork)).toEqual([]);

			const ok = await copyMissingObjects(parent, fork, head, generous);
			expect(ok.objects).toBe(3);
			const { blob: copied } = await git.readBlob({
				...fork,
				oid: head,
				filepath: "loose.txt",
			});
			expect(copied.length).toBe(5000);
		});
	});
});
