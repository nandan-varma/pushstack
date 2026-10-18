/**
 * Tests for git-last-commit.ts's wiring: resolving (ownerKey, repoName) to a
 * Repo, passing the fixed HISTORY_WALK_DEPTH, and the pack-prefetch hook
 * (same opsHooksFor wiring as git-history-ops.ts). The walk algorithm itself lives in and is
 * tested by git-fs-s3/ops — this only checks the wrapper wiring.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type LastCommitHooks = { prefetch?: () => Promise<void> };

const opsGetLastCommitsForTreeMock = vi.fn(
	(
		_repo?: unknown,
		_options?: unknown,
		_hooks?: LastCommitHooks,
	): Promise<Record<string, unknown>> => Promise.resolve({}),
);
vi.mock("git-fs-s3/ops", () => ({
	getLastCommitsForTree: opsGetLastCommitsForTreeMock,
}));

const getRepoOptionsMock = vi.fn(() => ({ fs: {}, gitdir: "/fake/gitdir" }));
vi.mock("../git-repo-storage", () => ({
	getRepoOptions: getRepoOptionsMock,
}));

const prefetchAllPacksMock = vi.fn(() => Promise.resolve());
vi.mock("../git-fs", () => ({
	prefetchAllPacks: prefetchAllPacksMock,
}));

describe("getLastCommitsForTree wrapper", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		opsGetLastCommitsForTreeMock.mockResolvedValue({});
	});

	it("resolves the repo and forwards ref/treePath/depth to the library", async () => {
		const { getLastCommitsForTree } = await import("../git-last-commit");
		await getLastCommitsForTree("owner", "repo", "main", "src");

		expect(getRepoOptionsMock).toHaveBeenCalledWith("owner", "repo");
		expect(opsGetLastCommitsForTreeMock).toHaveBeenCalledWith(
			{ fs: {}, gitdir: "/fake/gitdir" },
			{ ref: "main", treePath: "src", depth: 400 },
			expect.objectContaining({
				resultCache: expect.anything(),
				step: expect.any(Function),
				onNote: expect.any(Function),
				prefetch: expect.any(Function),
			}),
		);
	});

	it("returns exactly what the library returns", async () => {
		opsGetLastCommitsForTreeMock.mockResolvedValueOnce({
			"a.ts": { sha: "abc", message: "init" },
		});

		const { getLastCommitsForTree } = await import("../git-last-commit");
		const result = await getLastCommitsForTree("owner", "repo", "main", "");

		expect(result).toEqual({ "a.ts": { sha: "abc", message: "init" } });
	});

	it("passes a prefetch hook calling prefetchAllPacks for this repo", async () => {
		const { getLastCommitsForTree } = await import("../git-last-commit");
		await getLastCommitsForTree("owner", "repo", "main", "");

		const hooks = opsGetLastCommitsForTreeMock.mock.calls[0][2];
		await hooks?.prefetch?.();
		expect(prefetchAllPacksMock).toHaveBeenCalledWith("owner", "repo");
	});
});
