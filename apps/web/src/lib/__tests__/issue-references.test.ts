import { describe, expect, it } from "vitest";
import {
	getClosingIssueNumbers,
	getReferencedIssueNumbers,
} from "../issue-references";
import { MAX_BODY_CHARS } from "../limits";

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

	it("ignores references in an unterminated fence at the end of the body", () => {
		// CommonMark: an unclosed fence runs to the end of the text, including
		// when its opening line is the last one and has no trailing newline.
		expect(getReferencedIssueNumbers("before\n```\n#12")).toEqual([]);
		expect(getReferencedIssueNumbers("before\n```#12")).toEqual([]);
		expect(getReferencedIssueNumbers("before\n~~~\n#12")).toEqual([]);
	});

	it("parses a pathological body without quadratic work", () => {
		// The pattern this replaced (/(`+)[\s\S]*?\1/g) backtracked over every
		// opening run length, so a run of MAX_BODY_CHARS backticks cost ~4.5 s of
		// CPU — and this runs on every comment, issue and PR write while the
		// caller holds the repository lock, plus on every pushed commit message,
		// which the request cap bounds at 50 MB. The margin is wide enough not to
		// flake and narrow enough to fail loudly if that cost comes back.
		const body = `see ${"`".repeat(MAX_BODY_CHARS)} then\nfixes #7`;
		const started = performance.now();
		expect(getClosingIssueNumbers(body)).toEqual([7]);
		expect(performance.now() - started).toBeLessThan(500);
	});

	it("treats a long run of backticks as an unclosed fence, not inline code", () => {
		// CommonMark: three or more backticks at the start of a line open a
		// fence, and an unclosed fence runs to the end of the text, so nothing
		// after it is a reference.
		expect(
			getReferencedIssueNumbers(`${"`".repeat(MAX_BODY_CHARS)}\n#7`),
		).toEqual([]);
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
