import { createParsedObjectCache } from "git-edge";
import type { OpsHooks } from "git-fs-s3/ops";
import { GIT_CACHE_MAX_BYTES, GIT_CACHE_TTL_MS } from "./config";
import { prefetchAllPacks } from "./git-fs";
import type { RepoKind } from "./git-storage-naming";
import { perfNote, perfStep } from "./perf-log";

const resultCache = createParsedObjectCache({
	maxSize: GIT_CACHE_MAX_BYTES / 4,
	ttl: GIT_CACHE_TTL_MS,
});

export function invalidateResultCache(prefix: string): void {
	resultCache.invalidatePrefix(prefix);
}

/**
 * Ops hooks over the process-wide parsed-object cache. `prefetch` warms the
 * packs of whichever repository or gist the hooks are built for.
 */
export function opsHooksWith(prefetch: () => Promise<void>): OpsHooks {
	return { resultCache, step: perfStep, onNote: perfNote, prefetch };
}

export function opsHooksFor(
	ownerKey: string,
	repoName: string,
	kind: RepoKind = "repo",
): OpsHooks {
	return opsHooksWith(() => prefetchAllPacks(ownerKey, repoName, kind));
}
