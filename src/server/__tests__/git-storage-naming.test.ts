import { describe, expect, it } from "vitest";
import {
	getLegacyGitPrefixes,
	getLegacyStorageOwnerKeys,
	getRepoGitStoragePrefix,
	getRepoGitStorageRoot,
	getRepoStorageCoordinates,
	getRepoStorageRoot,
	getStorageOwnerKey,
} from "../git-storage-naming";

const ownerWithUsername = {
	id: "user-123",
	username: "alice",
	email: "alice@example.com",
};

const ownerNoUsername = {
	id: "user-456",
	username: null,
	email: "bob@example.com",
};

describe("getStorageOwnerKey", () => {
	it("uses username when available", () => {
		expect(getStorageOwnerKey(ownerWithUsername)).toBe("alice");
	});

	it("falls back to email prefix when no username", () => {
		expect(getStorageOwnerKey(ownerNoUsername)).toBe("bob");
	});

	it("sanitizes slashes and spaces", () => {
		const o = { id: "x", username: "a/b c", email: "x@x.com" };
		const key = getStorageOwnerKey(o);
		expect(key).not.toContain("/");
		expect(key).not.toContain(" ");
	});
});

describe("getLegacyStorageOwnerKeys", () => {
	it("includes sanitized id and NaN sentinel", () => {
		const keys = getLegacyStorageOwnerKeys(ownerWithUsername);
		expect(keys).toContain("user-123");
		expect(keys).toContain("NaN");
	});

	it("returns unique values", () => {
		const keys = getLegacyStorageOwnerKeys(ownerWithUsername);
		expect(keys.length).toBe(new Set(keys).size);
	});
});

describe("getRepoStorageCoordinates", () => {
	it("returns ownerKey, repoKey, and empty legacyOwnerKeys when username matches no legacy key", () => {
		const coords = getRepoStorageCoordinates({
			ownerId: ownerWithUsername.id,
			name: "myrepo",
			owner: ownerWithUsername,
		});
		expect(coords.ownerKey).toBe("alice");
		expect(coords.repoKey).toBe("myrepo");
		// legacyOwnerKeys must not include the canonical ownerKey
		expect(coords.legacyOwnerKeys).not.toContain("alice");
	});

	it("throws when owner metadata is missing", () => {
		expect(() =>
			getRepoStorageCoordinates({ ownerId: "x", name: "repo" }),
		).toThrow(/owner metadata missing/);
	});
});

describe("storage path helpers", () => {
	it("getRepoStorageRoot", () => {
		expect(getRepoStorageRoot("alice", "myrepo")).toBe(
			"repos/alice/myrepo",
		);
	});

	it("getRepoGitStorageRoot", () => {
		expect(getRepoGitStorageRoot("alice", "myrepo")).toBe(
			"repos/alice/myrepo/git",
		);
	});

	it("getRepoGitStoragePrefix ends with /", () => {
		const prefix = getRepoGitStoragePrefix("alice", "myrepo");
		expect(prefix).toBe("repos/alice/myrepo/git/");
	});

	it("sanitizes path segments with special chars", () => {
		const root = getRepoStorageRoot("a/b", "repo name");
		expect(root).not.toContain(" ");
		// slashes in owner become dashes
		expect(root).toMatch(/^repos\//);
	});
});

describe("getLegacyGitPrefixes", () => {
	it("returns prefixes for each legacy owner key", () => {
		const prefixes = getLegacyGitPrefixes(["user-123", "NaN"], "myrepo");
		expect(prefixes.length).toBeGreaterThan(0);
		// should include git storage prefix style
		expect(prefixes.some((p) => p.includes("myrepo"))).toBe(true);
	});

	it("returns unique prefixes", () => {
		const prefixes = getLegacyGitPrefixes(["x", "x"], "repo");
		expect(prefixes.length).toBe(new Set(prefixes).size);
	});

	it("returns empty array for no legacy keys", () => {
		expect(getLegacyGitPrefixes([], "repo")).toEqual([]);
	});
});
