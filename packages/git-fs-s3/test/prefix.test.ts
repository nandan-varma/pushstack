import { describe, expect, it } from "vitest";
import {
	copyPrefix,
	deletePrefix,
	GitConflictError,
	GitRefNotFoundError,
	isNotFoundError,
	isRetryableError,
	MemoryObjectStore,
	movePrefix,
	PrefixTooLargeError,
} from "../src/index.js";

const bytes = (text: string) => new TextEncoder().encode(text);

async function seeded(count = 45) {
	const store = new MemoryObjectStore();
	for (let i = 0; i < count; i++) await store.put(`a/${i}`, bytes(`${i}`));
	await store.put("ab/keep", bytes("k"));
	return store;
}

describe("deletePrefix", () => {
	it("deletes everything under the prefix and nothing else", async () => {
		const store = await seeded();
		expect(await deletePrefix(store, "a/")).toBe(45);
		expect((await store.list("a/")).objects).toEqual([]);
		expect(await store.get("ab/keep")).not.toBeNull();
	});
});

describe("movePrefix", () => {
	it("moves keys to the new prefix, preserving relative paths", async () => {
		const store = await seeded(3);
		expect(await movePrefix(store, "a/", "b/")).toBe(3);
		expect((await store.list("a/")).objects).toEqual([]);
		expect(await store.get("b/2")).toEqual(bytes("2"));
		expect(await store.get("ab/keep")).not.toBeNull();
	});

	it("uses a custom copy and leaves the source untouched when one fails", async () => {
		const store = await seeded(3);
		await expect(
			movePrefix(store, "a/", "b/", {
				copy: async (from) => {
					if (from === "a/1") throw new Error("boom");
				},
			}),
		).rejects.toThrow("boom");
		expect((await store.list("a/")).objects).toHaveLength(3);
	});

	it("rejects overlapping prefixes", async () => {
		const store = await seeded(1);
		await expect(movePrefix(store, "a/", "a/b/")).rejects.toThrow("overlap");
	});
});

describe("copyPrefix", () => {
	it("copies every object and leaves the source in place", async () => {
		const store = await seeded(3);
		expect(await copyPrefix(store, "a/", "b/")).toBe(3);
		expect((await store.list("a/")).objects).toHaveLength(3);
		expect(await store.get("b/2")).toEqual(bytes("2"));
		expect(await store.get("ab/keep")).not.toBeNull();
	});

	it("refuses before copying anything when the source is over maxBytes", async () => {
		const store = new MemoryObjectStore();
		await store.put("a/big", bytes("0123456789"));
		await store.put("a/small", bytes("01"));
		const copied: string[] = [];
		await expect(
			copyPrefix(store, "a/", "b/", {
				maxBytes: 5,
				copy: async (from) => {
					copied.push(from);
				},
			}),
		).rejects.toBeInstanceOf(PrefixTooLargeError);
		expect(copied).toEqual([]);
	});

	it("copies a source of exactly maxBytes", async () => {
		const store = new MemoryObjectStore();
		await store.put("a/x", bytes("0123456789"));
		expect(await copyPrefix(store, "a/", "b/", { maxBytes: 10 })).toBe(1);
	});

	it("rejects overlapping prefixes", async () => {
		const store = await seeded(1);
		await expect(copyPrefix(store, "a/", "a/b/")).rejects.toThrow("overlap");
	});
});

describe("isNotFoundError", () => {
	it("is true for not-found git errors only", () => {
		expect(isNotFoundError(new GitRefNotFoundError("r"))).toBe(true);
		expect(isNotFoundError(new GitConflictError("c"))).toBe(false);
		expect(isNotFoundError(null)).toBe(false);
	});

	it("is true for isomorphic-git's own NotFoundError", () => {
		// resolveRef/readObject/deleteRef/currentBranch reject with this code
		// rather than this package's typed errors, so a predicate that only
		// knew the typed ones made "missing" and "read failed" identical.
		const notFound = new Error("missing") as Error & { code: string };
		notFound.code = "NotFoundError";
		expect(isNotFoundError(notFound)).toBe(true);
	});
});

describe("isRetryableError", () => {
	it("retries fetch failures, timeouts and 5xx/429 only", () => {
		expect(isRetryableError(new TypeError("fetch failed"))).toBe(true);
		const timeout = new Error("t");
		timeout.name = "TimeoutError";
		expect(isRetryableError(timeout)).toBe(true);
		expect(isRetryableError({ $metadata: { httpStatusCode: 503 } })).toBe(true);
		expect(isRetryableError({ $metadata: { httpStatusCode: 403 } })).toBe(
			false,
		);
		expect(isRetryableError(new Error("x"))).toBe(false);
		expect(isRetryableError("x")).toBe(false);
	});
});
