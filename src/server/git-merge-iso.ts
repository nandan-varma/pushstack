import fs from "node:fs";
import path from "node:path";
import git from "isomorphic-git";
import { isR2Configured } from "#/lib/r2";
import { getBareRepoOptions, getDefaultAuthor } from "./git-manager-iso";
import { createCommit } from "./git-operations-iso";
import {
	ensureRepositoryHydrated,
	withRepositoryWorktree,
} from "./git-repo-storage";

export interface MergeAnalysis {
	canMerge: boolean;
	hasConflicts: boolean;
	conflictingFiles: string[];
	fastForward: boolean;
}

export interface MergeOptions {
	strategy?: "merge" | "ours" | "theirs";
	message?: string;
	authorName?: string;
	authorEmail?: string;
}

async function getRepoOptions(ownerKey: string, repoName: string) {
	if (!isR2Configured()) {
		await ensureRepositoryHydrated(ownerKey, repoName);
	}
	return getBareRepoOptions(ownerKey, repoName);
}

export async function analyzeMerge(
	ownerKey: string,
	repoName: string,
	sourceBranch: string,
	targetBranch: string,
): Promise<MergeAnalysis> {
	const repo = await getRepoOptions(ownerKey, repoName);

	try {
		const sourceOid = await git.resolveRef({ ...repo, ref: sourceBranch });
		const targetOid = await git.resolveRef({ ...repo, ref: targetBranch });

		const isDescendant = await git.isDescendent({
			...repo,
			oid: sourceOid,
			ancestor: targetOid,
		});

		return {
			canMerge: true,
			hasConflicts: false,
			conflictingFiles: [],
			fastForward: isDescendant,
		};
	} catch {
		return {
			canMerge: false,
			hasConflicts: true,
			conflictingFiles: [],
			fastForward: false,
		};
	}
}

export async function mergeBranches(
	ownerKey: string,
	repoName: string,
	sourceBranch: string,
	targetBranch: string,
	options: MergeOptions = {},
	ownerDbId?: string,
): Promise<{ success: boolean; commitSha?: string; conflicts?: string[] }> {
	if (isR2Configured()) {
		// ponytail: FF merge = just update the ref, no worktree needed; non-FF falls through
		try {
			const repo = getBareRepoOptions(ownerKey, repoName);
			const sourceOid = await git.resolveRef({
				...repo,
				ref: `refs/heads/${sourceBranch}`,
			});
			const targetOid = await git.resolveRef({
				...repo,
				ref: `refs/heads/${targetBranch}`,
			});
			const isFF = await git.isDescendent({
				...repo,
				oid: sourceOid,
				ancestor: targetOid,
			});
			if (isFF) {
				await git.writeRef({
					...repo,
					ref: `refs/heads/${targetBranch}`,
					value: sourceOid,
					force: true,
				});
				return { success: true, commitSha: sourceOid };
			}
		} catch (_error) {
			return { success: false, conflicts: ["Merge conflicts detected"] };
		}
		// Non-FF: fall through to worktree path below
	}

	try {
		const commitOid = await withRepositoryWorktree(
			ownerKey,
			repoName,
			targetBranch,
			async ({ worktreePath }) => {
				// Use remote tracking ref: worktree clones only have origin/<branch>, not local <branch>
				await git.merge({
					fs,
					dir: worktreePath,
					ours: targetBranch,
					theirs: `origin/${sourceBranch}`,
					author:
						options.authorName && options.authorEmail
							? {
									name: options.authorName,
									email: options.authorEmail,
									timestamp: Math.floor(Date.now() / 1000),
									timezoneOffset: 0,
								}
							: getDefaultAuthor(),
					message:
						options.message || `Merge ${sourceBranch} into ${targetBranch}`,
				});

				// Read from worktree (bare repo not updated yet) and avoid re-acquiring the lock
				return git.resolveRef({ fs, dir: worktreePath, ref: targetBranch });
			},
			"main",
			ownerDbId,
		);

		return {
			success: true,
			commitSha: commitOid,
		};
	} catch (error) {
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			(error as { code: string }).code === "MergeConflictError"
		) {
			const conflictError = error as {
				data?: { filepaths?: string[] };
			};
			return {
				success: false,
				conflicts: conflictError.data?.filepaths?.length
					? conflictError.data.filepaths
					: ["Merge conflicts detected"],
			};
		}
		return {
			success: false,
			conflicts: ["Merge conflicts detected"],
		};
	}
}

export async function resolveConflicts(
	ownerKey: string,
	repoName: string,
	resolutions: Array<{ path: string; content: string }>,
	ownerDbId?: string,
): Promise<void> {
	if (isR2Configured()) {
		// ponytail: resolveConflicts = createCommit with conflict resolutions
		await createCommit(
			ownerKey,
			repoName,
			"Resolve merge conflicts",
			resolutions,
			undefined,
			undefined,
			"main",
			ownerDbId,
		);
		return;
	}

	await withRepositoryWorktree(
		ownerKey,
		repoName,
		"main",
		async ({ worktreePath }) => {
			for (const resolution of resolutions) {
				const filePath = path.join(worktreePath, resolution.path);
				fs.writeFileSync(filePath, resolution.content);
				await git.add({ fs, dir: worktreePath, filepath: resolution.path });
			}

			await git.commit({
				fs,
				dir: worktreePath,
				message: "Resolve merge conflicts",
				author: getDefaultAuthor(),
			});
		},
		"main",
		ownerDbId,
	);
}
