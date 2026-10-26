/**
 * Hand-built packfiles for tests that need a pack shape the library never
 * writes itself: a REF_DELTA entry whose base is stored elsewhere in the same
 * pack. Real git writes these; the library only reuses them.
 */
import git from "isomorphic-git";
import {
	concat,
	deflate,
	encodeUtf8,
	fromHex,
	sha1,
} from "../../src/edge-utils.js";
import type { Repo } from "../../src/ops/types.js";
import {
	encodeEntryHeader,
	OBJ_BLOB,
	OBJ_COMMIT,
	OBJ_REF_DELTA,
	OBJ_TREE,
} from "../../src/pack-entry.js";
import { hashGitObject, storePack } from "../../src/pack-write.js";

export type PackEntry =
	| { kind: "whole"; type: "blob" | "tree" | "commit"; content: Uint8Array }
	| {
			/** Stored as a delta against `base`; `content` must start with `base`. */
			kind: "ref-delta";
			content: Uint8Array;
			base: Uint8Array;
			baseOid: string;
	  };

const TYPE_NUMBER = { blob: OBJ_BLOB, tree: OBJ_TREE, commit: OBJ_COMMIT };

function varint(value: number): number[] {
	const out: number[] = [];
	let rest = value;
	do {
		let byte = rest & 0x7f;
		rest = Math.floor(rest / 128);
		if (rest > 0) byte |= 0x80;
		out.push(byte);
	} while (rest > 0);
	return out;
}

/** A delta that copies all of `base` and inserts the rest of `target`. */
function prefixDelta(base: Uint8Array, target: Uint8Array): Uint8Array {
	for (let i = 0; i < base.length; i++) {
		if (base[i] !== target[i])
			throw new Error("fixture: target must extend base");
	}
	const out: number[] = [...varint(base.length), ...varint(target.length)];
	// Copy opcode, offset 0; size bytes present only where nonzero.
	let op = 0x80;
	const sizeBytes: number[] = [];
	for (let i = 0; i < 3; i++) {
		const byte = (base.length >>> (8 * i)) & 0xff;
		if (byte !== 0) {
			op |= 0x10 << i;
			sizeBytes.push(byte);
		}
	}
	out.push(op, ...sizeBytes);
	const rest = target.subarray(base.length);
	for (let i = 0; i < rest.length; i += 127) {
		const chunk = rest.subarray(i, i + 127);
		out.push(chunk.length, ...chunk);
	}
	return new Uint8Array(out);
}

/** A version-2 pack holding `entries` in order. */
export async function buildPack(entries: PackEntry[]): Promise<Uint8Array> {
	const header = new Uint8Array(12);
	header.set(encodeUtf8("PACK"), 0);
	const view = new DataView(header.buffer);
	view.setUint32(4, 2, false);
	view.setUint32(8, entries.length, false);
	const parts: Uint8Array[] = [header];
	for (const entry of entries) {
		if (entry.kind === "whole") {
			parts.push(
				encodeEntryHeader(TYPE_NUMBER[entry.type], entry.content.length),
				await deflate(new Uint8Array(entry.content)),
			);
		} else {
			const delta = prefixDelta(entry.base, entry.content);
			parts.push(
				encodeEntryHeader(OBJ_REF_DELTA, delta.length),
				fromHex(entry.baseOid),
				await deflate(new Uint8Array(delta)),
			);
		}
	}
	const body = concat(...parts);
	return concat(body, fromHex(await sha1(body)));
}

/**
 * Two commits in `repo`, with the packs and refs they need:
 *  - `main` (one commit) whose blob `a.txt` is `base + tail`, stored as a
 *    delta against the blob `pr.txt` that only the pull head commit names;
 *  - `refs/pull/<number>/head`, the commit whose tree holds the base blob.
 * Everything is in one pack, as a native push would leave it.
 */
export async function writeDeltaAgainstPrOnlyBlob(
	repo: Repo,
	pullNumber: number,
): Promise<{ mainHead: string; prHead: string; baseBlob: string }> {
	await git.init({
		...repo,
		dir: repo.gitdir,
		bare: true,
		defaultBranch: "main",
	});
	const base = encodeUtf8(
		"shared base content, long enough to delta\n".repeat(8),
	);
	const target = concat(base, encodeUtf8("tail that only main has\n"));
	const baseBlob = await hashGitObject("blob", base);
	const targetBlob = await hashGitObject("blob", target);

	const entryBytes = (mode: string, name: string, oid: string) =>
		concat(encodeUtf8(`${mode} ${name}\0`), fromHex(oid));
	const mainTreeBytes = entryBytes("100644", "a.txt", targetBlob);
	const prTreeBytes = entryBytes("100644", "pr.txt", baseBlob);
	const mainTree = await hashGitObject("tree", mainTreeBytes);
	const prTree = await hashGitObject("tree", prTreeBytes);

	const who = "Test <test@example.com> 1700000000 +0000";
	const commitText = (tree: string, message: string) =>
		encodeUtf8(`tree ${tree}\nauthor ${who}\ncommitter ${who}\n\n${message}\n`);
	const mainCommitBytes = commitText(mainTree, "main");
	const prCommitBytes = commitText(prTree, "pull request");
	const mainHead = await hashGitObject("commit", mainCommitBytes);
	const prHead = await hashGitObject("commit", prCommitBytes);

	const pack = await buildPack([
		{ kind: "whole", type: "blob", content: base },
		{ kind: "ref-delta", content: target, base, baseOid: baseBlob },
		{ kind: "whole", type: "tree", content: mainTreeBytes },
		{ kind: "whole", type: "tree", content: prTreeBytes },
		{ kind: "whole", type: "commit", content: mainCommitBytes },
		{ kind: "whole", type: "commit", content: prCommitBytes },
	]);
	await storePack(repo, pack);
	await git.writeRef({
		...repo,
		ref: "refs/heads/main",
		value: mainHead,
		force: true,
	});
	await git.writeRef({
		...repo,
		ref: `refs/pull/${pullNumber}/head`,
		value: prHead,
		force: true,
	});
	return { mainHead, prHead, baseBlob };
}
