import git from "isomorphic-git";
import { describe, expect, it, vi } from "vitest";
import { findInvalidTree } from "../../src/http/fsck.js";
import { createGitFs, MemoryObjectStore } from "../../src/index.js";
import type { Repo } from "../../src/ops/index.js";
import { storePack } from "../../src/pack-write.js";

// `unknownTypes` makes every header answer null (a deep delta chain, say). The
// real header reader runs otherwise, so the in-memory pack is what supplies types.
const mode = vi.hoisted(() => ({ unknownTypes: false }));
vi.mock("../../src/object-size.js", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../src/object-size.js")>();
	return {
		...actual,
		getObjectTypes: async (repo: Repo, oids: readonly string[]) => {
			if (!mode.unknownTypes) return actual.getObjectTypes(repo, oids);
			return new Map(oids.map((oid) => [oid, null]));
		},
	};
});

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
	it.each([
		{ inMemory: false, unknownTypes: true },
		{ inMemory: false, unknownTypes: false },
		{ inMemory: true, unknownTypes: false },
	])(
		"still checks trees (in-memory pack: $inMemory, unknown types: $unknownTypes)",
		async ({ inMemory, unknownTypes }) => {
			mode.unknownTypes = unknownTypes;
			try {
				// The objects are written to `source` and packed; `target` only has the
				// pack when the test stores it there, so the in-memory variant can be
				// answered solely from the incoming bytes.
				const source = makeRepo();
				const blob = await git.writeBlob({
					...source,
					blob: new TextEncoder().encode("x\n"),
				});
				const entry = (name: string) =>
					Uint8Array.from([
						...new TextEncoder().encode(`100644 ${name}\0`),
						...hex(blob),
					]);
				const good = await git.writeObject({
					...source,
					type: "tree",
					format: "content",
					object: entry("ok.txt"),
				});
				const bad = await git.writeObject({
					...source,
					type: "tree",
					format: "content",
					object: entry(""),
				});
				const { packfile } = await git.packObjects({
					...source,
					oids: [blob, good, bad],
				});
				if (!packfile) throw new Error("missing test pack");

				const target = makeRepo();
				const stored = await storePack(
					inMemory ? makeRepo() : target,
					packfile,
				);
				const view = inMemory
					? { base: stored.base, pack: packfile, index: stored.index }
					: undefined;
				expect(await findInvalidTree(target, [blob, good], view)).toBeNull();
				expect(
					await findInvalidTree(target, [blob, good, bad], view),
				).toContain(`object ${bad}: emptyName`);
			} finally {
				mode.unknownTypes = false;
			}
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
