/**
 * Git Merge Service (isomorphic-git)
 * 
 * Handle merge operations including conflict detection.
 */

import git from 'isomorphic-git'
import fs from 'node:fs'
import path from 'node:path'
import { getBareRepoOptions, getDefaultAuthor } from './git-manager-iso'
import { ensureRepositoryHydrated, withRepositoryWorktree } from './git-repo-storage'

export interface MergeAnalysis {
  canMerge: boolean;
  hasConflicts: boolean;
  conflictingFiles: string[];
  fastForward: boolean;
}

export interface MergeOptions {
  strategy?: 'merge' | 'ours' | 'theirs';
  message?: string;
  authorName?: string;
  authorEmail?: string;
}

async function getRepoOptions(ownerId: number, repoName: string) {
  await ensureRepositoryHydrated(ownerId, repoName)
  return getBareRepoOptions(ownerId, repoName)
}

/**
 * Analyze if two branches can be merged
 */
export async function analyzeMerge(
  ownerId: number,
  repoName: string,
  sourceBranch: string,
  targetBranch: string
): Promise<MergeAnalysis> {
  const repo = await getRepoOptions(ownerId, repoName)

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
  ownerId: number,
  repoName: string,
  sourceBranch: string,
  targetBranch: string,
  options: MergeOptions = {}
): Promise<{ success: boolean; commitSha?: string; conflicts?: string[] }> {
  try {
    const commitOid = await withRepositoryWorktree(ownerId, repoName, targetBranch, async ({ worktreePath }) => {
      await git.merge({
        fs,
        dir: worktreePath,
        ours: targetBranch,
        theirs: sourceBranch,
        author: options.authorName && options.authorEmail
          ? {
              name: options.authorName,
              email: options.authorEmail,
              timestamp: Math.floor(Date.now() / 1000),
              timezoneOffset: 0,
            }
          : getDefaultAuthor(),
        message: options.message || `Merge ${sourceBranch} into ${targetBranch}`,
      })

      const repo = await getRepoOptions(ownerId, repoName)
      return git.resolveRef({ ...repo, ref: targetBranch })
    })

    return {
      success: true,
      commitSha: commitOid,
    };
  } catch (error) {
    // Merge conflicts occurred
    return {
      success: false,
      conflicts: ['Merge conflicts detected'],
    };
  }
}

/**
 * Resolve merge conflicts (simplified)
 */
export async function resolveConflicts(
  ownerId: number,
  repoName: string,
  resolutions: Array<{ path: string; content: string }>
): Promise<void> {
  await withRepositoryWorktree(ownerId, repoName, 'main', async ({ worktreePath }) => {
    for (const resolution of resolutions) {
      const filePath = path.join(worktreePath, resolution.path)
      fs.writeFileSync(filePath, resolution.content)
      await git.add({ fs, dir: worktreePath, filepath: resolution.path })
    }

    await git.commit({
      fs,
      dir: worktreePath,
      message: 'Resolve merge conflicts',
      author: getDefaultAuthor(),
    })
  })
}
