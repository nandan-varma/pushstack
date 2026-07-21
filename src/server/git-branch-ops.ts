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
	withRepositoryLock,
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
	const run = async () => {
		const repo = await getRepoOptions(ownerKey, repoName);
		await createBranchFrom(repo, branchName, startPoint);
		// ponytail: when R2 backend is active, git.branch wrote directly to R2 — syncing local→R2
		// here would read an empty local dir and delete all R2 objects
		if (!isR2Configured()) {
			await syncRepositoryToR2(ownerKey, repoName, ownerDbId);
		}
	};
	// Only lock the R2-direct path: getRepoOptions()/syncRepositoryToR2() in the
	// non-R2 path already acquire this same lock internally, and it isn't
	// reentrant — wrapping the whole function unconditionally deadlocks.
	if (isR2Configured()) {
		await withRepositoryLock(ownerKey, repoName, run);
	} else {
		await run();
	}
}

export async function deleteBranch(
	ownerKey: string,
	repoName: string,
	branchName: string,
	ownerDbId?: string,
): Promise<void> {
	assertSafeBranchName(branchName);
	const run = async () => {
		const repo = await getRepoOptions(ownerKey, repoName);
		await deleteBranchByName(repo, branchName);
		if (!isR2Configured()) {
			await syncRepositoryToR2(ownerKey, repoName, ownerDbId);
		}
	};
	// See createBranch above: only lock the R2-direct path to avoid deadlocking
	// on the non-reentrant lock already held by the non-R2 hydrate/sync calls.
	if (isR2Configured()) {
		await withRepositoryLock(ownerKey, repoName, run);
	} else {
		await run();
	}
}

export async function checkoutBranch(
	ownerKey: string,
	repoName: string,
	branchName: string,
): Promise<void> {
	const repo = await getRepoOptions(ownerKey, repoName);
	await assertBranchExists(repo, branchName);
}
