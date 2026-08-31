/**
 * Branch CRUD — thin wrapper around git-fs-s3/ops's branch
 * functions (extracted from an earlier version of this exact file). What
 * stays here: resolving `(ownerKey, repoName)` to a `Repo`, and the R2
 * lock/sync orchestration around writes (createBranch/deleteBranch), which
 * has no equivalent in the library.
 */
import {
	assertBranchExists,
	assertSafeBranchName,
	type Branch,
	createBranchFrom,
	deleteBranchByName,
	listBranches,
} from "git-fs-s3/ops";
import { isR2Configured } from "#/lib/r2";
import {
	getRepoOptions,
	syncRepositoryToR2,
	withRepositoryLockIfR2,
} from "./git-repo-storage";

export type { Branch };

export async function getBranches(
	ownerKey: string,
	repoName: string,
): Promise<Branch[]> {
	const repo = await getRepoOptions(ownerKey, repoName);
	return listBranches(repo);
}

export async function createBranch(
	ownerKey: string,
	repoName: string,
	branchName: string,
	startPoint: string = "main",
	ownerDbId?: string,
): Promise<void> {
	assertSafeBranchName(branchName);
	assertSafeBranchName(startPoint);
	await withRepositoryLockIfR2(ownerKey, repoName, async () => {
		const repo = await getRepoOptions(ownerKey, repoName);
		await createBranchFrom(repo, branchName, startPoint);
		// ponytail: when R2 backend is active, git.branch wrote directly to R2 — syncing local→R2
		// here would read an empty local dir and delete all R2 objects
		if (!isR2Configured()) {
			await syncRepositoryToR2(ownerKey, repoName, ownerDbId);
		}
	});
}

export async function deleteBranch(
	ownerKey: string,
	repoName: string,
	branchName: string,
	ownerDbId?: string,
): Promise<void> {
	assertSafeBranchName(branchName);
	await withRepositoryLockIfR2(ownerKey, repoName, async () => {
		const repo = await getRepoOptions(ownerKey, repoName);
		await deleteBranchByName(repo, branchName);
		if (!isR2Configured()) {
			await syncRepositoryToR2(ownerKey, repoName, ownerDbId);
		}
	});
}

export async function checkoutBranch(
	ownerKey: string,
	repoName: string,
	branchName: string,
): Promise<void> {
	const repo = await getRepoOptions(ownerKey, repoName);
	await assertBranchExists(repo, branchName);
}
