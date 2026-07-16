import { describe, expect, it } from "vitest";
import {
	isSafeBranchName,
	isSafeFullRefName,
	safeBranchNameSchema,
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
