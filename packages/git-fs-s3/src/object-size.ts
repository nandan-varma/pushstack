/**
 * An object's size without reading (or inflating) the object.
 *
 * Why this exists: a git object's length lives in its pack entry, but the only
 * way isomorphic-git will hand you an object's bytes is by inflating the whole
 * thing — so "is this blob too large to render or diff" could only be asked
 * *after* loading it, which is exactly the cost a size limit is meant to avoid.
 * A 500 MB blob committed to a public repository would be materialised in
 * memory by a single page view before any limit could reject it.
 *
 * Reading the answer is cheap but not trivial, because git stores an object two
 * ways:
 *
 * - **whole** — the entry header records the size, so a small range read at the
 *   entry's offset answers it;
 * - **as a delta** — the entry header records the size of the *delta stream*,
 *   and the reconstructed size is the second varint inside the delta data, which
 *   is itself deflated. Only a bounded prefix of that stream is needed, so
 *   {@link inflatePrefix} recovers it without inflating the object.
 *
 * Either way the answer is exact, which matters because it decides whether a
 * caller may load the object at all. The cost is one `.idx` read (served from
 * the fs cache after the first) plus one or two small range reads of the pack,
 * so a caller can ask about a hundred objects without fetching a pack.
 *
 * `null` means "not a packed object whose size could be read" — a loose object,
 * a genuinely absent one, an unreadable index, a store without range reads, or
 * a delta prefix too short to yield its header. A caller must then read the
 * object rather than treating `null` as "too large"; see the call sites.
 */
import { inflatePrefix } from "./edge-utils.js";
import { rawFs } from "./http/types.js";
import type { Repo } from "./ops/types.js";
import {
	OBJ_OFS_DELTA,
	OBJ_REF_DELTA,
	OID_BYTES,
	readDeltaHeader,
	readEntryHeader,
	readOfsDeltaOffset,
} from "./pack-entry.js";
import { packFileName, parsePackDirectory } from "./pack-files.js";
import { findPackIndexOffset } from "./pack-index.js";

/**
 * Bytes fetched at an entry's offset. The entry header itself is at most 10
 * bytes for a 64-bit length, a `REF_DELTA`'s base id is 20, and an `OFS_DELTA`'s
 * base offset at most 10 — 40 bytes, so 64 answers the layout without a second
 * request.
 */
const ENTRY_PROBE_BYTES = 64;

/**
 * Compressed bytes fetched from a delta's data. A delta header is two varints
 * (at most 10 bytes each) whose compressed form is smaller still, so this is
 * generous by orders of magnitude while staying a bounded read.
 */
const DELTA_PROBE_BYTES = 4 * 1024;

/** The most a delta header can occupy once inflated: two 10-byte varints. */
const DELTA_HEADER_MAX_BYTES = 20;

/** The pack holding `oid`, with the offset of its entry. */
async function locatePackedObject(
	repo: Repo,
	oid: string,
): Promise<{ packName: string; offset: number } | null> {
	const fsp = rawFs(repo);
	const packDir = `${repo.gitdir}/objects/pack`;
	const indexes = parsePackDirectory(
		await fsp.readdir(packDir).catch(() => [] as string[]),
	).filter((file) => file.kind === "idx");

	for (const { base } of indexes) {
		const idx = await fsp.readFile(`${packDir}/${packFileName(base, "idx")}`);
		if (!(idx instanceof Uint8Array)) continue;
		const offset = findPackIndexOffset(idx, oid);
		if (offset !== null) {
			return { packName: packFileName(base, "pack"), offset };
		}
	}
	return null;
}

/** The store's range reader, or `null` when it has none. */
function rangeReader(repo: Repo) {
	const promises = rawFs(repo) as {
		getRange?: (
			key: string,
			start: number,
			end: number,
		) => Promise<Uint8Array | null>;
	};
	if (!promises.getRange) return null;
	return (key: string, start: number, end: number) => {
		if (!promises.getRange) return Promise.resolve(null);
		return promises.getRange(key, start, end);
	};
}

/**
 * A delta entry's reconstructed size, read from the header its deflated data
 * opens with. `null` when the bounded prefix doesn't yield a complete header.
 */
async function deltaResultSize(
	read: NonNullable<ReturnType<typeof rangeReader>>,
	packKey: string,
	dataStart: number,
): Promise<number | null> {
	const compressed = await read(
		packKey,
		dataStart,
		dataStart + DELTA_PROBE_BYTES - 1,
	);
	if (!compressed || compressed.byteLength === 0) return null;

	const inflated = await inflatePrefix(
		new Uint8Array(compressed),
		DELTA_HEADER_MAX_BYTES,
	);
	if (!inflated) return null;

	const header = readDeltaHeader(inflated, 0);
	return header.length <= inflated.byteLength ? header.resultSize : null;
}

/**
 * `oid`'s size in bytes, or `null` when it isn't a packed object this can read
 * (see the module comment for what that means to a caller).
 */
export async function getObjectSize(
	repo: Repo,
	oid: string,
): Promise<number | null> {
	// Without range reads the pack would have to be fetched whole, which is the
	// cost this exists to avoid — so report "unknown" and let the caller read.
	const read = rangeReader(repo);
	if (!read) return null;

	const located = await locatePackedObject(repo, oid);
	if (!located) return null;

	const packKey = `${repo.gitdir}/objects/pack/${located.packName}`;
	const probe = await read(
		packKey,
		located.offset,
		located.offset + ENTRY_PROBE_BYTES - 1,
	);
	if (!probe || probe.byteLength === 0) return null;

	const header = readEntryHeader(probe, 0);
	// A header that ran off the end of the probe is a header this read, not one
	// it can interpret.
	if (header.length > probe.byteLength) return null;
	if (header.type !== OBJ_OFS_DELTA && header.type !== OBJ_REF_DELTA) {
		return header.size;
	}

	// The base reference sits between the entry header and the deflated delta
	// data: 20 bytes of oid for `REF_DELTA`, or a backwards offset for
	// `OFS_DELTA`.
	const bodyStart = located.offset + header.length;
	let dataStart: number;
	if (header.type === OBJ_REF_DELTA) {
		dataStart = bodyStart + OID_BYTES;
	} else {
		const base = readOfsDeltaOffset(probe, header.length);
		if (header.length + base.length > probe.byteLength) return null;
		dataStart = bodyStart + base.length;
	}
	return deltaResultSize(read, packKey, dataStart);
}

