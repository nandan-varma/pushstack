/**
 * Tests for git-last-commit.ts's wiring: resolving (ownerKey, repoName) to a
 * Repo, passing the fixed HISTORY_WALK_DEPTH, and only passing a prefetch
 * hook when R2 is configured (mirrors the same isR2Configured-gated prefetch
 * pattern as git-history-ops.ts). The walk algorithm itself lives in and is
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

const isR2ConfiguredMock = vi.fn(() => true);
vi.mock("#/lib/r2", () => ({
	isR2Configured: isR2ConfiguredMock,
}));

const getRepoOptionsMock = vi.fn(() =>
	Promise.resolve({ fs: {}, gitdir: "/fake/gitdir" }),
);
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
		isR2ConfiguredMock.mockReturnValue(true);
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

	it("passes a prefetch hook when R2 is configured, calling prefetchAllPacks for this repo", async () => {
		isR2ConfiguredMock.mockReturnValue(true);

		const { getLastCommitsForTree } = await import("../git-last-commit");
		await getLastCommitsForTree("owner", "repo", "main", "");

		const hooks = opsGetLastCommitsForTreeMock.mock.calls[0][2];
		await hooks?.prefetch?.();
		expect(prefetchAllPacksMock).toHaveBeenCalledWith("owner", "repo");
	});

	it("omits the prefetch hook when R2 is not configured", async () => {
		isR2ConfiguredMock.mockReturnValue(false);

		const { getLastCommitsForTree } = await import("../git-last-commit");
		await getLastCommitsForTree("owner", "repo", "main", "");

		const hooks = opsGetLastCommitsForTreeMock.mock.calls[0][2];
		expect(hooks?.prefetch).toBeUndefined();
	});
});
