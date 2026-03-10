/**
 * Git Merge Service (isomorphic-git)
 * 
 * Handle merge operations including conflict detection.
 */

import git from 'isomorphic-git';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getRepoPath, getDefaultAuthor } from './git-manager-iso';

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

/**
 * Analyze if two branches can be merged
 */
export async function analyzeMerge(
  ownerId: number,
  repoName: string,
  sourceBranch: string,
  targetBranch: string
): Promise<MergeAnalysis> {
  const dir = getRepoPath(ownerId, repoName);

  try {
    // Check if branches exist
    const sourceOid = await git.resolveRef({ fs, dir, ref: sourceBranch });
    const targetOid = await git.resolveRef({ fs, dir, ref: targetBranch });

    // Check if it's a fast-forward merge
    const isDescendant = await git.isDescendent({
      fs,
      dir,
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
  const dir = getRepoPath(ownerId, repoName);

  try {
    // Checkout target branch
    await git.checkout({ fs, dir, ref: targetBranch });

    // Attempt merge
    await git.merge({
      fs,
      dir,
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
    });

    // Get the merge commit SHA
    const commitOid = await git.resolveRef({ fs, dir, ref: targetBranch });

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
  const dir = getRepoPath(ownerId, repoName);

  // Write resolved files
  for (const resolution of resolutions) {
    const filePath = path.join(dir, resolution.path);
    await fs.writeFile(filePath, resolution.content);
    await git.add({ fs, dir, filepath: resolution.path });
  }

  // Commit the resolution
  await git.commit({
    fs,
    dir,
    message: 'Resolve merge conflicts',
    author: getDefaultAuthor(),
  });
}
