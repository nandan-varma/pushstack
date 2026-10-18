/**
 * Branch CRUD — thin wrapper around git-fs-s3/ops's branch
 * functions (extracted from an earlier version of this exact file). What
 * stays here: resolving `(ownerKey, repoName)` to a `Repo`, and the per-repo
 * write lock around writes, which has no equivalent in the library.
 */
import {
	assertBranchExists,
	assertSafeBranchName,
	type Branch,
	createBranchFrom,
	deleteBranchByName,
	listBranches,
} from "git-fs-s3/ops";
import git from "isomorphic-git";
import { getRepoOptions, withRepositoryLock } from "./git-repo-storage";

export type { Branch };

export async function getBranches(
	ownerKey: string,
	repoName: string,
): Promise<Branch[]> {
	const repo = getRepoOptions(ownerKey, repoName);
	return listBranches(repo);
}

export async function createBranch(
	ownerKey: string,
	repoName: string,
	branchName: string,
	startPoint: string,
): Promise<void> {
	assertSafeBranchName(branchName);
	assertSafeBranchName(startPoint);
	await withRepositoryLock(ownerKey, repoName, async () => {
		const repo = getRepoOptions(ownerKey, repoName);
		await createBranchFrom(repo, branchName, startPoint);
	});
}

export async function deleteBranch(
	ownerKey: string,
	repoName: string,
	branchName: string,
): Promise<void> {
	assertSafeBranchName(branchName);
	await withRepositoryLock(ownerKey, repoName, async () => {
		const repo = getRepoOptions(ownerKey, repoName);
		await deleteBranchByName(repo, branchName);
	});
}

/**
 * Point the repository's HEAD at `branchName`: what clone/fetch advertise
 * as the default branch. Keep `repositories.defaultBranch` in step (see
 * repositories.ts's updateRepository).
 */
export async function setDefaultBranch(
	ownerKey: string,
	repoName: string,
	branchName: string,
): Promise<void> {
	assertSafeBranchName(branchName);
	await withRepositoryLock(ownerKey, repoName, async () => {
		const repo = getRepoOptions(ownerKey, repoName);
		await assertBranchExists(repo, branchName);
		await git.writeRef({
			...repo,
			ref: "HEAD",
			value: `refs/heads/${branchName}`,
			symbolic: true,
			force: true,
		});
	});
}
