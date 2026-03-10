/**
 * Git Merge Service
 * 
 * Handle merge operations, conflict detection, and resolution.
 */

import * as nodegit from 'nodegit';
import { openRepo, createSignature, getOid, withRepo } from './git-manager';
import { CommitInfo } from './git-operations';

export interface MergeAnalysis {
  canMerge: boolean;
  hasConflicts: boolean;
  conflictingFiles: string[];
  isUpToDate: boolean;
  isFastForward: boolean;
}

export interface MergeResult {
  success: boolean;
  commitSha?: string;
  conflicts?: string[];
  message: string;
}

export interface ConflictInfo {
  path: string;
  ancestorContent?: string;
  ourContent?: string;
  theirContent?: string;
  hasConflict: boolean;
}

/**
 * Analyze merge possibility between two branches
 */
export async function analyzeMerge(
  ownerId: number,
  repoName: string,
  sourceBranch: string,
  targetBranch: string
): Promise<MergeAnalysis> {
  return await withRepo(ownerId, repoName, async (repo) => {
    const sourceRef = await repo.getReference(`refs/heads/${sourceBranch}`);
    const targetRef = await repo.getReference(`refs/heads/${targetBranch}`);
    
    const sourceCommit = await repo.getCommit(sourceRef.target());
    const targetCommit = await repo.getCommit(targetRef.target());
    
    // Perform merge analysis
    const analysis = await nodegit.Merge.analysis(repo, [sourceCommit]);
    
    const isUpToDate = (analysis & nodegit.Merge.ANALYSIS.UP_TO_DATE) !== 0;
    const isFastForward = (analysis & nodegit.Merge.ANALYSIS.FASTFORWARD) !== 0;
    const isNormal = (analysis & nodegit.Merge.ANALYSIS.NORMAL) !== 0;
    
    let hasConflicts = false;
    const conflictingFiles: string[] = [];
    
    if (isNormal) {
      // Check for conflicts
      const index = await nodegit.Merge.commits(repo, targetCommit, sourceCommit, null);
      hasConflicts = index.hasConflicts();
      
      if (hasConflicts) {
        const entries = index.entries();
        const seen = new Set<string>();
        
        for (const entry of entries) {
          try {
            const conflict = await index.conflictGet(entry.path);
            if (conflict && !seen.has(entry.path)) {
              conflictingFiles.push(entry.path);
              seen.add(entry.path);
            }
          } catch {
            // Entry might not have conflict
          }
        }
      }
    }
    
    return {
      canMerge: !hasConflicts,
      hasConflicts,
      conflictingFiles,
      isUpToDate,
      isFastForward,
    };
  });
}

/**
 * Merge source branch into target branch
 */
export async function mergeBranches(
  ownerId: number,
  repoName: string,
  sourceBranch: string,
  targetBranch: string,
  message: string,
  author: { name: string; email: string },
  strategy: 'recursive' | 'ours' | 'theirs' = 'recursive'
): Promise<MergeResult> {
  return await withRepo(ownerId, repoName, async (repo) => {
    const sourceRef = await repo.getReference(`refs/heads/${sourceBranch}`);
    const targetRef = await repo.getReference(`refs/heads/${targetBranch}`);
    
    const sourceCommit = await repo.getCommit(sourceRef.target());
    const targetCommit = await repo.getCommit(targetRef.target());
    
    // Analyze merge
    const analysis = await nodegit.Merge.analysis(repo, [sourceCommit]);
    
    // Check if already up to date
    if ((analysis & nodegit.Merge.ANALYSIS.UP_TO_DATE) !== 0) {
      return {
        success: true,
        message: 'Already up to date',
        commitSha: targetCommit.sha(),
      };
    }
    
    // Check if fast-forward is possible
    if ((analysis & nodegit.Merge.ANALYSIS.FASTFORWARD) !== 0) {
      // Fast-forward merge - just move the branch pointer
      await targetRef.setTarget(sourceCommit.id(), 'Fast-forward merge');
      
      return {
        success: true,
        message: 'Fast-forward merge completed',
        commitSha: sourceCommit.sha(),
      };
    }
    
    // Normal merge required
    const mergeOptions = new nodegit.MergeOptions();
    
    // Set merge strategy
    if (strategy === 'ours') {
      mergeOptions.fileFlags = nodegit.Merge.FILE_FLAGS.FAVOR_OURS;
    } else if (strategy === 'theirs') {
      mergeOptions.fileFlags = nodegit.Merge.FILE_FLAGS.FAVOR_THEIRS;
    }
    
    // Perform merge
    const index = await nodegit.Merge.commits(repo, targetCommit, sourceCommit, mergeOptions);
    
    // Check for conflicts
    if (index.hasConflicts()) {
      const conflicts = [];
      const entries = index.entries();
      const seen = new Set<string>();
      
      for (const entry of entries) {
        try {
          const conflict = await index.conflictGet(entry.path);
          if (conflict && !seen.has(entry.path)) {
            conflicts.push(entry.path);
            seen.add(entry.path);
          }
        } catch {
          // Entry might not have conflict
        }
      }
      
      return {
        success: false,
        message: 'Merge has conflicts that need to be resolved',
        conflicts,
      };
    }
    
    // Write merged tree
    if (!index.hasConflicts()) {
      await index.write();
      const treeOid = await index.writeTree(repo);
      
      // Create merge commit
      const signature = createSignature(author.name, author.email);
      const commitMessage = message || `Merge ${sourceBranch} into ${targetBranch}`;
      
      const commitId = await repo.createCommit(
        `refs/heads/${targetBranch}`,
        signature,
        signature,
        commitMessage,
        treeOid,
        [targetCommit, sourceCommit] // Two parents for merge commit
      );
      
      return {
        success: true,
        message: 'Merge completed successfully',
        commitSha: commitId.tostrS(),
      };
    }
    
    return {
      success: false,
      message: 'Merge failed',
    };
  });
}

