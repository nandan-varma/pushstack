/**
 * Copy the objects a commit needs from one repository into another, as one
 * pack. Used for cross-repository pull requests (the base stores the head
 * commit under `refs/pull/<n>/head`) and for syncing a fork from its parent.
 *
 * The walk starts at the commit and stops wherever the destination already
 * has the object: a fork shares its parent's history, so only the fork's own
 * commits and the trees and blobs they changed are copied. "Has" is a
 * destination existence check, which assumes the destination is complete
 * (every object it holds has its whole graph present) — true for any
 * repository this package writes, since pushes and packed writes never store
 * a partial graph.
 *
 * Everything is bounded before it is read: the object count and the inflated
 * bytes, checked against the sizes the pack index already knows before the
 * object is inflated, so a huge blob is refused without being loaded. Memory
 * stays within `maxBytes` plus one object.
 *
 * Takes no lock: the caller holds the destination's repository lock for the
 * write, and holds the source's where it needs a stable view of its packs.
 */
import git from "isomorphic-git";
import { decodeAscii, decodeUtf8, toHex } from "../edge-utils.js";
import { GitError } from "../git-errors.js";
import { getObjectSizes, getObjectTypes } from "../object-size.js";
import { hashGitObject, type PackObjectType } from "../pack-write.js";
import { withPackedWrites } from "./packed-writes.js";
import type { Repo } from "./types.js";

export type CopyLimitMetric = "objects" | "bytes";

/** The copy would exceed `maxObjects` or `maxBytes`; nothing was written. */
export class CopyLimitError extends GitError {
	constructor(
		readonly metric: CopyLimitMetric,
		readonly limit: number,
	) {
		super(
			`Too large to copy: more than ${limit} ${metric} are missing from the destination`,
			422,
		);
	}
}

export interface CopyMissingOptions {
	/**
	 * Commits the destination already has. The walk stops at them (their
	 * history is present there too), so they must really be in the destination.
	 */
	haves?: readonly string[];
	/** Refuse (with {@link CopyLimitError}) before copying more objects than this. */
	maxObjects: number;
	/** Refuse before copying more inflated bytes than this. */
	maxBytes: number;
}

export interface CopyMissingResult {
	/** Objects written into the destination (0 when it already had them all). */
	objects: number;
	/** Their inflated size in bytes. */
	bytes: number;
}

/** Objects per existence/size probe, bounding the probe maps. */
const PROBE_BATCH = 256;
/** Objects read from the source in flight at once. */
const READ_BATCH = 16;

interface CopiedObject {
	type: PackObjectType;
	content: Uint8Array<ArrayBuffer>;
}

const HEX_40 = /^[0-9a-f]{40}$/;

/** A commit's tree and parents, from its header (before the blank line). */
function commitLinks(content: Uint8Array): string[] {
	const text = decodeUtf8(content);
	const end = text.indexOf("\n\n");
	const header = end === -1 ? text : text.slice(0, end);
	const links: string[] = [];
	for (const line of header.split("\n")) {
		if (line.startsWith("tree ") || line.startsWith("parent ")) {
			links.push(line.slice(line.indexOf(" ") + 1));
		}
	}
	if (!links.every((oid) => HEX_40.test(oid))) {
		throw new Error("copyMissingObjects: malformed commit header");
	}
	return links;
}

/** A tree's entry oids. Gitlinks (submodule commits) live in another repository. */
function treeLinks(content: Uint8Array): string[] {
	const oids: string[] = [];
	let pos = 0;
	while (pos < content.length) {
		const space = content.indexOf(0x20, pos);
		const nul = space === -1 ? -1 : content.indexOf(0, space + 1);
		if (nul === -1 || nul + 21 > content.length) {
			throw new Error("copyMissingObjects: malformed tree");
		}
		const mode = decodeAscii(content.subarray(pos, space));
		if (mode !== "160000")
			oids.push(toHex(content.subarray(nul + 1, nul + 21)));
		pos = nul + 21;
	}
	return oids;
}