/** Gap between two entries that one batched read still spans. */
const BATCH_MAX_GAP_BYTES = 64 * 1024;
/** The most one batched read fetches. */
const BATCH_MAX_SPAN_BYTES = 1024 * 1024;

/** Every pack index in the repo, read once. */
async function packIndexes(
	repo: Repo,
): Promise<Array<{ packName: string; idx: Uint8Array }>> {
	const fsp = rawFs(repo);
	const packDir = `${repo.gitdir}/objects/pack`;
	const files = parsePackDirectory(
		await fsp.readdir(packDir).catch(() => [] as string[]),
	).filter((file) => file.kind === "idx");
	const indexes = await Promise.all(
		files.map(async ({ base }) => ({
			packName: packFileName(base, "pack"),
			idx: await fsp.readFile(`${packDir}/${packFileName(base, "idx")}`),
		})),
	);
	return indexes.filter(
		(entry): entry is { packName: string; idx: Uint8Array } =>
			entry.idx instanceof Uint8Array,
	);
}

/**
 * {@link getObjectSize} for many objects at once, in few range reads: the
 * pack indexes are read once, and entries that sit near each other in a pack
 * (a tree's blobs usually do: they were written together) share one read of
 * at most 1 MiB. A delta whose header runs past its window costs one more
 * small read. Each oid maps to its size, or `null` exactly as
 * {@link getObjectSize} would answer.
 */
export async function getObjectSizes(
	repo: Repo,
	oids: readonly string[],
): Promise<Map<string, number | null>> {
	const sizes = new Map<string, number | null>(oids.map((oid) => [oid, null]));
	const read = rangeReader(repo);
	if (!read || oids.length === 0) return sizes;

	const byPack = new Map<string, Array<{ oid: string; offset: number }>>();
	const indexes = await packIndexes(repo);
	for (const oid of sizes.keys()) {
		for (const { packName, idx } of indexes) {
			const offset = findPackIndexOffset(idx, oid);
			if (offset === null) continue;
			const list = byPack.get(packName) ?? [];
			list.push({ oid, offset });
			byPack.set(packName, list);
			break;
		}
	}

	const work: Promise<void>[] = [];
	for (const [packName, entries] of byPack) {
		const packKey = `${repo.gitdir}/objects/pack/${packName}`;
		entries.sort((a, b) => a.offset - b.offset);
		// Coalesce neighbouring entries into windows.
		const windows: Array<typeof entries> = [];
		for (const entry of entries) {
			const current = windows.at(-1);
			const first = current?.[0];
			const last = current?.at(-1);
			if (
				current &&
				first &&
				last &&
				entry.offset - last.offset <= BATCH_MAX_GAP_BYTES &&
				entry.offset + ENTRY_PROBE_BYTES - first.offset <= BATCH_MAX_SPAN_BYTES
			) {
				current.push(entry);
			} else {
				windows.push([entry]);
			}
		}
		for (const window of windows) {
			work.push(
				(async () => {
					const start = window[0]?.offset ?? 0;
					const end = (window.at(-1)?.offset ?? start) + ENTRY_PROBE_BYTES;
					const bytes = await read(packKey, start, end - 1);
					if (!bytes) return;
					await Promise.all(
						window.map(async ({ oid, offset }) => {
							sizes.set(
								oid,
								await sizeFromWindow(read, packKey, bytes, start, offset),
							);
						}),
					);
				})(),
			);
		}
	}
	await Promise.all(work);
	return sizes;
}

/** One entry's size, parsed from a window read at `windowStart`. */
async function sizeFromWindow(
	read: NonNullable<ReturnType<typeof rangeReader>>,
	packKey: string,
	window: Uint8Array,
	windowStart: number,
	offset: number,
): Promise<number | null> {
	const at = offset - windowStart;
	if (at >= window.byteLength) return null;
	const probe = window.subarray(at, at + ENTRY_PROBE_BYTES);
	const header = readEntryHeader(probe, 0);
	if (header.length > probe.byteLength) return null;
	if (header.type !== OBJ_OFS_DELTA && header.type !== OBJ_REF_DELTA) {
		return header.size;
	}
	let bodyLength: number;
	if (header.type === OBJ_REF_DELTA) {
		bodyLength = OID_BYTES;
	} else {
		const base = readOfsDeltaOffset(probe, header.length);
		if (header.length + base.length > probe.byteLength) return null;
		bodyLength = base.length;
	}
	const dataStart = offset + header.length + bodyLength;
	// The delta's opening bytes are often already in the window.
	const local = window.subarray(
		dataStart - windowStart,
		dataStart - windowStart + DELTA_PROBE_BYTES,
	);
	if (local.byteLength > 0) {
		const inflated = await inflatePrefix(
			new Uint8Array(local),
			DELTA_HEADER_MAX_BYTES,
		);
		if (inflated) {
			const delta = readDeltaHeader(inflated, 0);
			if (delta.length <= inflated.byteLength) return delta.resultSize;
		}
	}
	return deltaResultSize(read, packKey, dataStart);
}
