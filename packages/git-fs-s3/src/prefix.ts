import type { ListResult, ObjectStore } from "./types.js";

const BATCH = 20;

async function inBatches<T>(
	items: T[],
	fn: (item: T) => Promise<void>,
): Promise<void> {
	for (let i = 0; i < items.length; i += BATCH) {
		await Promise.all(items.slice(i, i + BATCH).map(fn));
	}
}

/**
 * Delete every object under `prefix` (one paginated LIST, then batched
 * deletes). Returns the number of objects deleted. Callers serialise against
 * concurrent writers (e.g. a repository lock) and invalidate any cache
 * layered above `store`.
 */
export async function deletePrefix(
	store: ObjectStore,
	prefix: string,
): Promise<number> {
	const { objects } = await store.list(prefix);
	await inBatches(objects, (object) => store.delete(object.key));
	return objects.length;
}

export interface MovePrefixOptions {
	/**
	 * Copy one object, e.g. a store's server-side `copy` (no bytes pass through
	 * this process). Defaults to `get` + `put` on `store`.
	 */
	copy?: (fromKey: string, toKey: string) => Promise<void>;
}

export interface CopyPrefixOptions extends MovePrefixOptions {
	/**
	 * Refuse before copying anything when the objects under `from` add up to
	 * more than this many bytes. Throws {@link PrefixTooLargeError}.
	 */
	maxBytes?: number;
}

/** A {@link copyPrefix} whose source holds more bytes than the caller allowed. */
export class PrefixTooLargeError extends Error {
	constructor(
		readonly bytes: number,
		readonly maxBytes: number,
	) {
		super(`Prefix holds ${bytes} bytes, more than the ${maxBytes} byte limit`);
		this.name = "PrefixTooLargeError";
	}
}

/**
 * List the objects `from` to `to` will carry: rejects overlapping prefixes and
 * a source over `maxBytes`, before any object is copied.
 */
async function listForCopy(
	store: ObjectStore,
	from: string,
	to: string,
	maxBytes: number | undefined,
): Promise<ListResult["objects"]> {
	if (from.startsWith(to) || to.startsWith(from)) {
		throw new Error(`movePrefix: prefixes overlap (${from} -> ${to})`);
	}
	const { objects } = await store.list(from);
	if (maxBytes !== undefined) {
		const bytes = objects.reduce((sum, object) => sum + object.size, 0);
		if (bytes > maxBytes) throw new PrefixTooLargeError(bytes, maxBytes);
	}
	return objects;
}

async function copyObjects(
	store: ObjectStore,
	objects: ListResult["objects"],
	from: string,
	to: string,
	options: MovePrefixOptions,
): Promise<void> {
	const copy =
		options.copy ??
		(async (fromKey: string, toKey: string) => {
			const data = await store.get(fromKey);
			if (data) await store.put(toKey, data);
		});
	await inBatches(objects, (object) =>
		copy(object.key, to + object.key.slice(from.length)),
	);
}

/**
 * Copy every object under `from` to the same relative key under `to`, leaving
 * the source in place. Returns the number of objects copied. A failed copy
 * leaves a partial destination; call {@link deletePrefix} on it to clean up.
 * `from` and `to` must not overlap.
 */
export async function copyPrefix(
	store: ObjectStore,
	from: string,
	to: string,
	options: CopyPrefixOptions = {},
): Promise<number> {
	const objects = await listForCopy(store, from, to, options.maxBytes);
	await copyObjects(store, objects, from, to, options);
	return objects.length;
}

/**
 * Move every object under `from` to the same relative key under `to`: copy
 * everything first, then delete the old keys only once every copy succeeded,
 * so a failed copy leaves the source untouched (a partial destination may
 * remain; call {@link deletePrefix} on it to clean up). Returns the number of
 * objects moved. `from` and `to` must not overlap.
 */
export async function movePrefix(
	store: ObjectStore,
	from: string,
	to: string,
	options: MovePrefixOptions = {},
): Promise<number> {
	const objects = await listForCopy(store, from, to, undefined);
	await copyObjects(store, objects, from, to, options);
	await inBatches(objects, (object) => store.delete(object.key));
	return objects.length;
}
