export {
	createParsedObjectCache,
	type ParsedObjectCacheOptions,
	type ParsedObjectStore,
} from "./cache.js";
export {
	GitEdgeError,
	GitMergeConflictError,
} from "./errors.js";
export {
	MAX_RANGE_COMMITS,
	type MergeOpts,
	type MergeResult,
	type Repo,
	rebaseMerge,
	type SquashOpts,
	squashMerge,
	threeWayMerge,
} from "./merge.js";
export { getRepoCache, invalidateRepoCache } from "./repo.js";
