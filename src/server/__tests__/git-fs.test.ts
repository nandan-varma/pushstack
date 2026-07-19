import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../git-storage-naming", () => ({
	getRepoGitStorageRoot: (owner: string, repo: string) =>
		`repos/${owner}/${repo}/git`,
	getRepoGitStoragePrefix: (owner: string, repo: string) =>
		`repos/${owner}/${repo}/git/`,
}));

const {
	detectLooseObjectsHint,
	gitFs,
	invalidateGitStorageKeys,
	invalidateRepoGitStorage,
	prefetchAllPacks,
	refAwareTtl,
} = await import("../git-fs");

afterEach(() => {
	vi.restoreAllMocks();
});

describe("wrapper gitdir derivation", () => {
	it("detectLooseObjectsHint targets the repo's storage root", async () => {
		const spy = vi
			.spyOn(gitFs, "detectLooseObjects")
			.mockResolvedValue(undefined);
		await detectLooseObjectsHint("alice", "blog");
		expect(spy).toHaveBeenCalledWith("repos/alice/blog/git");
	});

	it("prefetchAllPacks targets the repo's storage root", async () => {
		const spy = vi.spyOn(gitFs, "prefetchPacks").mockResolvedValue(undefined);
		await prefetchAllPacks("alice", "blog");
		expect(spy).toHaveBeenCalledWith("repos/alice/blog/git");
	});

	it("invalidateRepoGitStorage sweeps the repo's storage prefix", () => {
		const spy = vi.spyOn(gitFs, "invalidate").mockReturnValue(undefined);
		invalidateRepoGitStorage("alice", "blog");
		expect(spy).toHaveBeenCalledWith("repos/alice/blog/git/");
	});

	it("invalidateGitStorageKeys evicts each key individually", () => {
		const spy = vi.spyOn(gitFs, "invalidate").mockReturnValue(undefined);
		invalidateGitStorageKeys([
			"repos/alice/blog/git/objects/pack/pack-1.pack",
			"repos/alice/blog/git/objects/pack/pack-1.idx",
		]);
		expect(spy).toHaveBeenCalledTimes(2);
		expect(spy).toHaveBeenCalledWith(
			"repos/alice/blog/git/objects/pack/pack-1.pack",
		);
	});
});

describe("structural absence", () => {
	it("answers ENOENT for packed-refs and shallow with zero R2 calls", async () => {
		// R2 env is unset in unit tests: any path that reached the store would
		// throw "R2 credentials not configured" instead of ENOENT.
		await expect(
			gitFs.promises.readFile("repos/alice/blog/git/packed-refs"),
		).rejects.toMatchObject({ code: "ENOENT" });
		await expect(
			gitFs.promises.stat("repos/alice/blog/git/shallow"),
		).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("does not treat a branch named packed-refs as absent", async () => {
		// This path is legal and must reach the store — which proves the
		// predicate is anchored to the gitdir layout, and that the store is
		// built lazily (the error is the unconfigured-R2 one, not an import
		// failure).
		await expect(
			gitFs.promises.readFile("repos/alice/blog/git/refs/heads/packed-refs"),
		).rejects.toThrow(/R2 credentials not configured/);
	});
});

describe("refAwareTtl", () => {
	it("gives a short ttl to HEAD and refs/* — the only mutable single objects in a gitdir", () => {
		expect(refAwareTtl("repos/alice/blog/git/HEAD")).toBe(5_000);
		expect(refAwareTtl("repos/alice/blog/git/refs/heads/main")).toBe(5_000);
		// The listing prefix used to enumerate branches (trailing slash, no
		// specific branch name) must match too — it's the same mutable
		// "what branches currently exist" question as reading one ref.
		expect(refAwareTtl("repos/alice/blog/git/refs/heads/")).toBe(5_000);
	});

	it("gives a short ttl to the objects/ and objects/pack/ directory listings — new packs land there on every push", () => {
		expect(refAwareTtl("repos/alice/blog/git/objects/")).toBe(5_000);
		expect(refAwareTtl("repos/alice/blog/git/objects/pack/")).toBe(5_000);
	});

	it("leaves content-addressed object *reads* (a specific known key) on the default (long) ttl", () => {
		expect(
			refAwareTtl("repos/alice/blog/git/objects/pack/pack-1.pack"),
		).toBeUndefined();
		expect(
			refAwareTtl("repos/alice/blog/git/objects/ab/cdef0123456789"),
		).toBeUndefined();
		expect(refAwareTtl("repos/alice/blog/git/config")).toBeUndefined();
	});
});
