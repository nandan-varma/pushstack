import { describe, expect, it } from "vitest";
import { STORAGE_NAME_RE } from "#/lib/storage-name";
import {
	getRepoGitStoragePrefix,
	getRepoGitStorageRoot,
	ownerKeyOf,
	parseRepoGitStorageKey,
} from "../git-storage-naming";

describe("storage keys", () => {
	it("lays a repository out under repos/{owner}/{name}/git", () => {
		expect(getRepoGitStorageRoot("alice", "my.repo")).toBe(
			"repos/alice/my.repo/git",
		);
		expect(getRepoGitStoragePrefix("alice", "r")).toBe("repos/alice/r/git/");
		expect(ownerKeyOf({ owner: { username: "alice" } })).toBe("alice");
	});

	it.each([[".."], ["."], ["a/b"], ["a\\b"], [""], ["-x"], ["x-"], ["a b"]])(
		"refuses the unsafe segment %j instead of rewriting it",
		(segment) => {
			expect(STORAGE_NAME_RE.test(segment)).toBe(false);
			expect(() => getRepoGitStorageRoot(segment, "r")).toThrow(/Invalid/);
			expect(() => getRepoGitStorageRoot("alice", segment)).toThrow(/Invalid/);
		},
	);

	it("parses a key back into its parts", () => {
		expect(parseRepoGitStorageKey("repos/alice/r/git/refs/heads/main")).toEqual(
			{
				ownerKey: "alice",
				repoName: "r",
				gitdirPath: "refs/heads/main",
			},
		);
		expect(
			parseRepoGitStorageKey("repos/alice/r/git/objects/pack/"),
		).toMatchObject({
			gitdirPath: "objects/pack/",
		});
		expect(parseRepoGitStorageKey("other/alice/r/git/HEAD")).toBeNull();
		expect(parseRepoGitStorageKey("repos/alice/r/git")).toBeNull();
	});
});
