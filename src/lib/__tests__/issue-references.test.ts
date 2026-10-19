import { describe, expect, it } from "vitest";
import {
	getClosingIssueNumbers,
	getReferencedIssueNumbers,
} from "../issue-references";

describe("getReferencedIssueNumbers", () => {
	it("finds each #N once, in order", () => {
		expect(getReferencedIssueNumbers("See #3, then #1 and #3 again.")).toEqual([
			3, 1,
		]);
	});

	it("ignores references inside code, words, paths and entities", () => {
		const text = [
			"Inline `#5` and a#6, docs/#7, &#8; ##9",
			"```",
			"#10 in a fence",
			"```",
			"but #11 counts",
		].join("\n");
		expect(getReferencedIssueNumbers(text)).toEqual([11]);
	});

	it("handles empty and null text", () => {
		expect(getReferencedIssueNumbers(null)).toEqual([]);
		expect(getReferencedIssueNumbers("")).toEqual([]);
	});
});

describe("getClosingIssueNumbers", () => {
	it("accepts GitHub's keywords, with or without a colon", () => {
		expect(
			getClosingIssueNumbers("Fixes: #1. closes #2, Resolved #3, fix issue #4"),
		).toEqual([1, 2, 3, 4]);
	});

	it("ignores closing keywords inside code", () => {
		expect(getClosingIssueNumbers("Run `fixes #1` in a shell")).toEqual([]);
	});
});
