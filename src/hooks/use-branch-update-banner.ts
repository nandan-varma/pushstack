import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { repositoryBranchHeadQueryOptions } from "@/lib/query-options";

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

	const reload = useCallback(() => {
		baselineRef.current = data?.sha ?? null;
		setHasUpdate(false);
		// Every repo-scoped query key (tree, commits, last-commits, branches, file
		// content, ...) is nested under ["repos", repoId, ...] — see query-options.ts
		// — so this one partial-match invalidation busts everything a push could
		// have changed, and (with the default refetchType: "active") only refetches
		// whatever's actually mounted right now.
		queryClient.invalidateQueries({ queryKey: ["repos", repoId] });
	}, [data?.sha, queryClient, repoId]);

	return { hasUpdate, reload };
}
