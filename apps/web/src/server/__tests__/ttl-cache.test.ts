import { describe, expect, it, vi } from "vitest";
import { createTtlCoalescedCache } from "../ttl-cache";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("createTtlCoalescedCache", () => {
	it("caches a fetched value until the TTL lapses", async () => {
		const cache = createTtlCoalescedCache<number>({ ttlMs: 20 });
		const compute = vi.fn(async () => 1);

		await expect(cache.get("k", compute)).resolves.toBe(1);
		await expect(cache.get("k", compute)).resolves.toBe(1);
		expect(compute).toHaveBeenCalledTimes(1);
		expect(cache.peek("k")).toBe(1);

		await sleep(40);
		expect(cache.peek("k")).toBeUndefined();
		await expect(cache.get("k", async () => 2)).resolves.toBe(2);
	});

	it("coalesces concurrent fetches for one key and reports hit, miss and coalesce", async () => {
		const onHit = vi.fn();
		const onMiss = vi.fn();
		const onCoalesce = vi.fn();
		const cache = createTtlCoalescedCache<string>({
			ttlMs: 1000,
			onHit,
			onMiss,
			onCoalesce,
		});
		const gate = deferred<string>();
		const compute = vi.fn(() => gate.promise);

		const first = cache.get("k", compute);
		const second = cache.get("k", async () => "ignored");
		expect(compute).toHaveBeenCalledTimes(1);
		expect(onMiss).toHaveBeenCalledWith("k");
		expect(onCoalesce).toHaveBeenCalledWith("k");

		gate.resolve("v");
		await expect(Promise.all([first, second])).resolves.toEqual(["v", "v"]);

		await expect(cache.get("k", compute)).resolves.toBe("v");
		expect(onHit).toHaveBeenCalledWith("k");
		expect(compute).toHaveBeenCalledTimes(1);
	});

	it("caches null and false, but never treats an expired key as a hit", async () => {
		const cache = createTtlCoalescedCache<null | false>({ ttlMs: 20 });
		await cache.get("null", async () => null);
		await cache.get("false", async () => false);
		expect(cache.peek("null")).toBeNull();
		expect(cache.peek("false")).toBe(false);

		await sleep(40);
		expect(cache.peek("null")).toBeUndefined();
	});

	it("delete drops the value and a fetch still in flight, whose caller keeps its answer", async () => {
		const cache = createTtlCoalescedCache<string>({ ttlMs: 1000 });
		const gate = deferred<string>();
		const pending = cache.get("k", () => gate.promise);
		cache.delete("k");
		gate.resolve("v");

		await expect(pending).resolves.toBe("v");
		expect(cache.peek("k")).toBeUndefined();
	});

	it("deletePrefix drops one key space, including fetches in flight", async () => {
		const cache = createTtlCoalescedCache<string>({ ttlMs: 1000 });
		await cache.get("1:a", async () => "a");
		await cache.get("1:b", async () => "b");
		await cache.get("2:a", async () => "other");
		const gate = deferred<string>();
		const pending = cache.get("1:c", () => gate.promise);

		cache.deletePrefix("1:");
		gate.resolve("c");

		await expect(pending).resolves.toBe("c");
		expect(cache.peek("1:a")).toBeUndefined();
		expect(cache.peek("1:b")).toBeUndefined();
		expect(cache.peek("1:c")).toBeUndefined();
		expect(cache.peek("2:a")).toBe("other");
	});

	it("set stores a value and bounds the cache at maxEntries", async () => {
		const cache = createTtlCoalescedCache<number>({
			ttlMs: 1000,
			maxEntries: 2,
		});
		cache.set("a", 1);
		cache.set("b", 2);
		cache.set("c", 3);
		expect(cache.peek("a")).toBeUndefined();
		expect(cache.peek("b")).toBe(2);
		expect(cache.peek("c")).toBe(3);
	});
});
