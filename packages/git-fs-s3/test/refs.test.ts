import { describe, expect, it } from "vitest";
import {
	isFullSha,
	isPullHeadRef,
	isSafeBranchName,
	isSafeFullRefName,
	isSafeRefName,
	isSafeRepoPath,
	pullHeadRefName,
	qualifyBranchRef,
} from "../src/index.js";

const SHA = "a".repeat(40);

describe("isSafeFullRefName", () => {
	it("accepts qualified branch and tag refs", () => {
		expect(isSafeFullRefName("refs/heads/main")).toBe(true);
		expect(isSafeFullRefName("refs/heads/feature/x-1")).toBe(true);
		expect(isSafeFullRefName("refs/tags/v1.0.0")).toBe(true);
	});

	it("rejects unqualified, traversal-laden, and malformed refs", () => {
		expect(isSafeFullRefName("main")).toBe(false);
		expect(isSafeFullRefName("refs/heads/../../../etc/passwd")).toBe(false);
		expect(isSafeFullRefName("refs/heads/a..b")).toBe(false);
		expect(isSafeFullRefName("refs/heads/a b")).toBe(false);
		expect(isSafeFullRefName("refs/heads/a.lock")).toBe(false);
		expect(isSafeFullRefName("refs/heads/a\\b")).toBe(false);
		expect(isSafeFullRefName("refs/remotes/origin/main")).toBe(false);
	});
});

describe("isSafeBranchName", () => {
	it("accepts ordinary branch names", () => {
		expect(isSafeBranchName("main")).toBe(true);
		expect(isSafeBranchName("feature/nested-name")).toBe(true);
		expect(isSafeBranchName("v1.2.3")).toBe(true);
	});

	it("rejects prefixed, SHA-shaped, HEAD, and traversal names", () => {
		expect(isSafeBranchName("")).toBe(false);
		expect(isSafeBranchName("HEAD")).toBe(false);
		expect(isSafeBranchName("refs/heads/main")).toBe(false);
		expect(isSafeBranchName(SHA)).toBe(false);
		expect(isSafeBranchName("../escape")).toBe(false);
		expect(isSafeBranchName("a..b")).toBe(false);
		expect(isSafeBranchName(".hidden")).toBe(false);
		expect(isSafeBranchName("name.lock")).toBe(false);
		expect(isSafeBranchName("a@{b}")).toBe(false);
	});
});

describe("isSafeRefName / isFullSha", () => {
	it("accepts both branch names and full SHAs", () => {
		expect(isSafeRefName("main")).toBe(true);
		expect(isSafeRefName(SHA)).toBe(true);
		expect(isSafeRefName(SHA.toUpperCase())).toBe(true);
		expect(isFullSha(SHA)).toBe(true);
		expect(isFullSha(SHA.slice(1))).toBe(false);
		expect(isSafeRefName("../nope")).toBe(false);
	});
});

describe("isSafeRepoPath", () => {
	it("accepts relative paths and rejects escapes", () => {
		expect(isSafeRepoPath("src/index.ts")).toBe(true);
		expect(isSafeRepoPath("README.md")).toBe(true);
		expect(isSafeRepoPath("/abs/path")).toBe(false);
		expect(isSafeRepoPath("a/../b")).toBe(false);
		expect(isSafeRepoPath(".git/config")).toBe(false);
		expect(isSafeRepoPath(".GIT/config")).toBe(false);
		expect(isSafeRepoPath("a\0b")).toBe(false);
		expect(isSafeRepoPath("vendor/.gitignore")).toBe(true);
	});
});

describe("qualifyBranchRef", () => {
	it("qualifies bare names and leaves everything else alone", () => {
		expect(qualifyBranchRef("main")).toBe("refs/heads/main");
		expect(qualifyBranchRef("refs/heads/main")).toBe("refs/heads/main");
		expect(qualifyBranchRef("refs/tags/v1")).toBe("refs/tags/v1");
		expect(qualifyBranchRef("HEAD")).toBe("HEAD");
		expect(qualifyBranchRef(SHA)).toBe(SHA);
	});
});

describe("pull head refs", () => {
	it("accepts exactly refs/pull/<n>/head for a positive number", () => {
		expect(isPullHeadRef("refs/pull/1/head")).toBe(true);
		expect(isPullHeadRef("refs/pull/315/head")).toBe(true);
		expect(isPullHeadRef("refs/pull/999999999/head")).toBe(true);
	});

	it("rejects other pull-shaped names", () => {
		for (const ref of [
			"refs/pull/0/head",
			"refs/pull/01/head",
			"refs/pull/1000000000/head",
			"refs/pull/x/head",
			"refs/pull/1/merge",
			"refs/pull/1/head/extra",
			"refs/pull/1/head.lock",
			"refs/pull/../head",
			"pull/1/head",
			"refs/heads/pull/1/head",
		]) {
			expect(isPullHeadRef(ref), ref).toBe(false);
		}
	});

	it("is never a pushable branch or tag ref", () => {
		expect(isSafeFullRefName("refs/pull/1/head")).toBe(false);
	});

	it("builds the name from a pull request number", () => {
		expect(pullHeadRefName(42)).toBe("refs/pull/42/head");
		expect(() => pullHeadRefName(0)).toThrow(RangeError);
		expect(() => pullHeadRefName(-1)).toThrow(RangeError);
		expect(() => pullHeadRefName(1.5)).toThrow(RangeError);
	});
});
