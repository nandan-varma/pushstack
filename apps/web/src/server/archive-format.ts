/**
 * Streaming zip and tar writers for source archives. Each yields the archive
 * chunk by chunk as entries are read, so only one file is ever held in memory
 * (a function response is capped at 4.5 MB on Vercel unless it streams).
 *
 * Zip: deflate (stored when that is smaller), UTF-8 names, Unix modes in the
 * external attributes so executables and symlinks survive extraction, the
 * commit sha as the archive comment (as `git archive` does). No zip64: the
 * entry and byte limits in `limits.ts` keep every offset far below 4 GiB.
 * Tar: ustar headers, a pax extended header for names or link targets that do
 * not fit, a pax global header carrying the commit sha as `comment`.
 */
import { crc32, deflateRawSync } from "node:zlib";

export type ArchiveEntryKind = "file" | "symlink" | "dir";

export interface ArchiveEntry {
	/** Path inside the archive; no leading or trailing slash. */
	path: string;
	kind: ArchiveEntryKind;
	executable: boolean;
	/** Reads a file's bytes (a symlink's target). Not called for directories. */
	read: () => Promise<Uint8Array>;
}

export interface ArchiveMeta {
	/** The commit the archive was built from. */
	commitSha: string;
	/** Seconds since the epoch: the commit time, stamped on every entry. */
	mtime: number;
}

const encoder = new TextEncoder();

function unixMode(entry: ArchiveEntry): number {
	if (entry.kind === "dir") return 0o755;
	if (entry.kind === "symlink") return 0o777;
	return entry.executable ? 0o755 : 0o644;
}

function dosDateTime(seconds: number): { time: number; date: number } {
	const when = new Date(seconds * 1000);
	const year = Math.min(Math.max(when.getUTCFullYear(), 1980), 2107);
	return {
		time:
			(when.getUTCHours() << 11) |
			(when.getUTCMinutes() << 5) |
			(when.getUTCSeconds() >> 1),
		date:
			((year - 1980) << 9) |
			((when.getUTCMonth() + 1) << 5) |
			when.getUTCDate(),
	};
}

export async function* zipChunks(
	entries: AsyncIterable<ArchiveEntry>,
	meta: ArchiveMeta,
): AsyncGenerator<Uint8Array> {
	const { time, date } = dosDateTime(meta.mtime);
	const central: Uint8Array[] = [];
	let offset = 0;
	let count = 0;
	for await (const entry of entries) {
		const isDir = entry.kind === "dir";
		const name = encoder.encode(isDir ? `${entry.path}/` : entry.path);
		const data = isDir ? new Uint8Array(0) : await entry.read();
		const crc = isDir ? 0 : crc32(data);
		let method = 0;
		let body = data;
		if (entry.kind === "file" && data.byteLength > 0) {
			const deflated = deflateRawSync(data);
			if (deflated.byteLength < data.byteLength) {
				method = 8;
				body = deflated;
			}
		}
		const header = new DataView(new ArrayBuffer(30));
		header.setUint32(0, 0x04034b50, true);
		header.setUint16(4, 20, true);
		header.setUint16(6, 0x0800, true);
		header.setUint16(8, method, true);
		header.setUint16(10, time, true);
		header.setUint16(12, date, true);
		header.setUint32(14, crc, true);
		header.setUint32(18, body.byteLength, true);
		header.setUint32(22, data.byteLength, true);
		header.setUint16(26, name.byteLength, true);
		header.setUint16(28, 0, true);
		yield new Uint8Array(header.buffer);
		yield name;
		if (body.byteLength > 0) yield body;

		const record = new DataView(new ArrayBuffer(46));
		record.setUint32(0, 0x02014b50, true);
		record.setUint16(4, (3 << 8) | 20, true);
		record.setUint16(6, 20, true);
		record.setUint16(8, 0x0800, true);
		record.setUint16(10, method, true);
		record.setUint16(12, time, true);
		record.setUint16(14, date, true);
		record.setUint32(16, crc, true);
		record.setUint32(20, body.byteLength, true);
		record.setUint32(24, data.byteLength, true);
		record.setUint16(28, name.byteLength, true);
		const type = isDir
			? 0o040000
			: entry.kind === "symlink"
				? 0o120000
				: 0o100000;
		record.setUint32(38, ((type | unixMode(entry)) << 16) >>> 0, true);
		record.setUint32(42, offset, true);
		central.push(new Uint8Array(record.buffer), name);
		offset += 30 + name.byteLength + body.byteLength;
		count++;
	}
	let centralSize = 0;
	for (const part of central) {
		yield part;
		centralSize += part.byteLength;
	}
	const comment = encoder.encode(meta.commitSha);
	const end = new DataView(new ArrayBuffer(22));
	end.setUint32(0, 0x06054b50, true);
	end.setUint16(8, count, true);
	end.setUint16(10, count, true);
	end.setUint32(12, centralSize, true);
	end.setUint32(16, offset, true);
	end.setUint16(20, comment.byteLength, true);
	yield new Uint8Array(end.buffer);
	yield comment;
}

