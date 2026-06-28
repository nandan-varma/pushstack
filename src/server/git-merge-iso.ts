/**
 * Git Merge Service (isomorphic-git)
 *
 * Handle merge operations including conflict detection.
 */

import fs from "node:fs";
import path from "node:path";
import git from "isomorphic-git";
import { isR2Configured } from "#/lib/r2";
import { getBareRepoOptions, getDefaultAuthor } from "./git-manager-iso";
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

async function getRepoOptions(
	ownerKey: string,
	repoName: string,
	legacyOwnerKeys: string[] = [],
) {
	if (!isR2Configured()) {
		await ensureRepositoryHydrated(ownerKey, repoName, legacyOwnerKeys);
	}
	return getBareRepoOptions(ownerKey, repoName);
}

/**
 * Analyze if two branches can be merged
 */
export async function analyzeMerge(
	ownerKey: string,
	repoName: string,
	sourceBranch: string,
	targetBranch: string,
	legacyOwnerKeys: string[] = [],
): Promise<MergeAnalysis> {
	const repo = await getRepoOptions(ownerKey, repoName, legacyOwnerKeys);

	try {
		// Check if branches exist
		const sourceOid = await git.resolveRef({ ...repo, ref: sourceBranch });
		const targetOid = await git.resolveRef({ ...repo, ref: targetBranch });

		// Check if it's a fast-forward merge
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
	} catch (error) {
		return {
			canMerge: false,
			hasConflicts: true,
			conflictingFiles: [],
			fastForward: false,
		};
	}
}

/**
 * Merge two branches
 */
export async function mergeBranches(
	ownerKey: string,
	repoName: string,
	sourceBranch: string,
	targetBranch: string,
	options: MergeOptions = {},
	legacyOwnerKeys: string[] = [],
	ownerDbId?: string,
): Promise<{ success: boolean; commitSha?: string; conflicts?: string[] }> {
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
			legacyOwnerKeys,
			ownerDbId,
		);

		return {
			success: true,
			commitSha: commitOid,
		};
	} catch (error) {
		// Merge conflicts occurred
		return {
			success: false,
			conflicts: ["Merge conflicts detected"],
		};
	}
}

/**
 * Resolve merge conflicts (simplified)
 */
export async function resolveConflicts(
	ownerKey: string,
	repoName: string,
	resolutions: Array<{ path: string; content: string }>,
	legacyOwnerKeys: string[] = [],
	ownerDbId?: string,
): Promise<void> {
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
		legacyOwnerKeys,
		ownerDbId,
	);
}
