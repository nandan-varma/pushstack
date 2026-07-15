import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	queryKeys,
	repositoryLatestCommitQueryOptions,
} from "@/lib/query-options";

/**
 * Detects a push landing on `branchName` while the user is looking at
 * (possibly long-cached) tree/commit data for it, without ever blocking the
 * initial render on a live check.
 *
 * Polls `repositoryLatestCommitQueryOptions` — the exact same query
 * CommitSummaryBar reads for its own display — via `refetchInterval` rather
 * than a separate minimal endpoint, so there is exactly one cache entry for
 * "what's the tip commit of this branch" and the banner can never disagree
 * with what the summary bar is showing. Because it's the same query, that
 * live 20s poll also keeps CommitSummaryBar's display fresh for free, with
 * zero extra requests — only the heavier structural data (file tree,
 * per-file last-commit, branches) waits for an explicit `reload()`.
 *
 * The first successful poll establishes the "baseline" sha (not the page's
 * already-rendered data — this hook doesn't need to know what's on screen,
 * only whether the *server* has moved since it started watching). Any later
 * poll returning a different sha flips `hasUpdate`; `reload()` invalidates
 * everything scoped to this repo (tree, commits, last-commits, branches, ...
 * — all keyed under ["repos", repoId, ...]) and re-baselines.
 */
export function useBranchUpdateBanner(repoId: number, branchName: string) {
	const queryClient = useQueryClient();
	const { data } = useQuery({
		...repositoryLatestCommitQueryOptions({ repoId, branchName }),
		refetchInterval: 20_000,
		refetchOnWindowFocus: true,
		enabled: Boolean(repoId && branchName),
	});
	const latestSha = data?.[0]?.sha;
	const baselineRef = useRef<string | null>(null);
	const [hasUpdate, setHasUpdate] = useState(false);
	const [isReloading, setIsReloading] = useState(false);

	// A different repo/branch is a different "session" to watch — forget
	// whatever baseline the previous one had.
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset-on-prop-change effect; the body doesn't need to read repoId/branchName, only re-run when they change.
	useEffect(() => {
		baselineRef.current = null;
		setHasUpdate(false);
	}, [repoId, branchName]);

	useEffect(() => {
		if (!latestSha) return;
		if (baselineRef.current === null) {
			baselineRef.current = latestSha;
			return;
		}
		if (latestSha !== baselineRef.current) {
			setHasUpdate(true);
		}
	}, [latestSha]);

	const reload = useCallback(async () => {
		// Guard against a second click landing mid-reload: re-entering this with a
		// stale `latestSha` closure while the first invalidation is still in flight
		// is what caused the second click to "undo" the first (it could re-baseline
		// off older data than the first click's own refetch was about to produce).
		if (isReloading) return;
		setIsReloading(true);
		try {
			// invalidateQueries' returned promise resolves only once every matched
			// *active* query (tree, commits, last-commits, branches, this hook's own
			// polling query, ... all nested under ["repos", repoId, ...] — see
			// query-options.ts) has finished refetching. Awaiting it (instead of
			// firing-and-forgetting) is what guarantees the banner never dismisses
			// itself before every one of those queries — including the shared
			// latest-commit query CommitSummaryBar reads — has actually landed
			// fresh data.
			await queryClient.invalidateQueries({ queryKey: ["repos", repoId] });
		} finally {
			// Re-baseline off whatever the latest-commit query now holds
			// post-refetch, not the pre-click snapshot — a push landing during the
			// reload itself must still be detected as a further update, not
			// silently swallowed.
			const refreshed = queryClient.getQueryData<Array<{ sha: string }>>(
				queryKeys.repoCommits(repoId, branchName, 1, 0),
			);
			baselineRef.current = refreshed?.[0]?.sha ?? baselineRef.current;
			setHasUpdate(false);
			setIsReloading(false);
		}
	}, [queryClient, repoId, branchName, isReloading]);

	return { hasUpdate, reload, isReloading };
}
