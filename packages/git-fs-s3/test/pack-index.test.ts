import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findPackIndexOffset, readPackIndex } from "../src/pack-index.js";

const PACK_DIR = join(import.meta.dirname, "fixtures/deltified/objects/pack");

function fixtureIndex(): Uint8Array {
	const name = readdirSync(PACK_DIR).find((file) => file.endsWith(".idx"));
	if (!name) throw new Error("fixture has no pack index");
	return new Uint8Array(readFileSync(join(PACK_DIR, name)));
}

describe("findPackIndexOffset", () => {
	it("finds every indexed object at the offset the full index lists", () => {
		const idx = fixtureIndex();
		const entries = readPackIndex(idx);
		if (!entries) throw new Error("fixture pack index is not v2");
		expect(entries.length).toBeGreaterThan(1);
		for (const { oid, offset } of entries) {
			expect(findPackIndexOffset(idx, oid)).toBe(offset);
		}
	});

	it("is null for an absent object, a malformed oid and a non-index", () => {
		const idx = fixtureIndex();
		expect(findPackIndexOffset(idx, "0".repeat(40))).toBeNull();
		expect(findPackIndexOffset(idx, "f".repeat(40))).toBeNull();
		const [first] = readPackIndex(idx) ?? [];
		if (!first) throw new Error("fixture pack index is empty");
		expect(findPackIndexOffset(idx, first.oid.toUpperCase())).toBeNull();
		expect(findPackIndexOffset(idx, first.oid.slice(0, 39))).toBeNull();
		expect(findPackIndexOffset(new Uint8Array(16), first.oid)).toBeNull();
	});
});
