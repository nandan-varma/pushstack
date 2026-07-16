import { describe, expect, it } from "vitest";
import { createReferencePattern } from "../reference-patterns";

describe("createReferencePattern", () => {
	const pattern = createReferencePattern();

	function findAll(text: string): string[] {
		return [...text.matchAll(pattern)].map((m) => m[0]);
	}

	it("matches #N issue references", () => {
		expect(findAll("fixes #42")).toEqual(["#42"]);
		expect(findAll("see #1")).toEqual(["#1"]);
		expect(findAll("closes #999")).toEqual(["#999"]);
	});

	it("does not match # followed by non-digits", () => {
		expect(findAll("use #hashtag")).toEqual([]);
		expect(equal(findAll("color #fff"), [])).toBe(true);
	});

	it("matches commit SHAs of 7-40 hex chars with at least one digit", () => {
		expect(findAll("revert abc1234")).toEqual(["abc1234"]);
		expect(findAll("commit 1234567")).toEqual(["1234567"]);
		expect(findAll("in a1b2c3d4e5f6")).toEqual(["a1b2c3d4e5f6"]);
	});

	it("does not match pure-alpha hex words without digits", () => {
		expect(findAll("dead beef")).toEqual([]);
		expect(findAll("cafe babe")).toEqual([]);
		expect(findAll("abc def")).toEqual([]);
	});

	it("does not match hex strings shorter than 7 chars", () => {
		expect(findAll("fix abc12")).toEqual([]);
		expect(findAll("at abcdef")).toEqual([]);
	});

	it("matches full 40-char SHAs", () => {
		const sha = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
		expect(findAll(`commit ${sha}`)).toEqual([sha]);
	});

	it("does not match hex strings longer than 40 chars", () => {
		const long = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2a";
		expect(findAll(long)).toEqual([]);
	});

	it("finds multiple references in one string", () => {
		const result = findAll("fixes #1 and reverts abc1234");
		expect(result).toEqual(["#1", "abc1234"]);
	});

	it("matches #N at the start of a string", () => {
		expect(findAll("#1 is the first issue")).toEqual(["#1"]);
	});

	it("matches #N at the end of a string", () => {
		expect(findAll("see #1")).toEqual(["#1"]);
	});

	it("handles case-insensitive SHA matching", () => {
		expect(findAll("ABC1234")).toEqual(["ABC1234"]);
	});
});

function equal(a: string[], b: string[]): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}
