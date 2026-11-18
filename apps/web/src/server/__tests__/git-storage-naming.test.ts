import { describe, expect, it } from "vitest";
import { STORAGE_NAME_RE } from "#/lib/storage-name";
import {
	GIST_ID_RE,
	getGistGitStoragePrefix,
	getGistGitStorageRoot,
	getRepoGitStoragePrefix,
	getRepoGitStorageRoot,
	getRepoWikiGitStorageRoot,
	getRepoWikiStoragePrefix,
	ownerKeyOf,
	parseGistGitStorageKey,
	parseRepoGitStorageKey,
} from "../git-storage-naming";

describe("storage keys", () => {
	it("lays a repository out under repos/{owner}/{name}/git", () => {
		expect(getRepoGitStorageRoot("alice", "my.repo")).toBe(
			"repos/alice/my.repo/git",
		);
		expect(getRepoGitStoragePrefix("alice", "r")).toBe("repos/alice/r/git/");
		expect(ownerKeyOf({ owner: { login: "alice" } })).toBe("alice");
	});

	it.each([[".."], ["."], ["a/b"], ["a\\b"], [""], ["-x"], ["x-"], ["a b"]])(
		"refuses the unsafe segment %j instead of rewriting it",
		(segment) => {
			expect(STORAGE_NAME_RE.test(segment)).toBe(false);
			expect(() => getRepoGitStorageRoot(segment, "r")).toThrow(/Invalid/);
			expect(() => getRepoGitStorageRoot("alice", segment)).toThrow(/Invalid/);
		},
	);

	it("lays a wiki out beside the git data", () => {
		expect(getRepoWikiGitStorageRoot("alice", "r")).toBe(
			"repos/alice/r/wiki/git",
		);
		expect(getRepoWikiStoragePrefix("alice", "r")).toBe("repos/alice/r/wiki/");
		expect(getRepoGitStorageRoot("alice", "r", "wiki")).toBe(
			"repos/alice/r/wiki/git",
		);
	});

	it("parses a key back into its parts", () => {
		expect(parseRepoGitStorageKey("repos/alice/r/git/refs/heads/main")).toEqual(
			{
				ownerKey: "alice",
				repoName: "r",
				wiki: false,
				gitdirPath: "refs/heads/main",
			},
		);
		expect(
			parseRepoGitStorageKey("repos/alice/r/git/objects/pack/"),
		).toMatchObject({
			gitdirPath: "objects/pack/",
		});
		expect(
			parseRepoGitStorageKey("repos/alice/r/wiki/git/refs/heads/master"),
		).toEqual({
			ownerKey: "alice",
			repoName: "r",
			wiki: true,
			gitdirPath: "refs/heads/master",
		});
		expect(parseRepoGitStorageKey("other/alice/r/git/HEAD")).toBeNull();
		expect(parseRepoGitStorageKey("repos/alice/r/git")).toBeNull();
		expect(parseRepoGitStorageKey("repos/alice/r/wiki/git")).toBeNull();
		expect(parseRepoGitStorageKey("repos/alice/r/wiki/HEAD")).toBeNull();
	});
});

describe("gist storage keys", () => {
	const GIST_ID = "0123456789abcdef0123456789abcdef";

	it("lays a gist out under gists/{id}/git", () => {
		expect(getGistGitStorageRoot(GIST_ID)).toBe(`gists/${GIST_ID}/git`);
		expect(getGistGitStoragePrefix(GIST_ID)).toBe(`gists/${GIST_ID}/git/`);
	});

	it.each([
		[".."],
		["."],
		["a/b"],
		["0123456789ABCDEF0123456789ABCDEF"],
		["0123456789abcdef"],
		["0123456789abcdef0123456789abcdeg"],
		[""],
	])("refuses the invalid id %j", (id) => {
		expect(GIST_ID_RE.test(id)).toBe(false);
		expect(() => getGistGitStorageRoot(id)).toThrow(/Invalid/);
	});

	it("parses a key back into its parts", () => {
		expect(
			parseGistGitStorageKey(`gists/${GIST_ID}/git/refs/heads/master`),
		).toEqual({ gistId: GIST_ID, gitdirPath: "refs/heads/master" });
		expect(
			parseGistGitStorageKey(`gists/${GIST_ID}/git/objects/pack/`),
		).toMatchObject({ gitdirPath: "objects/pack/" });
		expect(parseGistGitStorageKey(`other/${GIST_ID}/git/HEAD`)).toBeNull();
		expect(parseGistGitStorageKey(`gists/${GIST_ID}/git`)).toBeNull();
		expect(parseGistGitStorageKey("gists/nothex/git/HEAD")).toBeNull();
	});
});
