export {
	type BlameCommit,
	BlameLimitError,
	type BlameLimitMetric,
	type BlameOptions,
	type BlameRange,
	type BlameResult,
	getBlame,
	MAX_BLAME_BYTES,
	MAX_BLAME_DIFF_WORK,
	MAX_BLAME_FILE_BYTES,
	MAX_BLAME_LINES,
} from "./blame.js";
export {
	assertBranchExists,
	assertSafeBranchName,
	type Branch,
	createBranchFrom,
	deleteBranchByName,
	findRefCollision,
	listBranches,
	listPullHeadRefNames,
	listTags,
	resolveLooseRefFast,
	type Tag,
} from "./branch.js";
export {
	authorNow,
	type CommitAuthor,
	commitFilesToBare,
	deleteFileFromBare,
	writeCommitToBare,
} from "./commit.js";
export {
	type DiffEntry,
	type DiffFile,
	DiffLimitError,
	type DiffLimits,
	type DiffResult,
	getCommitDiff,
	getDiffBetweenRefs,
	getDirectDiffBetweenRefs,
	getMergeBaseOid,
	MAX_DIFF_BYTES,
	MAX_DIFF_FILES,
	MAX_DIFF_TEXT_BYTES,
} from "./diff.js";
export {
	BANNER_WALK_DEPTH,
	type FileHistoryResult,
	getFileHistory,
} from "./file-history.js";
export {
	type CommitInfo,
	type CommitLogOptions,
	type CommitSummary,
	type GitIdentity,
	getBlob,
	getCommit,
	getCommitHistory,
	getCommitLog,
	getFileContent,
	getTreeFromRef,
	HISTORY_WALK_DEPTH,
	peelToCommit,
	resolveCommit,
	resolveCommitOid,
	summarizeCommit,
} from "./history.js";
export { getLastCommitsForTree } from "./last-commit.js";
export { analyzeMerge, fastForwardMerge, type MergeAnalysis } from "./merge.js";
export { type PackedWritesOptions, withPackedWrites } from "./packed-writes.js";
export {
	getSubmodules,
	parseGitmodules,
	type SubmoduleConfig,
} from "./submodules.js";
export {
	deleteFromTree,
	findTreeEntry,
	listTreeEntries,
	type TreeEntry,
	upsertTree,
} from "./tree.js";
export {
	type IsoGitFs,
	type OpsHooks,
	type Repo,
	type ResultCache,
	resultKeyPrefixes,
} from "./types.js";
