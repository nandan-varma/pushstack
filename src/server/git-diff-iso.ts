/**
 * Diff computation — thin wrapper around @nandan-varma/git-fs-s3/ops's
 * getCommitDiff/getDiffBetweenRefs (extracted from an earlier version of
 * this exact file, which also fixed a real bug along the way: the previous
 * root-commit diff here only listed top-level blobs, silently omitting every
 * file in a subdirectory of a repo's first commit — the library version
 * walks the whole tree recursively).
 */
import {
	type DiffFile,
	type DiffResult,
	getDiffBetweenRefs,
	getCommitDiff as opsGetCommitDiff,
} from "@nandan-varma/git-fs-s3/ops";
import { getRepoOptions } from "./git-repo-storage";

export type { DiffFile, DiffResult };

export async function getCommitDiff(
	ownerKey: string,
	repoName: string,
	commitSha: string,
): Promise<DiffResult> {
	const repo = await getRepoOptions(ownerKey, repoName);
	return opsGetCommitDiff(repo, commitSha);
}

export async function getDiffBetweenBranches(
	ownerKey: string,
	repoName: string,
	baseBranch: string,
	compareBranch: string,
): Promise<DiffResult> {
	const repo = await getRepoOptions(ownerKey, repoName);
	return getDiffBetweenRefs(repo, baseBranch, compareBranch);
}
