import { describe, expect, it } from "vitest";
import {
	getRepoGitStoragePrefix,
	getRepoGitStorageRoot,
	getRepoStorageCoordinates,
	getRepoStorageRoot,
	getStorageOwnerKey,
	sanitizeStorageSegment,
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

describe("getRepoStorageCoordinates", () => {
	it("returns ownerKey and repoKey", () => {
		const coords = getRepoStorageCoordinates({
			ownerId: ownerWithUsername.id,
			name: "myrepo",
			owner: ownerWithUsername,
		});
		expect(coords.ownerKey).toBe("alice");
		expect(coords.repoKey).toBe("myrepo");
	});

	it("throws when owner metadata is missing", () => {
		expect(() =>
			getRepoStorageCoordinates({ ownerId: "x", name: "repo" }),
		).toThrow(/owner metadata missing/);
	});
});

describe("storage path helpers", () => {
	it("getRepoStorageRoot", () => {
		expect(getRepoStorageRoot("alice", "myrepo")).toBe("repos/alice/myrepo");
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
		expect(root).toMatch(/^repos\//);
	});
});

describe("sanitizeStorageSegment path traversal", () => {
	it("collapses a bare '..' segment instead of passing it through", () => {
		expect(sanitizeStorageSegment("..")).not.toBe("..");
	});

	it("collapses a bare '.' segment instead of passing it through", () => {
		expect(sanitizeStorageSegment(".")).not.toBe(".");
	});

	it("still strips slash-based traversal (existing behavior)", () => {
		expect(sanitizeStorageSegment("../../etc/passwd")).not.toContain("/");
	});

	it("getRepoStorageRoot never contains a resolvable '..' path segment", () => {
		const root = getRepoStorageRoot("owner", "..");
		expect(root.split("/")).not.toContain("..");
	});
});
