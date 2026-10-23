import git from "isomorphic-git";
import { describe, expect, it } from "vitest";
import { treeEntryNameProblem } from "../../src/http/fsck.js";
import { pktLine } from "../../src/http/pkt-line.js";
import {
	applyReceivePack,
	parseReceivePackBody,
} from "../../src/http/receive-pack.js";
import { rawFs } from "../../src/http/types.js";
import { createGitFs, MemoryObjectStore } from "../../src/index.js";
import { authorNow, type Repo } from "../../src/ops/index.js";
import { storePack } from "../../src/pack-write.js";

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
		[".git\\x", "hasDotgit"],
		[".git :stream", "hasDotgit"],
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
		"a\\b",
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
		const packs = await rawFs(repo)
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

/** Raw objects of a staging repo: blob, nested trees and a commit chain. */
async function stagingWith(): Promise<{ staging: Repo; blob: string }> {
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
	return { staging, blob };
}

async function commitOf(staging: Repo, tree: string, parent?: string) {
	return git.writeCommit({
		...staging,
		commit: {
			message: "m\n",
			tree,
			parent: parent ? [parent] : [],
			author,
			committer: author,
		},
	});
}

function pushBody(
	oldOid: string,
	newOid: string,
	packfile: Uint8Array | undefined,
) {
	const line = pktLine(`${oldOid} ${newOid} refs/heads/main\n`);
	const pack = packfile ?? new Uint8Array();
	const body = new Uint8Array(line.length + 4 + pack.length);
	body.set(line, 0);
	body.set(new TextEncoder().encode("0000"), line.length);
	body.set(pack, line.length + 4);
	return body;
}

async function push(repo: Repo, body: Uint8Array) {
	return applyReceivePack(repo, parseReceivePackBody(body), {
		defaultBranch: "main",
	});
}

describe("receive-pack tree entry names: only this push's trees", () => {
	it("accepts a clean push on top of a stored subtree that git would reject", async () => {
		const repo = makeRepo();
		const { staging, blob } = await stagingWith();
		// History a stricter or older server accepted: a subtree holding `.git`.
		const badSub = await rawTree(staging, [{ name: ".git", oid: blob }]);
		const root1 = await rawTree(staging, [
			{ name: "sub", oid: badSub, mode: "40000" },
		]);
		const c1 = await commitOf(staging, root1);
		const first = await git.packObjects({
			...staging,
			oids: [blob, badSub, root1, c1],
		});
		// Stored directly, bypassing the push checks.
		await storePack(repo, first.packfile ?? new Uint8Array());
		await git.writeRef({
			...repo,
			ref: "refs/heads/main",
			value: c1,
			force: true,
		});

		// A clean push adds a file next to the old subtree.
		const added = await git.writeBlob({
			...staging,
			blob: new TextEncoder().encode("new\n"),
		});
		const root2 = await rawTree(staging, [
			{ name: "new.txt", oid: added },
			{ name: "sub", oid: badSub, mode: "40000" },
		]);
		const c2 = await commitOf(staging, root2, c1);
		const second = await git.packObjects({
			...staging,
			oids: [added, root2, c2],
		});
		const { results } = await push(repo, pushBody(c1, c2, second.packfile));
		expect(results[0]?.reason).toBeUndefined();
		expect(results[0]?.ok).toBe(true);
		expect(await git.resolveRef({ ...repo, ref: "refs/heads/main" })).toBe(c2);
	});

	it.each([
		["an entry the parser reads (empty name)", ""],
		["an entry the parser refuses (.git)", ".git"],
	])("refuses a bad name in a nested subtree: %s", async (_label, name) => {
		const repo = makeRepo();
		const { staging, blob } = await stagingWith();
		const sub = await rawTree(staging, [{ name, oid: blob }]);
		const mid = await rawTree(staging, [
			{ name: "mid", oid: sub, mode: "40000" },
		]);
		const root = await rawTree(staging, [
			{ name: "top", oid: mid, mode: "40000" },
		]);
		const c = await commitOf(staging, root);
		const { packfile } = await git.packObjects({
			...staging,
			oids: [blob, sub, mid, root, c],
		});
		const { results } = await push(repo, pushBody(ZERO_OID, c, packfile));
		expect(results[0]?.ok).toBe(false);
		expect(results[0]?.reason).toContain("fsck error in packed object");
		expect(results[0]?.reason).toContain(`object ${sub}`);
	});

	it("refuses a bad name in a non-tip commit of a multi-commit push", async () => {
		const repo = makeRepo();
		const { staging, blob } = await stagingWith();
		const badRoot = await rawTree(staging, [{ name: "", oid: blob }]);
		const c1 = await commitOf(staging, badRoot);
		const cleanRoot = await rawTree(staging, [{ name: "ok.txt", oid: blob }]);
		const c2 = await commitOf(staging, cleanRoot, c1);
		const { packfile } = await git.packObjects({
			...staging,
			oids: [blob, badRoot, c1, cleanRoot, c2],
		});
		const { results } = await push(repo, pushBody(ZERO_OID, c2, packfile));
		expect(results[0]?.ok).toBe(false);
		expect(results[0]?.reason).toContain(`object ${badRoot}`);
		await expect(
			git.resolveRef({ ...repo, ref: "refs/heads/main" }),
		).rejects.toThrow();
	});

	it("refuses a pack whose bad tree no pushed ref reaches, so a second push cannot reference it", async () => {
		const repo = makeRepo();
		const { staging, blob } = await stagingWith();
		const badTree = await rawTree(staging, [{ name: "", oid: blob }]);
		const cleanRoot = await rawTree(staging, [{ name: "ok.txt", oid: blob }]);
		const c = await commitOf(staging, cleanRoot);
		const { packfile } = await git.packObjects({
			...staging,
			oids: [blob, badTree, cleanRoot, c],
		});
		const { results } = await push(repo, pushBody(ZERO_OID, c, packfile));
		expect(results[0]?.ok).toBe(false);
		expect(results[0]?.reason).toContain(`object ${badTree}`);
		const packs = await rawFs(repo)
			.readdir("git/objects/pack")
			.catch(() => [] as string[]);
		expect(packs).toEqual([]);
	});
});
