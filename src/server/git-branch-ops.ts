import git from "isomorphic-git";
import { isR2Configured } from "#/lib/r2";
import { isSafeBranchName } from "./git-ref-name";
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

// Defense in depth: files.ts's zod schemas already reject malformed branch
// names before they reach here, but git.deleteBranch and the resolveRef read
// below don't validate ref names internally the way git.branch does (see
// isSafeBranchName's comment in git-ref-name.ts) — guard at the point these
// primitives are actually called, not just at the API boundary.
function assertSafeBranchName(name: string): void {
	if (!isSafeBranchName(name)) {
		throw new Error(`Invalid branch name: ${name}`);
	}
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
	assertSafeBranchName(branchName);
	assertSafeBranchName(startPoint);
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
	assertSafeBranchName(branchName);
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
	assertSafeBranchName(branchName);
	const repo = await getRepoOptions(ownerKey, repoName);
	await git.resolveRef({ ...repo, ref: `refs/heads/${branchName}` });
}
