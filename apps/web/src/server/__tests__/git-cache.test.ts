import { describe, expect, it } from "vitest";
import { invalidateResultCache, opsHooksFor } from "../git-cache";

describe("result cache", () => {
	it("is shared by every opsHooksFor() and evicts by prefix", () => {
		const cache = opsHooksFor("o", "r").resultCache;
		if (!cache) throw new Error("hooks carry a result cache");
		cache.set("tree:repos/o/r/git:sha:", ["a"]);
		cache.set("tree:repos/o/other/git:sha:", ["b"]);
		expect(
			opsHooksFor("x", "y").resultCache?.get("tree:repos/o/r/git:sha:"),
		).toEqual(["a"]);

		invalidateResultCache("tree:repos/o/r/git:");
		expect(cache.get("tree:repos/o/r/git:sha:")).toBeNull();
		expect(cache.get("tree:repos/o/other/git:sha:")).toEqual(["b"]);
	});
});
