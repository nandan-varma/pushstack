import git from "isomorphic-git";
import { describe, expect, it, vi } from "vitest";
import { findInvalidTree } from "../../src/http/fsck.js";
import { createGitFs, MemoryObjectStore } from "../../src/index.js";
import type { Repo } from "../../src/ops/index.js";

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
	it("still checks them: a bad tree is found, a blob and a good tree pass", async () => {
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
		expect(await findInvalidTree(repo, [blob, good])).toBeNull();
		expect(await findInvalidTree(repo, [blob, good, bad])).toContain(
			`object ${bad}: emptyName`,
		);
	});

	it("rejects an object it cannot read", async () => {
		const missing = "ab".repeat(20);
		expect(await findInvalidTree(makeRepo(), [missing])).toBe(
			`object ${missing}: unreadable object`,
		);
	});
});
