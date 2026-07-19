/**
 * Tests for use-branch-update-banner hook — polling, baseline detection,
 * and reload behavior.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-query", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-query")>();
	return {
		...actual,
		useQuery: vi.fn(),
		useQueryClient: vi.fn(),
	};
});

vi.mock("@/lib/query-options", () => ({
	queryKeys: {
		repoCommits: (
			repoId: number,
			branch: string,
			limit: number,
			skip: number,
		) => ["repos", repoId, "commits", branch, limit, skip],
	},
	repositoryLatestCommitQueryOptions: vi.fn(() => ({})),
}));

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useBranchUpdateBanner } from "../use-branch-update-banner";

const mockUseQuery = vi.mocked(useQuery);
const mockUseQueryClient = vi.mocked(useQueryClient);

function setupQueryClient() {
	const invalidateQueries = vi.fn(async () => undefined);
	const getQueryData = vi.fn(() => undefined);
	const qc = { invalidateQueries, getQueryData };
	mockUseQueryClient.mockReturnValue(qc as never);
	return qc;
}

describe("useBranchUpdateBanner", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns hasUpdate=false and no reloading initially", () => {
		mockUseQuery.mockReturnValue({ data: undefined } as never);
		setupQueryClient();

		const { result } = renderHook(() => useBranchUpdateBanner(1, "main"));
		expect(result.current.hasUpdate).toBe(false);
		expect(result.current.isReloading).toBe(false);
	});

	// Regression guard: nothing else exercises these values (useQuery itself
	// is mocked above), so a future edit dropping refetchInterval or
	// refetchIntervalInBackground — silently turning this into a hook that
	// only ever checks for updates on mount/window-focus — would otherwise
	// pass every other test in this file.
	it("polls every 60s, including while the tab is backgrounded", () => {
		mockUseQuery.mockReturnValue({ data: undefined } as never);
		setupQueryClient();

		renderHook(() => useBranchUpdateBanner(1, "main"));

		expect(mockUseQuery).toHaveBeenCalledWith(
			expect.objectContaining({
				refetchInterval: 60_000,
				refetchIntervalInBackground: true,
				enabled: true,
			}),
		);
	});

	it("sets baseline on first data arrival", () => {
		mockUseQuery.mockReturnValue({
			data: [{ sha: "abc123" }],
		} as never);
		setupQueryClient();

		const { result } = renderHook(() => useBranchUpdateBanner(1, "main"));
		expect(result.current.hasUpdate).toBe(false);
	});

	it("detects update when sha changes from baseline", () => {
		// First render: baseline = "abc123"
		mockUseQuery.mockReturnValue({
			data: [{ sha: "abc123" }],
		} as never);
		setupQueryClient();

		const { result, rerender } = renderHook(() =>
			useBranchUpdateBanner(1, "main"),
		);
		expect(result.current.hasUpdate).toBe(false);

		// Simulate poll returning different sha
		mockUseQuery.mockReturnValue({
			data: [{ sha: "def456" }],
		} as never);
		rerender();
		expect(result.current.hasUpdate).toBe(true);
	});

	it("reload invalidates queries and resets hasUpdate", async () => {
		const qc = setupQueryClient();
		mockUseQuery.mockReturnValue({
			data: [{ sha: "abc123" }],
		} as never);

		const { result, rerender } = renderHook(() =>
			useBranchUpdateBanner(1, "main"),
		);

		// Trigger update
		mockUseQuery.mockReturnValue({
			data: [{ sha: "def456" }],
		} as never);
		rerender();
		expect(result.current.hasUpdate).toBe(true);

		// After reload, getQueryData returns new sha
		qc.getQueryData.mockReturnValue([{ sha: "def456" }] as never);

		await act(async () => {
			await result.current.reload();
		});

		expect(qc.invalidateQueries).toHaveBeenCalledWith({
			queryKey: ["repos", 1],
		});
		expect(result.current.hasUpdate).toBe(false);
		expect(result.current.isReloading).toBe(false);
	});

	it("reset baseline when repoId/branchName changes", () => {
		mockUseQuery.mockReturnValue({
			data: [{ sha: "abc123" }],
		} as never);
		setupQueryClient();

		const { result, rerender } = renderHook(
			({ repoId, branch }) => useBranchUpdateBanner(repoId, branch),
			{ initialProps: { repoId: 1, branch: "main" } },
		);
		expect(result.current.hasUpdate).toBe(false);

		// Change repo — should reset baseline, no update detected
		mockUseQuery.mockReturnValue({
			data: [{ sha: "xyz789" }],
		} as never);
		rerender({ repoId: 2, branch: "main" });
		expect(result.current.hasUpdate).toBe(false);
	});

	it("does not reload when already reloading", async () => {
		const qc = setupQueryClient();
		// Make invalidateQueries slow
		qc.invalidateQueries.mockImplementation(
			() => new Promise((resolve) => setTimeout(resolve, 100)),
		);

		mockUseQuery.mockReturnValue({
			data: [{ sha: "abc123" }],
		} as never);

		const { result } = renderHook(() => useBranchUpdateBanner(1, "main"));

		// First reload — act runs the callback synchronously, so reloadPromise
		// is assigned before we await it below.
		let reloadPromise: Promise<void> | undefined;
		act(() => {
			reloadPromise = result.current.reload();
		});

		// Second reload should be a no-op
		act(() => {
			result.current.reload();
		});

		expect(qc.invalidateQueries).toHaveBeenCalledTimes(1);

		await act(async () => {
			if (reloadPromise) await reloadPromise;
		});
	});
});
