import { describe, expect, it } from "vitest";
import {
	deleteCachedObject,
	getCachedObject,
	invalidateObjectCache,
	setCachedObject,
} from "../git-cache";

// The raw Buffer cache that used to live alongside this moved into
// @nandan-varma/git-fs-s3's createCachedStore (composed in git-fs.ts) and is
// covered by that package's test suite.

describe("object cache (getCachedObject / setCachedObject / deleteCachedObject)", () => {
	it("stores and retrieves a parsed object", () => {
		const obj = { sha: "abc", message: "test" };
		setCachedObject("obj-1", obj);
		expect(getCachedObject("obj-1")).toEqual(obj);
	});

	it("returns null for a missing key", () => {
		expect(getCachedObject("nope")).toBeNull();
	});

	it("deletes a cached object", () => {
		setCachedObject("del-obj", { x: 1 });
		deleteCachedObject("del-obj");
		expect(getCachedObject("del-obj")).toBeNull();
	});
});

describe("invalidateObjectCache (prefix)", () => {
	it("deletes all object cache entries matching a prefix", () => {
		setCachedObject("result:x/1", { a: 1 });
		setCachedObject("result:x/2", { a: 2 });
		setCachedObject("result:y/1", { a: 3 });

		invalidateObjectCache("result:x/");

		expect(getCachedObject("result:x/1")).toBeNull();
		expect(getCachedObject("result:x/2")).toBeNull();
		expect(getCachedObject("result:y/1")).toEqual({ a: 3 });
	});
});
