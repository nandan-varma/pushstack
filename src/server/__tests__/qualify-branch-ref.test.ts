import { describe, expect, it } from "vitest";
import { qualifyBranchRef } from "../git-repo-storage";

describe("qualifyBranchRef", () => {
	it("qualifies a bare branch name to refs/heads/", () => {
		expect(qualifyBranchRef("main")).toBe("refs/heads/main");
		expect(qualifyBranchRef("feature/x")).toBe("refs/heads/feature/x");
	});

	it("passes through already-qualified refs unchanged", () => {
		expect(qualifyBranchRef("refs/heads/main")).toBe("refs/heads/main");
		expect(qualifyBranchRef("refs/tags/v1.0")).toBe("refs/tags/v1.0");
		expect(qualifyBranchRef("refs/remotes/origin/main")).toBe(
			"refs/remotes/origin/main",
		);
	});

	it("passes through HEAD unchanged", () => {
		expect(qualifyBranchRef("HEAD")).toBe("HEAD");
	});

	it("passes through a 40-char hex SHA unchanged", () => {
		const sha = "a".repeat(40);
		expect(qualifyBranchRef(sha)).toBe(sha);
	});

	it("does NOT treat a 39-char hex string as a SHA", () => {
		const shortHex = "a".repeat(39);
		expect(qualifyBranchRef(shortHex)).toBe(`refs/heads/${shortHex}`);
	});

	it("does NOT treat a 41-char hex string as a SHA", () => {
		const longHex = "a".repeat(41);
		expect(qualifyBranchRef(longHex)).toBe(`refs/heads/${longHex}`);
	});

	it("qualifies mixed-case branch names", () => {
		expect(qualifyBranchRef("Fix-Bug")).toBe("refs/heads/Fix-Bug");
	});

	it("qualifies branch names with dots and underscores", () => {
		expect(qualifyBranchRef("release-1.0_hotfix")).toBe(
			"refs/heads/release-1.0_hotfix",
		);
	});
});
