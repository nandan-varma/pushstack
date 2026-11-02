import type { R2BucketLike } from "../stores/r2.js";

/** R2's page cap when the caller sends no limit. */
const R2_PAGE_CAP = 1000;

async function readAll(
	stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
	}
	const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
}

/**
 * In-memory R2 binding. Lists are lexicographically ordered; delimiter
 * grouping and pagination follow R2: each page is capped at `limit` (or 1000),
 * and `cursor` is the last key or prefix returned.
 */
export function createFakeR2Bucket(): R2BucketLike & {
	/** Number of `list` calls served, to assert pagination. */
	readonly listCalls: number;
	readonly objects: Map<string, Uint8Array>;
} {
	const objects = new Map<string, Uint8Array>();
	let listCalls = 0;

	return {
		async get(key, options) {
			const data = objects.get(key);
			if (!data) return null;
			const range = options?.range;
			const body = range
				? data.slice(range.offset, range.offset + range.length)
				: data.slice();
			return {
				body: new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(body);
						controller.close();
					},
				}),
				arrayBuffer: async () => body.slice().buffer,
			};
		},

		async put(key, value) {
			objects.set(
				key,
				ArrayBuffer.isView(value) ? value.slice() : await readAll(value),
			);
		},

		async delete(key) {
			objects.delete(key);
		},

		async head(key) {
			const data = objects.get(key);
			return data ? { size: data.byteLength } : null;
		},

		async list({ prefix = "", delimiter, limit, cursor }) {
			listCalls += 1;
			const names = new Map<string, { size: number; common: boolean }>();
			for (const [key, data] of objects) {
				if (!key.startsWith(prefix)) continue;
				const rest = key.slice(prefix.length);
				const idx = delimiter === undefined ? -1 : rest.indexOf(delimiter);
				if (delimiter !== undefined && idx !== -1) {
					names.set(prefix + rest.slice(0, idx + delimiter.length), {
						size: 0,
						common: true,
					});
				} else {
					names.set(key, { size: data.byteLength, common: false });
				}
			}

			let sorted = [...names.entries()].sort(([a], [b]) =>
				a < b ? -1 : a > b ? 1 : 0,
			);
			if (cursor !== undefined)
				sorted = sorted.filter(([name]) => name > cursor);

			const cap = Math.min(limit ?? R2_PAGE_CAP, R2_PAGE_CAP);
			const page = sorted.slice(0, cap);
			const truncated = sorted.length > cap;
			return {
				objects: page
					.filter(([, entry]) => !entry.common)
					.map(([key, entry]) => ({ key, size: entry.size })),
				delimitedPrefixes: page
					.filter(([, entry]) => entry.common)
					.map(([name]) => name),
				truncated,
				cursor: truncated ? page.at(-1)?.[0] : undefined,
			};
		},
		get listCalls() {
			return listCalls;
		},
		objects,
	};
}