/** The oids an object points at (a tag's target, a commit's tree and parents, a tree's entries). */
function childrenOf(type: PackObjectType, content: Uint8Array): string[] {
	switch (type) {
		case "commit":
			return commitLinks(content);
		case "tree":
			return treeLinks(content);
		case "tag": {
			const newline = content.indexOf(0x0a);
			const first = decodeUtf8(
				newline === -1 ? content : content.subarray(0, newline),
			);
			const target = first.startsWith("object ") ? first.slice(7) : "";
			if (!HEX_40.test(target)) {
				throw new Error("copyMissingObjects: malformed tag header");
			}
			return [target];
		}
		case "blob":
			return [];
	}
}

/** Read `oid` from the source, checking its bytes hash to `oid` before trusting them. */
async function readVerified(src: Repo, oid: string): Promise<CopiedObject> {
	const { type, object } = await git.readObject({
		...src,
		oid,
		format: "content",
	});
	// Own ArrayBuffer-backed copy: the Web APIs used to hash it reject views
	// that might sit on a SharedArrayBuffer.
	const content = new Uint8Array(object as Uint8Array);
	const actual = await hashGitObject(type, content);
	if (actual !== oid) {
		throw new Error(
			`copyMissingObjects: object ${oid} failed SHA-1 verification (recomputed ${actual})`,
		);
	}
	return { type: type as PackObjectType, content };
}

function chunks<T>(items: readonly T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) {
		out.push(items.slice(i, i + size));
	}
	return out;
}

/**
 * Copy every object reachable from `headOid` in `src` that `dst` lacks, into
 * one pack in `dst`. The pack is flushed (pack, then its index) before this
 * resolves, so the caller may move a ref to `headOid` afterwards. Throws
 * {@link CopyLimitError} over either cap, and an error if `src` is missing an
 * object its own history names (a corrupt source is never partially copied).
 */
export async function copyMissingObjects(
	src: Repo,
	dst: Repo,
	headOid: string,
	options: CopyMissingOptions,
): Promise<CopyMissingResult> {
	const haves = new Set(options.haves ?? []);
	const seen = new Set<string>([headOid]);
	const copied = new Map<string, CopiedObject>();
	let bytes = 0;
	let frontier = haves.has(headOid) ? [] : [headOid];

	while (frontier.length > 0) {
		// Objects the destination already holds are not copied, and neither is
		// anything below them.
		const wanted: string[] = [];
		for (const batch of chunks(frontier, PROBE_BATCH)) {
			const types = await getObjectTypes(dst, batch);
			for (const oid of batch) {
				if (types.get(oid) === null) wanted.push(oid);
			}
		}
		if (copied.size + wanted.length > options.maxObjects) {
			throw new CopyLimitError("objects", options.maxObjects);
		}

		const next: string[] = [];
		for (const batch of chunks(wanted, PROBE_BATCH)) {
			// Known sizes are checked before anything is inflated.
			const sizes = await getObjectSizes(src, batch);
			let known = 0;
			for (const size of sizes.values()) known += size ?? 0;
			if (bytes + known > options.maxBytes) {
				throw new CopyLimitError("bytes", options.maxBytes);
			}
			for (const readBatch of chunks(batch, READ_BATCH)) {
				const objects = await Promise.all(
					readBatch.map((oid) => readVerified(src, oid)),
				);
				for (let i = 0; i < readBatch.length; i++) {
					const oid = readBatch[i] as string;
					const object = objects[i] as CopiedObject;
					bytes += object.content.length;
					if (bytes > options.maxBytes) {
						throw new CopyLimitError("bytes", options.maxBytes);
					}
					copied.set(oid, object);
					for (const child of childrenOf(object.type, object.content)) {
						if (haves.has(child) || seen.has(child)) continue;
						seen.add(child);
						next.push(child);
					}
				}
			}
		}
		frontier = next;
	}

	if (copied.size === 0) return { objects: 0, bytes: 0 };

	await withPackedWrites(dst, async (packed) => {
		for (const [oid, object] of copied) {
			const written = await git.writeObject({
				...packed,
				type: object.type,
				object: object.content,
				format: "content",
			});
			if (written !== oid) {
				throw new Error(
					`copyMissingObjects: wrote ${written} for ${oid} (object bytes changed)`,
				);
			}
		}
	});
	return { objects: copied.size, bytes };
}
