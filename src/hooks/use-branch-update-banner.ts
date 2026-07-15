import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	queryKeys,
	repositoryBranchHeadQueryOptions,
} from "@/lib/query-options";

/**
 * Detects a push landing on `branchName` while the user is looking at
 * (possibly long-cached) tree/commit data for it, without ever blocking the
 * initial render on a live check — see repositoryBranchHeadQueryOptions for
 * the polling query this consumes.
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
	const { data } = useQuery(
		repositoryBranchHeadQueryOptions({ repoId, branchName }),
	);
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
		if (!data?.sha) return;
		if (baselineRef.current === null) {
			baselineRef.current = data.sha;
			return;
		}
		if (data.sha !== baselineRef.current) {
			setHasUpdate(true);
		}
	}, [data?.sha]);

	const reload = useCallback(async () => {
		// Guard against a second click landing mid-reload: re-entering this with a
		// stale `data.sha` closure while the first invalidation is still in flight
		// is what caused the second click to "undo" the first (it could re-baseline
		// off older data than the first click's own refetch was about to produce).
		if (isReloading) return;
		setIsReloading(true);
		try {
			// invalidateQueries' returned promise resolves only once every matched
			// *active* query (tree, commits, last-commits, branches, branch-head, ...
			// all nested under ["repos", repoId, ...] — see query-options.ts) has
			// finished refetching. Awaiting it (instead of firing-and-forgetting) is
			// what guarantees the banner never dismisses itself before slower
			// queries like the commit-log walk behind CommitSummaryBar have actually
			// landed fresh data — previously `hasUpdate` cleared as soon as the fast
			// branch-head poll refetched, well before that walk finished, so the
			// summary bar could sit on stale data after the banner was already gone.
			await queryClient.invalidateQueries({ queryKey: ["repos", repoId] });
		} finally {
			// Re-baseline off whatever the branch-head query now holds post-refetch,
			// not the pre-click snapshot — a push landing during the reload itself
			// must still be detected as a further update, not silently swallowed.
			const refreshed = queryClient.getQueryData<{ sha: string | null }>(
				queryKeys.repoBranchHead(repoId, branchName),
			);
			baselineRef.current = refreshed?.sha ?? baselineRef.current;
			setHasUpdate(false);
			setIsReloading(false);
		}
	}, [queryClient, repoId, branchName, isReloading]);

	return { hasUpdate, reload, isReloading };
}
