/**
 * Git Advanced Operations Service
 * 
 * Advanced git features: rebase, cherry-pick, revert, reset, blame, tags.
 */

import * as nodegit from 'nodegit';
import { openRepo, createSignature, getOid, withRepo } from './git-manager';
import { CommitInfo } from './git-operations';

export interface TagInfo {
  name: string;
  sha: string;
  message?: string;
  tagger?: {
    name: string;
    email: string;
    date: Date;
  };
  commitSha: string;
  isAnnotated: boolean;
}

export interface BlameHunk {
  startLine: number;
  endLine: number;
  commitSha: string;
  author: {
    name: string;
    email: string;
    date: Date;
  };
  message: string;
}

export interface RebaseResult {
  success: boolean;
  newCommitSha?: string;
  conflicts?: string[];
  message: string;
}

/**
 * Rebase one branch onto another
 */
export async function rebaseOntoBranch(
  ownerId: number,
  repoName: string,
  branch: string,
  ontoBranch: string,
  author: { name: string; email: string }
): Promise<RebaseResult> {
  return await withRepo(ownerId, repoName, async (repo) => {
    const branchRef = await repo.getReference(`refs/heads/${branch}`);
    const ontoRef = await repo.getReference(`refs/heads/${ontoBranch}`);
    
    const branchCommit = await repo.getCommit(branchRef.target());
    const ontoCommit = await repo.getCommit(ontoRef.target());
    
    const signature = createSignature(author.name, author.email);
    
    try {
      // Initialize rebase
      const rebase = await nodegit.Rebase.init(
        repo,
        branchCommit,
        ontoCommit,
        null,
        signature
      );
      
      let operation: nodegit.RebaseOperation | null;
      const conflicts: string[] = [];
      
      // Process each rebase operation
      while ((operation = await rebase.next()) !== null) {
        const index = await repo.index();
        
        if (index.hasConflicts()) {
          // Collect conflicts
          const entries = index.entries();
          for (const entry of entries) {
            try {
              const conflict = await index.conflictGet(entry.path);
              if (conflict) {
                conflicts.push(entry.path);
              }
            } catch {
              // Entry might not have conflict
            }
          }
          
          // Abort rebase on conflicts
          await rebase.abort();
          
          return {
            success: false,
            message: 'Rebase has conflicts that need to be resolved',
            conflicts,
          };
        }
        
        // Commit this operation
        await rebase.commit(null, signature);
      }
      
      // Finish rebase
      await rebase.finish(signature);
      
      // Get new HEAD
      const newHead = await repo.head();
      const newCommit = await repo.getCommit(newHead.target());
      
      return {
        success: true,
        message: 'Rebase completed successfully',
        newCommitSha: newCommit.sha(),
      };
    } catch (error) {
      return {
        success: false,
        message: `Rebase failed: ${error}`,
      };
    }
  });
}

/**
 * Cherry-pick a commit onto current branch
 */
export async function cherryPickCommit(
  ownerId: number,
  repoName: string,
  targetBranch: string,
  commitSha: string,
  author: { name: string; email: string }
): Promise<{ success: boolean; newCommitSha?: string; conflicts?: string[]; message: string }> {
  return await withRepo(ownerId, repoName, async (repo) => {
    const targetRef = await repo.getReference(`refs/heads/${targetBranch}`);
    const targetCommit = await repo.getCommit(targetRef.target());
    
    const oid = getOid(commitSha);
    const cherryCommit = await repo.getCommit(oid);
    
    const signature = createSignature(author.name, author.email);
    
    try {
      // Cherry-pick the commit
      await nodegit.Cherrypick.cherrypick(repo, cherryCommit, {});
      
      const index = await repo.index();
      
      if (index.hasConflicts()) {
        const conflicts: string[] = [];
        const entries = index.entries();
        
        for (const entry of entries) {
          try {
            const conflict = await index.conflictGet(entry.path);
            if (conflict) {
              conflicts.push(entry.path);
            }
          } catch {
            // Entry might not have conflict
          }
        }
        
        return {
          success: false,
          message: 'Cherry-pick has conflicts',
          conflicts,
        };
      }
      
      // Create commit
      await index.write();
      const treeOid = await index.writeTree();
      
      const message = `${cherryCommit.message()}\n\n(cherry picked from commit ${commitSha})`;
      
      const commitId = await repo.createCommit(
        `refs/heads/${targetBranch}`,
        signature,
        signature,
        message,
        treeOid,
        [targetCommit]
      );
      
      return {
        success: true,
        message: 'Cherry-pick completed successfully',
        newCommitSha: commitId.tostrS(),
      };
    } catch (error) {
      return {
        success: false,
        message: `Cherry-pick failed: ${error}`,
      };
    }
  });
}

/**
 * Revert a commit (create inverse commit)
 */
export async function revertCommit(
  ownerId: number,
  repoName: string,
  branch: string,
  commitSha: string,
  author: { name: string; email: string }
): Promise<{ success: boolean; newCommitSha?: string; message: string }> {
  return await withRepo(ownerId, repoName, async (repo) => {
    const branchRef = await repo.getReference(`refs/heads/${branch}`);
    const headCommit = await repo.getCommit(branchRef.target());
    
    const oid = getOid(commitSha);
    const revertCommit = await repo.getCommit(oid);
    
    const signature = createSignature(author.name, author.email);
    
    try {
      // Revert the commit
      await nodegit.Revert.revert(repo, revertCommit, {});
      
      const index = await repo.index();
      
      if (index.hasConflicts()) {
        return {
          success: false,
          message: 'Revert has conflicts and cannot be completed automatically',
        };
      }
      
      // Create revert commit
      await index.write();
      const treeOid = await index.writeTree();
      
      const message = `Revert "${revertCommit.message().split('\n')[0]}"\n\nThis reverts commit ${commitSha}.`;
      
      const commitId = await repo.createCommit(
        `refs/heads/${branch}`,
        signature,
        signature,
        message,
        treeOid,
        [headCommit]
      );
      
      return {
        success: true,
        message: 'Revert completed successfully',
        newCommitSha: commitId.tostrS(),
      };
    } catch (error) {
      return {
        success: false,
        message: `Revert failed: ${error}`,
      };
    }
  });
}

