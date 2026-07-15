import git from "isomorphic-git";
import { isR2Configured } from "#/lib/r2";
import {
	getRepoOptions,
	syncRepositoryToR2,
	withRepositoryLock,
} from "./git-repo-storage";

export interface Branch {
	name: string;
	commit: string;
	isDefault: boolean;
}

export async function getBranches(
	ownerKey: string,
	repoName: string,
): Promise<Branch[]> {
	const repo = await getRepoOptions(ownerKey, repoName);
	try {
		const [branches, currentBranch] = await Promise.all([
			git.listBranches(repo),
			git.currentBranch({ ...repo, fullname: false }).catch(() => null),
		]);

		return Promise.all(
			branches.map(async (branch) => ({
				name: branch,
				commit: await git.resolveRef({ ...repo, ref: `refs/heads/${branch}` }),
				isDefault: branch === currentBranch,
			})),
		);
	} catch (err: unknown) {
		if ((err as { code?: string }).code === "NotFoundError") return [];
		throw err;
	}
}

export async function createBranch(
	ownerKey: string,
	repoName: string,
	branchName: string,
	startPoint: string = "main",
	ownerDbId?: string,
): Promise<void> {
	const run = async () => {
		const repo = await getRepoOptions(ownerKey, repoName);
		const object = await git.resolveRef({
			...repo,
			ref: `refs/heads/${startPoint}`,
		});
		await git.branch({ ...repo, ref: branchName, checkout: false, object });
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
	const run = async () => {
		const repo = await getRepoOptions(ownerKey, repoName);
		await git.deleteBranch({ ...repo, ref: branchName });
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
	await git.resolveRef({ ...repo, ref: `refs/heads/${branchName}` });
}
