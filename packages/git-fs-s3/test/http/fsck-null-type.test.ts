import git from "isomorphic-git";
import { describe, expect, it, vi } from "vitest";
import { findInvalidTree } from "../../src/http/fsck.js";
import { createGitFs, MemoryObjectStore } from "../../src/index.js";
import type { Repo } from "../../src/ops/index.js";
import { storePack } from "../../src/pack-write.js";

// Headers that cannot name a type (a deep delta chain, say): every object is null.
vi.mock("../../src/object-size.js", () => ({
	getObjectTypes: async (_repo: Repo, oids: readonly string[]) =>
		new Map(oids.map((oid) => [oid, null])),
}));

function makeRepo(): Repo {
	return {
		fs: createGitFs(new MemoryObjectStore()),
		gitdir: "git",
		cache: {},
	};
}

const hex = (oid: string) =>
	Uint8Array.from(oid.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));

describe("findInvalidTree with objects of unknown type", () => {
	it.each([false, true])(
		"still checks unknown types (in-memory pack: %s)",
		async (inMemory) => {
			const repo = makeRepo();
			const blob = await git.writeBlob({
				...repo,
				blob: new TextEncoder().encode("x\n"),
			});
			const entry = (name: string) =>
				Uint8Array.from([
					...new TextEncoder().encode(`100644 ${name}\0`),
					...hex(blob),
				]);
			const good = await git.writeObject({
				...repo,
				type: "tree",
				format: "content",
				object: entry("ok.txt"),
			});
			const bad = await git.writeObject({
				...repo,
				type: "tree",
				format: "content",
				object: entry(""),
			});
			const { packfile } = await git.packObjects({
				...repo,
				oids: [blob, good, bad],
			});
			if (!packfile) throw new Error("missing test pack");
			const stored = await storePack(repo, packfile);
			const packed = inMemory
				? { base: stored.base, pack: packfile, index: stored.index }
				: undefined;
			expect(await findInvalidTree(repo, [blob, good], packed)).toBeNull();
			expect(await findInvalidTree(repo, [blob, good, bad], packed)).toContain(
				`object ${bad}: emptyName`,
			);
		},
	);

	it("stops scheduling reads once the first bad tree is found", async () => {
		const read = vi.spyOn(git, "readObject").mockResolvedValue({
			type: "tree",
			object: [{ path: "" }],
			oid: "ab".repeat(20),
			format: "parsed",
		} as Awaited<ReturnType<typeof git.readObject>>);
		try {
			const oids = Array.from({ length: 40 }, (_, i) =>
				i.toString(16).padStart(40, "0"),
			);
			expect(await findInvalidTree(makeRepo(), oids)).toContain("emptyName");
			expect(read.mock.calls.length).toBeLessThanOrEqual(16);
		} finally {
			read.mockRestore();
		}
	});

	it("rejects an object it cannot read", async () => {
		const missing = "ab".repeat(20);
		expect(await findInvalidTree(makeRepo(), [missing])).toBe(
			`object ${missing}: unreadable object`,
		);
	});
});
