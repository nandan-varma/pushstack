import { describe, expect, it } from "vitest";
import { MemoryObjectStore } from "../src/stores/memory.js";
import { createR2Store } from "../src/stores/r2.js";
import { createFakeR2Bucket } from "../src/testing/fake-r2.js";
import type { ListResult } from "../src/types.js";

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (data: Uint8Array | null) =>
	new TextDecoder().decode(data ?? new Uint8Array());

/** Sort list results so R2 and memory output compare regardless of order. */
function normalize(result: ListResult): ListResult {
	return {
		objects: [...result.objects].sort((a, b) =>
			a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
		),
		prefixes: [...result.prefixes].sort(),
	};
}

describe("createR2Store", () => {
	it("get returns bytes for a hit and null for a miss", async () => {
		const bucket = createFakeR2Bucket();
		const store = createR2Store(bucket);
		await store.put("a", bytes("hello"));

		expect(text(await store.get("a"))).toBe("hello");
		expect(await store.get("missing")).toBeNull();
	});

	it("getRange treats the end offset as inclusive", async () => {
		const bucket = createFakeR2Bucket();
		const store = createR2Store(bucket);
		await store.put("a", bytes("0123456789"));

		const range = await store.getRange("a", 2, 4);
		expect(range?.byteLength).toBe(3);
		expect(text(range ?? null)).toBe("234");
		expect(await store.getRange("missing", 0, 1)).toBeNull();
	});

	it("put overwrites an existing object", async () => {
		const bucket = createFakeR2Bucket();
		const store = createR2Store(bucket);
		await store.put("a", bytes("first"));
		await store.put("a", bytes("second"));

		expect(text(await store.get("a"))).toBe("second");
	});

	it("delete of a missing key does not throw", async () => {
		const bucket = createFakeR2Bucket();
		const store = createR2Store(bucket);
		await expect(store.delete("missing")).resolves.toBeUndefined();

		await store.put("a", bytes("x"));
		await store.delete("a");
		expect(await store.get("a")).toBeNull();
	});

	it("head returns the size for a hit and null for a miss", async () => {
		const bucket = createFakeR2Bucket();
		const store = createR2Store(bucket);
		await store.put("a", bytes("hello"));

		expect(await store.head("a")).toEqual({ size: 5 });
		expect(await store.head("missing")).toBeNull();
	});

	describe("list", () => {
		const fixture = [
			"repos/a/HEAD",
			"repos/a/objects/ab",
			"repos/a/objects/cd/ef",
			"repos/b/HEAD",
			"repos/b/refs/heads/main",
			"top.txt",
		];

		async function loadBoth(keys: string[]) {
			const bucket = createFakeR2Bucket();
			const r2 = createR2Store(bucket);
			const memory = new MemoryObjectStore();
			for (const key of [...keys].sort()) {
				await r2.put(key, bytes(key));
				await memory.put(key, bytes(key));
			}
			return { bucket, r2, memory };
		}

		it("matches MemoryObjectStore without a delimiter", async () => {
			const { r2, memory } = await loadBoth(fixture);

			const expected = normalize(await memory.list("repos/"));
			const actual = normalize(await r2.list("repos/"));
			expect(actual).toEqual(expected);
			expect(actual.objects.map((o) => o.key)).toEqual(
				fixture.filter((key) => key.startsWith("repos/")).sort(),
			);
			expect(actual.prefixes).toEqual([]);
		});

		it("matches MemoryObjectStore with a delimiter", async () => {
			const { r2, memory } = await loadBoth(fixture);

			for (const prefix of ["", "repos/", "repos/a/"]) {
				const options = { delimiter: "/" };
				expect(normalize(await r2.list(prefix, options))).toEqual(
					normalize(await memory.list(prefix, options)),
				);
			}
			const top = await r2.list("", { delimiter: "/" });
			expect(top.objects.map((o) => o.key)).toEqual(["top.txt"]);
			expect(top.prefixes).toEqual(["repos/"]);
		});

		it("paginates across more than 1000 keys when no limit is given", async () => {
			const keys = Array.from(
				{ length: 2500 },
				(_, i) => `k/${String(i).padStart(4, "0")}`,
			);
			const { bucket, r2, memory } = await loadBoth(keys);

			const result = await r2.list("k/");
			expect(result.objects).toHaveLength(2500);
			expect(normalize(result)).toEqual(normalize(await memory.list("k/")));
			expect(bucket.listCalls).toBeGreaterThan(1);
		});

		it("with limit 5 returns exactly 5 entries and fetches one page", async () => {
			const keys = Array.from(
				{ length: 20 },
				(_, i) => `k/${String(i).padStart(2, "0")}`,
			);
			const { bucket, r2 } = await loadBoth(keys);
			const callsBefore = bucket.listCalls;

			const result = await r2.list("k/", { limit: 5 });
			expect(result.objects).toHaveLength(5);
			expect(result.objects.map((o) => o.key)).toEqual(keys.slice(0, 5));
			expect(bucket.listCalls - callsBefore).toBe(1);
		});
	});

	it("copy duplicates bytes to a new key and leaves the source unchanged", async () => {
		const bucket = createFakeR2Bucket();
		const store = createR2Store(bucket);
		await store.put("src", bytes("payload"));

		await store.copy("src", "dst");

		expect(text(await store.get("dst"))).toBe("payload");
		expect(text(await store.get("src"))).toBe("payload");
	});

	it("copy rejects when the source is missing", async () => {
		const bucket = createFakeR2Bucket();
		const store = createR2Store(bucket);

		await expect(store.copy("missing", "dst")).rejects.toThrow();
		expect(await store.get("dst")).toBeNull();
	});
});