function octal(value: number, width: number): string {
	return `${value.toString(8).padStart(width - 1, "0")}\0`;
}

function field(
	block: Uint8Array,
	at: number,
	width: number,
	value: string | Uint8Array,
) {
	const bytes = typeof value === "string" ? encoder.encode(value) : value;
	block.set(bytes.subarray(0, width), at);
}

function tarHeader(fields: {
	name: Uint8Array;
	prefix?: Uint8Array;
	mode: number;
	size: number;
	mtime: number;
	type: string;
	link?: Uint8Array;
}): Uint8Array {
	const block = new Uint8Array(512);
	field(block, 0, 100, fields.name);
	field(block, 100, 8, octal(fields.mode, 8));
	field(block, 108, 8, octal(0, 8));
	field(block, 116, 8, octal(0, 8));
	field(block, 124, 12, octal(fields.size, 12));
	field(block, 136, 12, octal(fields.mtime, 12));
	block.fill(0x20, 148, 156);
	field(block, 156, 1, fields.type);
	if (fields.link) field(block, 157, 100, fields.link);
	field(block, 257, 6, "ustar\0");
	field(block, 263, 2, "00");
	if (fields.prefix) field(block, 345, 155, fields.prefix);
	let sum = 0;
	for (const byte of block) sum += byte;
	field(block, 148, 8, `${sum.toString(8).padStart(6, "0")}\0 `);
	return block;
}

function padding(size: number): Uint8Array {
	return new Uint8Array((512 - (size % 512)) % 512);
}

/** One pax record: `<length> <key>=<value>\n`, the length counting itself. */
function paxRecord(key: string, value: string): Uint8Array {
	const body = encoder.encode(` ${key}=${value}\n`);
	let length = body.byteLength + 1;
	while (String(length).length + body.byteLength !== length) {
		length = String(length).length + body.byteLength;
	}
	return encoder.encode(`${length}${new TextDecoder().decode(body)}`);
}

function paxBlocks(
	name: string,
	records: Uint8Array[],
	type: "x" | "g",
	mtime: number,
): Uint8Array[] {
	const size = records.reduce((sum, part) => sum + part.byteLength, 0);
	return [
		tarHeader({
			name: encoder.encode(name),
			mode: 0o644,
			size,
			mtime,
			type,
		}),
		...records,
		padding(size),
	];
}

/** Splits a long path into ustar `prefix` and `name`, or null when it cannot. */
function splitUstar(
	path: Uint8Array,
): { prefix: Uint8Array; name: Uint8Array } | null {
	if (path.byteLength <= 100) return { prefix: new Uint8Array(0), name: path };
	for (let i = path.byteLength - 1; i > 0; i--) {
		if (path[i] !== 0x2f) continue;
		const prefix = path.subarray(0, i);
		const name = path.subarray(i + 1);
		if (prefix.byteLength <= 155 && name.byteLength <= 100 && name.byteLength) {
			return { prefix, name };
		}
	}
	return null;
}

export async function* tarChunks(
	entries: AsyncIterable<ArchiveEntry>,
	meta: ArchiveMeta,
): AsyncGenerator<Uint8Array> {
	for (const part of paxBlocks(
		"pax_global_header",
		[paxRecord("comment", meta.commitSha)],
		"g",
		meta.mtime,
	)) {
		yield part;
	}
	for await (const entry of entries) {
		const isDir = entry.kind === "dir";
		const path = encoder.encode(isDir ? `${entry.path}/` : entry.path);
		const data = entry.kind === "file" ? await entry.read() : new Uint8Array(0);
		const link =
			entry.kind === "symlink" ? await entry.read() : new Uint8Array(0);
		const records: Uint8Array[] = [];
		const split = splitUstar(path);
		if (!split) records.push(paxRecord("path", new TextDecoder().decode(path)));
		if (link.byteLength > 100) {
			records.push(paxRecord("linkpath", new TextDecoder().decode(link)));
		}
		if (records.length) {
			for (const part of paxBlocks(
				"pax_extended_header",
				records,
				"x",
				meta.mtime,
			)) {
				yield part;
			}
		}
		yield tarHeader({
			name: split?.name ?? path.subarray(0, 100),
			prefix: split?.prefix,
			mode: unixMode(entry),
			size: data.byteLength,
			mtime: meta.mtime,
			type: isDir ? "5" : entry.kind === "symlink" ? "2" : "0",
			link: link.byteLength ? link : undefined,
		});
		if (data.byteLength) {
			yield data;
			yield padding(data.byteLength);
		}
	}
	yield new Uint8Array(1024);
}

/** A byte stream that pulls one chunk at a time, so a slow client applies backpressure. */
export function chunkStream(
	chunks: AsyncGenerator<Uint8Array>,
): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const next = await chunks.next();
				if (next.done) controller.close();
				else controller.enqueue(next.value);
			} catch (error) {
				controller.error(error);
			}
		},
		async cancel() {
			await chunks.return(undefined);
		},
	});
}