/**
 * Reset a branch to a specific commit
 */
export async function resetBranch(
  ownerId: number,
  repoName: string,
  branch: string,
  toCommitSha: string,
  mode: 'soft' | 'mixed' | 'hard' = 'mixed'
): Promise<{ success: boolean; message: string }> {
  return await withRepo(ownerId, repoName, async (repo) => {
    const branchRef = await repo.getReference(`refs/heads/${branch}`);
    const oid = getOid(toCommitSha);
    const commit = await repo.getCommit(oid);
    
    try {
      let resetType: nodegit.Reset.TYPE;
      
      switch (mode) {
        case 'soft':
          resetType = nodegit.Reset.TYPE.SOFT;
          break;
        case 'hard':
          resetType = nodegit.Reset.TYPE.HARD;
          break;
        default:
          resetType = nodegit.Reset.TYPE.MIXED;
      }
      
      await nodegit.Reset.reset(repo, commit as any, resetType, {});
      
      return {
        success: true,
        message: `Branch reset to ${toCommitSha} (${mode})`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Reset failed: ${error}`,
      };
    }
  });
}

/**
 * Get blame information for a file
 */
export async function getBlame(
  ownerId: number,
  repoName: string,
  commitSha: string,
  filePath: string
): Promise<BlameHunk[]> {
  return await withRepo(ownerId, repoName, async (repo) => {
    const oid = getOid(commitSha);
    const commit = await repo.getCommit(oid);
    
    // Get blame for the file
    const blame = await nodegit.Blame.file(repo, filePath, {
      newestCommit: oid,
    });
    
    const hunks: BlameHunk[] = [];
    const hunkCount = blame.getHunkCount();
    
    for (let i = 0; i < hunkCount; i++) {
      const hunk = blame.getHunkByIndex(i);
      const hunkOid = hunk.finalCommitId();
      const hunkCommit = await repo.getCommit(hunkOid);
      const author = hunkCommit.author();
      
      hunks.push({
        startLine: hunk.finalStartLineNumber(),
        endLine: hunk.finalStartLineNumber() + hunk.linesInHunk() - 1,
        commitSha: hunkCommit.sha(),
        author: {
          name: author.name(),
          email: author.email(),
          date: new Date(author.when().time() * 1000),
        },
        message: hunkCommit.message().split('\n')[0],
      });
    }
    
    return hunks;
  });
}

/**
 * Get all tags
 */
export async function getTags(
  ownerId: number,
  repoName: string
): Promise<TagInfo[]> {
  return await withRepo(ownerId, repoName, async (repo) => {
    const refs = await repo.getReferences();
    const tags: TagInfo[] = [];
    
    for (const ref of refs) {
      if (ref.isTag()) {
        const tagName = ref.shorthand();
        
        try {
          // Try to get annotated tag
          const tag = await repo.getTag(ref.target());
          const targetOid = tag.targetId();
          const commit = await repo.getCommit(targetOid);
          const tagger = tag.tagger();
          
          tags.push({
            name: tagName,
            sha: ref.target().tostrS(),
            message: tag.message(),
            tagger: {
              name: tagger.name(),
              email: tagger.email(),
              date: new Date(tagger.when().time() * 1000),
            },
            commitSha: commit.sha(),
            isAnnotated: true,
          });
        } catch {
          // Lightweight tag - points directly to commit
          const commit = await repo.getCommit(ref.target());
          
          tags.push({
            name: tagName,
            sha: ref.target().tostrS(),
            commitSha: commit.sha(),
            isAnnotated: false,
          });
        }
      }
    }
    
    return tags;
  });
}

/**
 * Create an annotated tag
 */
export async function createTag(
  ownerId: number,
  repoName: string,
  tagName: string,
  commitSha: string,
  message: string,
  tagger: { name: string; email: string }
): Promise<TagInfo> {
  return await withRepo(ownerId, repoName, async (repo) => {
    const oid = getOid(commitSha);
    const commit = await repo.getCommit(oid);
    const signature = createSignature(tagger.name, tagger.email);
    
    // Create annotated tag
    const tagOid = await repo.createTag(oid, tagName, message, 0, signature);
    
    return {
      name: tagName,
      sha: tagOid.tostrS(),
      message,
      tagger: {
        name: tagger.name,
        email: tagger.email,
        date: new Date(),
      },
      commitSha: commit.sha(),
      isAnnotated: true,
    };
  });
}

/**
 * Create a lightweight tag
 */
export async function createLightweightTag(
  ownerId: number,
  repoName: string,
  tagName: string,
  commitSha: string
): Promise<TagInfo> {
  return await withRepo(ownerId, repoName, async (repo) => {
    const oid = getOid(commitSha);
    const commit = await repo.getCommit(oid);
    
    // Create lightweight tag (just a reference)
    await repo.createLightweightTag(oid, tagName);
    
    return {
      name: tagName,
      sha: oid.tostrS(),
      commitSha: commit.sha(),
      isAnnotated: false,
    };
  });
}

/**
 * Delete a tag
 */
export async function deleteTag(
  ownerId: number,
  repoName: string,
  tagName: string
): Promise<void> {
  return await withRepo(ownerId, repoName, async (repo) => {
    await nodegit.Tag.delete(repo, tagName);
  });
}
