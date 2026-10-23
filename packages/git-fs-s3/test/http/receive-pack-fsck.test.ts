import git from "isomorphic-git";
import { describe, expect, it } from "vitest";
import { treeEntryNameProblem } from "../../src/http/fsck.js";
import { pktLine } from "../../src/http/pkt-line.js";
import {
	applyReceivePack,
	parseReceivePackBody,
} from "../../src/http/receive-pack.js";
import { createGitFs, MemoryObjectStore } from "../../src/index.js";
import { authorNow, type Repo } from "../../src/ops/index.js";

const author = authorNow("Test", "test@example.com");
const ZERO_OID = "0".repeat(40);

function makeRepo(): Repo {
	return {
		fs: createGitFs(new MemoryObjectStore()),
		gitdir: "git",
		cache: {},
	};
}

const hex = (oid: string) =>
	Uint8Array.from(oid.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));

/** A raw tree with entries git itself would refuse to write. */
async function rawTree(
	repo: Repo,
	entries: { name: string; oid: string; mode?: string }[],
): Promise<string> {
	const parts: number[] = [];
	for (const entry of entries) {
		parts.push(
			...new TextEncoder().encode(`${entry.mode ?? "100644"} ${entry.name}\0`),
			...hex(entry.oid),
		);
	}
	return git.writeObject({
		...repo,
		type: "tree",
		format: "content",
		object: Uint8Array.from(parts),
	});
}

async function pushOf(names: string[], parent?: string) {
	const staging = makeRepo();
	await git.init({
		...staging,
		dir: staging.gitdir,
		bare: true,
		defaultBranch: "main",
	});
	const blob = await git.writeBlob({
		...staging,
		blob: new TextEncoder().encode("x\n"),
	});
	const tree = await rawTree(
		staging,
		names.map((name) => ({ name, oid: blob })),
	);
	const commit = await git.writeCommit({
		...staging,
		commit: {
			message: "m\n",
			tree,
			parent: parent ? [parent] : [],
			author,
			committer: author,
		},
	});
	const { packfile } = await git.packObjects({
		...staging,
		oids: [blob, tree, commit],
	});
	const line = pktLine(`${ZERO_OID} ${commit} refs/heads/main\n`);
	const pack = packfile ?? new Uint8Array();
	const body = new Uint8Array(line.length + 4 + pack.length);
	body.set(line, 0);
	body.set(new TextEncoder().encode("0000"), line.length);
	body.set(pack, line.length + 4);
	return { body, commit };
}

describe("treeEntryNameProblem", () => {
	it.each([
		["", "emptyName"],
		[".", "hasDot"],
		["..", "hasDotdot"],
		["a/b", "fullPathname"],
		[".git", "hasDotgit"],
		[".GIT", "hasDotgit"],
		[".Git", "hasDotgit"],
		[".git.", "hasDotgit"],
		[".git ", "hasDotgit"],
		[".git. . ", "hasDotgit"],
		[".git::$INDEX_ALLOCATION", "hasDotgit"],
		["git~1", "hasDotgit"],
		["GIT~1", "hasDotgit"],
		[".g‌it", "hasDotgit"],
		[".﻿git", "hasDotgit"],
		["a\\b", "hasBackslash"],
	])("rejects %j as %s", (name, id) => {
		expect(treeEntryNameProblem(name)?.id).toBe(id);
	});

	it.each([
		"README.md",
		".gitignore",
		".github",
		".gitmodules",
		"git",
		"git~2",
		"..a",
		"a..",
		"my.git",
		".git-x",
	])("allows %j", (name) => {
		expect(treeEntryNameProblem(name)).toBeNull();
	});
});

describe("receive-pack tree entry names", () => {
	it.each([
		["..", "hasDotdot"],
		[".", "hasDot"],
		[".git", "hasDotgit"],
		["GIT~1", "hasDotgit"],
		["a/b", "fullPathname"],
		["", "emptyName"],
	])("refuses a pushed tree with an entry named %j", async (name, id) => {
		const repo = makeRepo();
		const { body } = await pushOf(["ok.txt", name]);
		const { results, unpackError } = await applyReceivePack(
			repo,
			parseReceivePackBody(body),
			{ defaultBranch: "main" },
		);
		expect(unpackError).toBeUndefined();
		expect(results[0]?.ok).toBe(false);
		expect(results[0]?.reason).toContain(`fsck error in packed object`);
		expect(results[0]?.reason).toContain(id);
		await expect(
			git.resolveRef({ ...repo, ref: "refs/heads/main" }),
		).rejects.toThrow();
		// No pack is left behind for a refused push.
		const packs = await repo.fs.promises
			.readdir("git/objects/pack")
			.catch(() => [] as string[]);
		expect(packs).toEqual([]);
	});

	it("accepts a tree of ordinary names", async () => {
		const repo = makeRepo();
		const { body, commit } = await pushOf([".gitignore", "README.md", "src"]);
		const { results } = await applyReceivePack(
			repo,
			parseReceivePackBody(body),
			{ defaultBranch: "main" },
		);
		expect(results[0]?.ok).toBe(true);
		expect(await git.resolveRef({ ...repo, ref: "refs/heads/main" })).toBe(
			commit,
		);
	});
});
