import git from "isomorphic-git";
import { describe, expect, it } from "vitest";
import { pktLine } from "../../src/http/pkt-line.js";
import { repackRepository } from "../../src/http/repack.js";
import { rawFs } from "../../src/http/types.js";
import { handleUploadPack } from "../../src/http/upload-pack.js";
import { copyPrefix, createGitFs, MemoryObjectStore } from "../../src/index.js";
import {
	authorNow,
	commitFilesToBare,
	type Repo,
	withPackedWrites,
} from "../../src/ops/index.js";
import { parsePackDirectory } from "../../src/pack-files.js";
import { writeDeltaAgainstPrOnlyBlob } from "../support/packs.js";

const author = authorNow("Test", "test@example.com");

function makeRepo(): Repo {
	const fs = createGitFs(new MemoryObjectStore());
	return { fs, gitdir: "git", cache: {} };
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

function decodeSideBandPackfile(buf: Uint8Array): Uint8Array {
	const chunks: Uint8Array[] = [];
	let pos = 0;
	let total = 0;
	while (pos + 4 <= buf.length) {
		const len = Number.parseInt(
			new TextDecoder().decode(buf.subarray(pos, pos + 4)),
			16,
		);
		if (len === 0) {
			pos += 4;
			break;
		}
		const band = buf[pos + 4];
		if (band !== 1) throw new Error(`unexpected side-band marker ${band}`);
		const chunk = buf.subarray(pos + 5, pos + len);
		chunks.push(chunk);
		total += chunk.length;
		pos += len;
	}
	const out = new Uint8Array(total);
	let offset = 0;
	for (const c of chunks) {
		out.set(c, offset);
		offset += c.length;
	}
	return out;
}

/**
 * Simulate a real clone: index the served pack into a fresh empty repo, then
 * write the local ref the way a real client does from the ref advertisement
 * (indexing a pack alone doesn't touch refs).
 */
async function cloneInto(target: Repo, packfile: Uint8Array, headOid: string) {
	await git.init({
		...target,
		dir: target.gitdir,
		bare: true,
		defaultBranch: "main",
	});
	const packDir = `${target.gitdir}/objects/pack`;
	const fsp = rawFs(target);
	await fsp.mkdir(packDir, { recursive: true });
	await fsp.writeFile(`${packDir}/clone.pack`, packfile);
	await git.indexPack({ ...target, dir: packDir, filepath: "clone.pack" });
	await git.writeRef({
		...target,
		ref: "refs/heads/main",
		value: headOid,
		force: true,
	});
}

describe("handleUploadPack", () => {
	it("returns a bare NAK when there are no wants", async () => {
		const repo = makeRepo();
		await seed(repo, 1);
		const result = await handleUploadPack(
			repo,
			new TextEncoder().encode("0000"),
		);
		expect(result.status).toBe(200);
		expect(new TextDecoder().decode(result.body)).toBe(pktLineDecoded("NAK\n"));
	});

	it("serves a full clone pack via the general reachability-walk path", async () => {
		const repo = makeRepo();
		await seed(repo, 3);
		const headOid = await git.resolveRef({ ...repo, ref: "refs/heads/main" });

		const body = concatBuffers(
			pktLine(`want ${headOid} side-band-64k\n`),
			new TextEncoder().encode("0000"),
			pktLine("done\n"),
		);
		const result = await handleUploadPack(repo, body);
		expect(result.status).toBe(200);

		const nakLen = 4;
		const nak = new TextDecoder().decode(result.body.subarray(4, nakLen + 4));
		expect(nak).toBe("NAK\n");
		const packfile = decodeSideBandPackfile(result.body.subarray(8));
		expect(new TextDecoder().decode(packfile.subarray(0, 4))).toBe("PACK");

		const clone = makeRepo();
		await cloneInto(clone, packfile, headOid);
		const log = await git.log({ ...clone, ref: "main" });
		expect(log.length).toBe(3);
		expect(log[0]?.commit.message).toBe("commit 2\n");
	});

	it("serves the consolidated pack directly on a fresh clone (single-pack fast path)", async () => {
		const repo = makeRepo();
		await seed(repo, 3);
		// Force down to exactly one pack so the fast path (readdir sees a
		// single .pack file) is what actually serves this request.
		await repackRepository(repo, { threshold: 1 });

		const headOid = await git.resolveRef({ ...repo, ref: "refs/heads/main" });
		const body = concatBuffers(
			pktLine(`want ${headOid} side-band-64k\n`),
			new TextEncoder().encode("0000"),
			pktLine("done\n"),
		);
		const result = await handleUploadPack(repo, body);
		const packfile = decodeSideBandPackfile(result.body.subarray(8));

		const clone = makeRepo();
		await cloneInto(clone, packfile, headOid);
		const log = await git.log({ ...clone, ref: "main" });
		expect(log.length).toBe(3);
	});

	it("serves only objects the client lacks on an incremental fetch", async () => {
		const repo = makeRepo();
		await seed(repo, 3);
		const [head, parent] = await git.log({ ...repo, ref: "main", depth: 2 });
		if (!head || !parent) throw new Error("seed failed");

		const body = concatBuffers(
			pktLine(`want ${head.oid} side-band-64k\n`),
			new TextEncoder().encode("0000"),
			pktLine(`have ${parent.oid}\n`),
			pktLine("done\n"),
		);
		const result = await handleUploadPack(repo, body);
		expect(result.status).toBe(200);
		const text = new TextDecoder().decode(result.body);
		const packStart = text.indexOf("PACK");
		expect(packStart).toBeGreaterThan(0);
		const packfile = decodeSideBandPackfile(
			result.body.subarray(text.lastIndexOf("\n", packStart) + 1),
		);
		// Header: "PACK", version, object count (big-endian u32).
		const count = new DataView(
			packfile.buffer,
			packfile.byteOffset + 8,
			4,
		).getUint32(0);
		expect(count).toBe(3);
	});

	it("returns a bare NAK (no pack) when haves are sent without done", async () => {
		const repo = makeRepo();
		await seed(repo, 1);
		const headOid = await git.resolveRef({ ...repo, ref: "refs/heads/main" });

		const body = concatBuffers(
			pktLine(`want ${headOid} side-band-64k\n`),
			new TextEncoder().encode("0000"),
			pktLine(`have ${"a".repeat(40)}\n`),
			new TextEncoder().encode("0000"),
		);
		const result = await handleUploadPack(repo, body);
		expect(result.body.length).toBe(8);
	});
});

function pktLineDecoded(s: string): string {
	return new TextDecoder().decode(pktLine(s));
}

function concatBuffers(...parts: Uint8Array[]): Uint8Array {
	let total = 0;
	for (const p of parts) total += p.length;
	const out = new Uint8Array(total);
	let offset = 0;
	for (const p of parts) {
		out.set(p, offset);
		offset += p.length;
	}
	return out;
}

function cloneRequest(wantOid: string, caps = " side-band-64k") {
	return concatBuffers(
		pktLine(`want ${wantOid}${caps}\n`),
		new TextEncoder().encode("0000"),
		pktLine("done\n"),
	);
}

async function looseCommit(repo: Repo, message: string): Promise<string> {
	const parent = await git.resolveRef({ ...repo, ref: "refs/heads/main" });
	const blob = await git.writeBlob({
		...repo,
		blob: new TextEncoder().encode(`${message}\n`),
	});
	const tree = await git.writeTree({
		...repo,
		tree: [{ path: "loose.txt", mode: "100644", type: "blob", oid: blob }],
	});
	const oid = await git.writeCommit({
		...repo,
		commit: {
			message: `${message}\n`,
			tree,
			parent: [parent],
			author,
			committer: author,
		},
	});
	await git.writeRef({
		...repo,
		ref: "refs/heads/main",
		value: oid,
		force: true,
	});
	return oid;
}

describe("handleUploadPack — negotiation reply", () => {
	function fetchRequest(wantOid: string, haves: string[]) {
		return concatBuffers(
			pktLine(`want ${wantOid} side-band-64k\n`),
			new TextEncoder().encode("0000"),
			...haves.map((oid) => pktLine(`have ${oid}\n`)),
			pktLine("done\n"),
		);
	}
	const firstPktLine = (body: Uint8Array) =>
		new TextDecoder().decode(
			body.subarray(
				4,
				Number.parseInt(new TextDecoder().decode(body.subarray(0, 4)), 16),
			),
		);

	it("ACKs the first have the server shares, so git doesn't warn 'no common commits'", async () => {
		const repo = makeRepo();
		await seed(repo, 2);
		const [newer, older] = (await git.log({ ...repo, ref: "main" })).map(
			(entry) => entry.oid,
		) as [string, string];
		const unknown = "1".repeat(40);

		const result = await handleUploadPack(
			repo,
			fetchRequest(newer, [unknown, older]),
		);

		expect(result.status).toBe(200);
		expect(firstPktLine(result.body)).toBe(`ACK ${older}\n`);
	});

	it("NAKs when none of the client's haves are known", async () => {
		const repo = makeRepo();
		await seed(repo, 1);
		const head = await git.resolveRef({ ...repo, ref: "refs/heads/main" });

		const result = await handleUploadPack(
			repo,
			fetchRequest(head, ["1".repeat(40)]),
		);

		expect(firstPktLine(result.body)).toBe("NAK\n");
	});
});

describe("handleUploadPack — edge cases", () => {
	it("doesn't serve the single pack verbatim when loose objects exist", async () => {
		const repo = makeRepo();
		await seed(repo, 2);
		await repackRepository(repo, { threshold: 1 });
		const headOid = await looseCommit(repo, "loose after repack");

		const result = await handleUploadPack(repo, cloneRequest(headOid));
		const packfile = decodeSideBandPackfile(result.body.subarray(8));
		const clone = makeRepo();
		await cloneInto(clone, packfile, headOid);
		const log = await git.log({ ...clone, ref: "main" });
		expect(log.map((c) => c.commit.message)).toEqual([
			"loose after repack\n",
			"commit 1\n",
			"commit 0\n",
		]);
	});

	it("refuses a want that no ref reaches", async () => {
		const repo = makeRepo();
		await seed(repo, 1);
		const orphan = await git.writeCommit({
			...repo,
			commit: {
				message: "orphan\n",
				tree: (
					await git.readCommit({
						...repo,
						oid: await git.resolveRef({ ...repo, ref: "refs/heads/main" }),
					})
				).commit.tree,
				parent: [],
				author,
				committer: author,
			},
		});
		const result = await handleUploadPack(repo, cloneRequest(orphan));
		expect(new TextDecoder().decode(result.body)).toContain(
			`ERR upload-pack: not our ref ${orphan}`,
		);
	});

	it("serves a want that's an ancestor of a ref tip", async () => {
		const repo = makeRepo();
		await seed(repo, 3);
		const [, parent] = await git.log({ ...repo, ref: "main", depth: 2 });
		if (!parent) throw new Error("seed failed");
		const result = await handleUploadPack(repo, cloneRequest(parent.oid));
		expect(new TextDecoder().decode(result.body)).not.toContain("ERR");
	});

	it("rejects a malformed object id instead of reading it as a path", async () => {
		const repo = makeRepo();
		await seed(repo, 1);
		const result = await handleUploadPack(
			repo,
			cloneRequest("aa/../../../../other/repo/git/objects/zz", ""),
		);
		expect(new TextDecoder().decode(result.body)).toContain("ERR");
	});

	it("sends the raw pack when the client didn't ask for side-band", async () => {
		const repo = makeRepo();
		await seed(repo, 1);
		const headOid = await git.resolveRef({ ...repo, ref: "refs/heads/main" });
		const result = await handleUploadPack(repo, cloneRequest(headOid, ""));
		expect(new TextDecoder().decode(result.body.subarray(8, 12))).toBe("PACK");
	});

	it("fetches onto diverged history: the result has everything the client lacks", async () => {
		const repo = makeRepo();
		await seed(repo, 2);
		const base = await git.resolveRef({ ...repo, ref: "refs/heads/main" });
		await commitFilesToBare(repo, {
			branch: "main",
			message: "nested\n",
			author,
			files: [{ path: "dir/sub/a.txt", content: "a\n" }],
		});
		const head = await commitFilesToBare(repo, {
			branch: "main",
			message: "more\n",
			author,
			files: [{ path: "dir/b.txt", content: "b\n" }],
		});

		const clone = makeRepo();
		const first = await handleUploadPack(repo, cloneRequest(base));
		await cloneInto(
			clone,
			decodeSideBandPackfile(first.body.subarray(8)),
			base,
		);
		const body = concatBuffers(
			pktLine(`want ${head} side-band-64k\n`),
			new TextEncoder().encode("0000"),
			pktLine(`have ${base}\n`),
			pktLine("done\n"),
		);
		const fetched = await handleUploadPack(repo, body);
		const ackLength = Number.parseInt(
			new TextDecoder().decode(fetched.body.subarray(0, 4)),
			16,
		);
		expect(new TextDecoder().decode(fetched.body.subarray(4, ackLength))).toBe(
			`ACK ${base}\n`,
		);
		const pack = decodeSideBandPackfile(fetched.body.subarray(ackLength));
		const packDir = `${clone.gitdir}/objects/pack`;
		await rawFs(clone).writeFile(`${packDir}/fetch.pack`, pack);
		await git.indexPack({ ...clone, dir: packDir, filepath: "fetch.pack" });
		await git.writeRef({
			...clone,
			ref: "refs/heads/main",
			value: head,
			force: true,
		});

		const { blob } = await git.readBlob({
			...clone,
			oid: head,
			filepath: "dir/sub/a.txt",
		});
		expect(new TextDecoder().decode(blob)).toBe("a\n");
		const log = await git.log({ ...clone, ref: "main" });
		expect(log).toHaveLength(4);
	});
});

/** The object ids a served pack would hand a client, as the client indexes them. */
async function servedOids(packfile: Uint8Array): Promise<string[]> {
	const scratch = makeRepo();
	await git.init({
		...scratch,
		dir: scratch.gitdir,
		bare: true,
		defaultBranch: "main",
	});
	const packDir = `${scratch.gitdir}/objects/pack`;
	await rawFs(scratch).writeFile(`${packDir}/served.pack`, packfile);
	const { oids } = await git.indexPack({
		...scratch,
		dir: packDir,
		filepath: "served.pack",
	});
	return oids;
}

/** A response body with its leading ACK/NAK pkt-line removed, then the framed pack. */
function packOfResponse(body: Uint8Array): Uint8Array {
	const headLen = Number.parseInt(
		new TextDecoder().decode(body.subarray(0, 4)),
		16,
	);
	return decodeSideBandPackfile(body.subarray(headLen));
}

describe("handleUploadPack and pull request heads", () => {
	/**
	 * main with two commits, plus a commit only `refs/pull/7/head` names, then
	 * consolidated by a repack that keeps the pull head as a root.
	 */
	async function repoWithPrOnlyObjects() {
		const repo = makeRepo();
		await seed(repo, 2);
		const seedHead = await git.resolveRef({ ...repo, ref: "refs/heads/main" });
		const seedHeadCommit = await git.readCommit({ ...repo, oid: seedHead });
		const mainFirst = seedHeadCommit.commit.parent[0] as string;
		const prTip = await commitFilesToBare(repo, {
			branch: "topic",
			message: "secret pr\n",
			author,
			files: [{ path: "pr-secret.txt", content: "secret\n" }],
		});
		await git.writeRef({ ...repo, ref: "refs/pull/7/head", value: prTip });
		await git.deleteRef({ ...repo, ref: "refs/heads/topic" });
		await repackRepository(repo, { threshold: 2 });

		const prCommit = await git.readCommit({ ...repo, oid: prTip });
		const prTree = await git.readTree({ ...repo, oid: prCommit.commit.tree });
		const prBlob = prTree.tree.find((e) => e.path === "pr-secret.txt")?.oid;
		if (prBlob === undefined) throw new Error("fixture: no PR blob");
		const prOnly = [prTip, prCommit.commit.tree, prBlob];
		const mainHead = await git.resolveRef({ ...repo, ref: "refs/heads/main" });
		return { repo, mainFirst, mainHead, prOnly };
	}

	it("a fresh clone of main receives none of the pull-request-only objects", async () => {
		const { repo, mainHead, prOnly } = await repoWithPrOnlyObjects();

		const result = await handleUploadPack(repo, cloneRequest(mainHead));
		const oids = await servedOids(packOfResponse(result.body));

		expect(oids).toContain(mainHead);
		for (const oid of prOnly) expect(oids).not.toContain(oid);
	});

	it("a fetch from a client with main's first commit receives none either", async () => {
		const { repo, mainFirst, mainHead, prOnly } = await repoWithPrOnlyObjects();
		const body = concatBuffers(
			pktLine(`want ${mainHead} side-band-64k\n`),
			new TextEncoder().encode("0000"),
			pktLine(`have ${mainFirst}\n`),
			pktLine("done\n"),
		);

		const result = await handleUploadPack(repo, body);
		const oids = await servedOids(packOfResponse(result.body));

		expect(oids).toContain(mainHead);
		for (const oid of prOnly) expect(oids).not.toContain(oid);
	});
});

describe("handleUploadPack guards for pull request objects", () => {
	it("a fresh clone of a fork (a copy of its parent's storage) receives no PR-only objects", async () => {
		const store = new MemoryObjectStore();
		const parent: Repo = {
			fs: createGitFs(store),
			gitdir: "repos/alice/parent/git",
			cache: {},
		};
		const { mainHead, prHead, baseBlob } = await writeDeltaAgainstPrOnlyBlob(
			parent,
			7,
		);
		// The fork's storage is a prefix copy of the parent's, pull refs included.
		await copyPrefix(store, "repos/alice/parent/git/", "repos/bob/fork/git/");
		const fork: Repo = {
			fs: createGitFs(store),
			gitdir: "repos/bob/fork/git",
			cache: {},
		};
		expect(await git.resolveRef({ ...fork, ref: "refs/pull/7/head" })).toBe(
			prHead,
		);

		const result = await handleUploadPack(fork, cloneRequest(mainHead));
		const oids = await servedOids(packOfResponse(result.body));

		expect(oids).toContain(mainHead);
		expect(oids).not.toContain(prHead);
		expect(oids).not.toContain(baseBlob);
	});

	it("does not serve a single kept pack verbatim, since it can hold objects no ref names yet", async () => {
		const repo = makeRepo();
		await git.init({
			...repo,
			dir: repo.gitdir,
			bare: true,
			defaultBranch: "main",
		});
		const keepUntil = new Date(Date.now() + 86_400_000);
		const { head, orphan } = await withPackedWrites(
			repo,
			async (packed) => {
				const orphan = await git.writeBlob({
					...packed,
					blob: new TextEncoder().encode("written by the API, no ref yet\n"),
				});
				const blob = await git.writeBlob({
					...packed,
					blob: new TextEncoder().encode("main\n"),
				});
				const tree = await git.writeTree({
					...packed,
					tree: [{ path: "a.txt", mode: "100644", type: "blob", oid: blob }],
				});
				const head = await git.writeCommit({
					...packed,
					commit: {
						message: "main\n",
						tree,
						parent: [],
						author,
						committer: author,
					},
				});
				return { head, orphan };
			},
			{ keepUntil },
		);
		await git.writeRef({
			...repo,
			ref: "refs/heads/main",
			value: head,
			force: true,
		});

		// The shape the fast path would take: one pack, and it is kept.
		const names = await rawFs(repo).readdir(`${repo.gitdir}/objects/pack`);
		expect(
			parsePackDirectory(names).filter((f) => f.kind === "pack"),
		).toHaveLength(1);
		expect(
			parsePackDirectory(names).filter((f) => f.kind === "keep"),
		).toHaveLength(1);

		const result = await handleUploadPack(repo, cloneRequest(head));
		const oids = await servedOids(packOfResponse(result.body));

		expect(oids).toContain(head);
		expect(oids).not.toContain(orphan);
	});

	it("reuses no delta whose base the request does not want, end to end", async () => {
		const repo = makeRepo();
		const { mainHead, prHead, baseBlob } = await writeDeltaAgainstPrOnlyBlob(
			repo,
			7,
		);

		const result = await handleUploadPack(repo, cloneRequest(mainHead));
		const oids = await servedOids(packOfResponse(result.body));

		expect(oids).toContain(mainHead);
		expect(oids).not.toContain(baseBlob);
		expect(oids).not.toContain(prHead);
	});
});
