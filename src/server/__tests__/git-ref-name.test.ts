import { describe, expect, it } from "vitest";
import {
	isSafeBranchName,
	isSafeFullRefName,
	isSafeRefName,
	isSafeRepoPath,
	safeBranchNameSchema,
	safeCommitShaSchema,
	safeRefNameSchema,
	safeRepoPathSchema,
} from "../git-ref-name";

describe("isSafeBranchName", () => {
	it.each([
		"main",
		"feature/foo",
		"release-1.0",
		"a",
		"fix_bug",
		"v1.2.3",
	])("accepts well-formed branch name %j", (name) => {
		expect(isSafeBranchName(name)).toBe(true);
	});

	it.each([
		"",
		"..",
		"../../etc/passwd",
		"feature/../../../etc",
		"refs/heads/main",
		"refs/heads/../../other-owner/other-repo/git/refs/heads/main",
		"HEAD",
		"a".repeat(40), // looks like an oid
		"branch.lock",
		"foo/.lock",
		"branch\0name",
		"branch name", // control/space char
		"branch~1",
		"branch^",
		"branch:x",
		"branch?x",
		"branch*x",
		"branch[x]",
		"branch\\x",
		"a@{b}",
		"@",
		"/leading-slash",
		"trailing-slash/",
		"double//slash",
		".leading-dot",
		"trailing-dot.",
	])("rejects unsafe branch name %j", (name) => {
		expect(isSafeBranchName(name)).toBe(false);
	});
});

describe("isSafeFullRefName", () => {
	it.each([
		"refs/heads/main",
		"refs/heads/feature/foo",
		"refs/tags/v1.0.0",
	])("accepts well-formed full ref %j", (ref) => {
		expect(isSafeFullRefName(ref)).toBe(true);
	});

	it.each([
		"main", // missing refs/ prefix
		"refs/heads/../../other-owner/other-repo/git/refs/heads/main",
		"refs/heads/..",
		"refs/notes/foo", // not heads or tags
		"refs/heads/",
		"refs/heads/foo.lock",
		"refs/heads/foo bar",
	])("rejects unsafe full ref %j", (ref) => {
		expect(isSafeFullRefName(ref)).toBe(false);
	});
});

describe("safeBranchNameSchema", () => {
	it("parses a valid branch name", () => {
		expect(safeBranchNameSchema.parse("feature/x")).toBe("feature/x");
	});

	it("rejects a path-traversal branch name", () => {
		expect(() =>
			safeBranchNameSchema.parse(
				"../../other-owner/other-repo/git/refs/heads/main",
			),
		).toThrow();
	});

	it("rejects an empty branch name", () => {
		expect(() => safeBranchNameSchema.parse("")).toThrow();
	});
});

describe("isSafeRefName", () => {
	it.each([
		"main",
		"feature/foo",
		"a".repeat(40),
		"A".repeat(40),
	])("accepts branch name or full commit sha %j", (value) => {
		expect(isSafeRefName(value)).toBe(true);
	});

	it.each([
		"",
		"..",
		"../../etc/passwd",
		"refs/heads/main",
		"HEAD",
		"branch\0name",
	])("rejects unsafe ref name %j", (value) => {
		expect(isSafeRefName(value)).toBe(false);
	});
});

describe("safeRefNameSchema", () => {
	it("accepts a branch name", () => {
		expect(safeRefNameSchema.parse("main")).toBe("main");
	});

	it("accepts a full commit sha", () => {
		const sha = "b".repeat(40);
		expect(safeRefNameSchema.parse(sha)).toBe(sha);
	});

	it("rejects a path-traversal value", () => {
		expect(() =>
			safeRefNameSchema.parse(
				"../../other-owner/other-repo/git/refs/heads/main",
			),
		).toThrow();
	});
});

describe("safeCommitShaSchema", () => {
	it("accepts a full 40-hex commit sha", () => {
		const sha = "c".repeat(40);
		expect(safeCommitShaSchema.parse(sha)).toBe(sha);
	});

	it.each([
		"",
		"not-a-sha",
		"a".repeat(39),
		"g".repeat(40),
	])("rejects non-sha value %j", (value) => {
		expect(() => safeCommitShaSchema.parse(value)).toThrow();
	});
});

describe("isSafeRepoPath", () => {
	it.each([
		"README.md",
		"src/index.ts",
		"a/b/c.txt",
	])("accepts well-formed path %j", (p) => {
		expect(isSafeRepoPath(p)).toBe(true);
	});

	it.each([
		"/etc/passwd",
		"../secret",
		"a/../../etc/passwd",
		".git/config",
		".GIT/config",
		"foo\0bar",
	])("rejects unsafe path %j", (p) => {
		expect(isSafeRepoPath(p)).toBe(false);
	});
});

describe("safeRepoPathSchema", () => {
	it("accepts a relative path", () => {
		expect(safeRepoPathSchema.parse("src/index.ts")).toBe("src/index.ts");
	});

	it("rejects a traversal path", () => {
		expect(() => safeRepoPathSchema.parse("../secret")).toThrow();
	});
});
