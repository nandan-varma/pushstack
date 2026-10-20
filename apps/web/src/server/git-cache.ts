import { createParsedObjectCache } from "git-edge";
import type { OpsHooks } from "git-fs-s3/ops";
import { GIT_CACHE_MAX_BYTES, GIT_CACHE_TTL_MS } from "./config";
import { prefetchAllPacks } from "./git-fs";
import { perfNote, perfStep } from "./perf-log";

const resultCache = createParsedObjectCache({
	maxSize: GIT_CACHE_MAX_BYTES / 4,
	ttl: GIT_CACHE_TTL_MS,
});

export function invalidateResultCache(prefix: string): void {
	resultCache.invalidatePrefix(prefix);
}

export function opsHooksFor(ownerKey: string, repoName: string): OpsHooks {
	return {
		resultCache,
		step: perfStep,
		onNote: perfNote,
		prefetch: () => prefetchAllPacks(ownerKey, repoName),
	};
}