/**
 * Detect conflicts for manual resolution
 */
export async function detectConflicts(
  ownerId: number,
  repoName: string,
  sourceBranch: string,
  targetBranch: string
): Promise<ConflictInfo[]> {
  return await withRepo(ownerId, repoName, async (repo) => {
    const sourceRef = await repo.getReference(`refs/heads/${sourceBranch}`);
    const targetRef = await repo.getReference(`refs/heads/${targetBranch}`);
    
    const sourceCommit = await repo.getCommit(sourceRef.target());
    const targetCommit = await repo.getCommit(targetRef.target());
    
    // Perform merge to get index with conflicts
    const index = await nodegit.Merge.commits(repo, targetCommit, sourceCommit, null);
    
    const conflicts: ConflictInfo[] = [];
    const entries = index.entries();
    const processed = new Set<string>();
    
    for (const entry of entries) {
      if (processed.has(entry.path)) continue;
      
      try {
        const conflict = await index.conflictGet(entry.path);
        
        if (conflict) {
          processed.add(entry.path);
          
          let ancestorContent: string | undefined;
          let ourContent: string | undefined;
          let theirContent: string | undefined;
          
          // Get ancestor version
          if (conflict.ancestor_out) {
            try {
              const blob = await repo.getBlob(conflict.ancestor_out.id);
              ancestorContent = blob.toString();
            } catch {
              // Blob might not exist
            }
          }
          
          // Get our version (target branch)
          if (conflict.our_out) {
            try {
              const blob = await repo.getBlob(conflict.our_out.id);
              ourContent = blob.toString();
            } catch {
              // Blob might not exist
            }
          }
          
          // Get their version (source branch)
          if (conflict.their_out) {
            try {
              const blob = await repo.getBlob(conflict.their_out.id);
              theirContent = blob.toString();
            } catch {
              // Blob might not exist
            }
          }
          
          conflicts.push({
            path: entry.path,
            ancestorContent,
            ourContent,
            theirContent,
            hasConflict: true,
          });
        }
      } catch {
        // Entry might not have conflict
      }
    }
    
    return conflicts;
  });
}

/**
 * Resolve conflicts and complete merge
 */
export async function resolveConflicts(
  ownerId: number,
  repoName: string,
  sourceBranch: string,
  targetBranch: string,
  resolutions: Array<{ path: string; content: string }>,
  message: string,
  author: { name: string; email: string }
): Promise<MergeResult> {
  return await withRepo(ownerId, repoName, async (repo) => {
    const sourceRef = await repo.getReference(`refs/heads/${sourceBranch}`);
    const targetRef = await repo.getReference(`refs/heads/${targetBranch}`);
    
    const sourceCommit = await repo.getCommit(sourceRef.target());
    const targetCommit = await repo.getCommit(targetRef.target());
    
    // Create index for merge
    const index = await nodegit.Merge.commits(repo, targetCommit, sourceCommit, null);
    
    // Apply resolutions
    for (const resolution of resolutions) {
      // Remove conflict
      await index.conflictRemove(resolution.path);
      
      // Create blob with resolved content
      const buffer = Buffer.from(resolution.content, 'utf-8');
      const oid = await repo.createBlobFromBuffer(buffer);
      
      // Add resolved file to index
      await index.add({
        path: resolution.path,
        oid: oid,
        mode: 33188, // 0100644 - regular file
        flags: 0,
      });
    }
    
    // Verify all conflicts are resolved
    if (index.hasConflicts()) {
      return {
        success: false,
        message: 'Not all conflicts have been resolved',
      };
    }
    
    // Write merged tree
    await index.write();
    const treeOid = await index.writeTree(repo);
    
    // Create merge commit
    const signature = createSignature(author.name, author.email);
    const commitMessage = message || `Merge ${sourceBranch} into ${targetBranch}`;
    
    const commitId = await repo.createCommit(
      `refs/heads/${targetBranch}`,
      signature,
      signature,
      commitMessage,
      treeOid,
      [targetCommit, sourceCommit]
    );
    
    return {
      success: true,
      message: 'Conflicts resolved and merge completed',
      commitSha: commitId.tostrS(),
    };
  });
}

/**
 * Check if source branch is ahead of target
 */
export async function isBranchAhead(
  ownerId: number,
  repoName: string,
  sourceBranch: string,
  targetBranch: string
): Promise<{ isAhead: boolean; aheadBy: number; behindBy: number }> {
  return await withRepo(ownerId, repoName, async (repo) => {
    const sourceRef = await repo.getReference(`refs/heads/${sourceBranch}`);
    const targetRef = await repo.getReference(`refs/heads/${targetBranch}`);
    
    const sourceCommit = await repo.getCommit(sourceRef.target());
    const targetCommit = await repo.getCommit(targetRef.target());
    
    // Get ahead/behind counts
    const [aheadBy, behindBy] = await nodegit.Graph.aheadBehind(
      repo,
      sourceCommit.id(),
      targetCommit.id()
    );
    
    return {
      isAhead: aheadBy > 0,
      aheadBy,
      behindBy,
    };
  });
}
