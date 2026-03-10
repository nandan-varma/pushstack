/**
 * Git Diff Service
 * 
 * Generate unified diffs for commits, pull requests, and file comparisons.
 */

import * as nodegit from 'nodegit';
import { openRepo, getOid, withRepo } from './git-manager';
import { FileChange } from './git-operations';

export interface FileDiff {
  path: string;
  oldPath?: string; // for renames
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  oldContent: string;
  newContent: string;
  patch: string; // unified diff format
  additions: number;
  deletions: number;
  isBinary: boolean;
}

export interface CommitDiff {
  sha: string;
  parentSha?: string;
  files: FileDiff[];
  totalAdditions: number;
  totalDeletions: number;
  totalFiles: number;
}

/**
 * Get diff for a specific commit compared to its parent
 */
export async function getCommitDiff(
  ownerId: number,
  repoName: string,
  commitSha: string
): Promise<CommitDiff> {
  return await withRepo(ownerId, repoName, async (repo) => {
    const oid = getOid(commitSha);
    const commit = await repo.getCommit(oid);
    const commitTree = await commit.getTree();
    
    let parentTree: nodegit.Tree | null = null;
    let parentSha: string | undefined;
    
    // Get parent commit's tree if it exists
    const parents = commit.parents();
    if (parents.length > 0) {
      const parentCommit = await repo.getCommit(parents[0]);
      parentTree = await parentCommit.getTree();
      parentSha = parentCommit.sha();
    }
    
    // Generate diff
    let diff: nodegit.Diff;
    if (parentTree) {
      diff = await nodegit.Diff.treeToTree(repo, parentTree, commitTree);
    } else {
      // First commit - diff against empty tree
      diff = await nodegit.Diff.treeToTree(repo, null, commitTree);
    }
    
    const files = await processDiff(diff);
    
    const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
    const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);
    
    return {
      sha: commitSha,
      parentSha,
      files,
      totalAdditions,
      totalDeletions,
      totalFiles: files.length,
    };
  });
}

/**
 * Get diff between two commits
 */
export async function getDiffBetweenCommits(
  ownerId: number,
  repoName: string,
  fromSha: string,
  toSha: string
): Promise<CommitDiff> {
  return await withRepo(ownerId, repoName, async (repo) => {
    const fromOid = getOid(fromSha);
    const toOid = getOid(toSha);
    
    const fromCommit = await repo.getCommit(fromOid);
    const toCommit = await repo.getCommit(toOid);
    
    const fromTree = await fromCommit.getTree();
    const toTree = await toCommit.getTree();
    
    const diff = await nodegit.Diff.treeToTree(repo, fromTree, toTree);
    const files = await processDiff(diff);
    
    const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
    const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);
    
    return {
      sha: toSha,
      parentSha: fromSha,
      files,
      totalAdditions,
      totalDeletions,
      totalFiles: files.length,
    };
  });
}

/**
 * Get diff between two branches
 */
export async function getDiffBetweenBranches(
  ownerId: number,
  repoName: string,
  sourceBranch: string,
  targetBranch: string
): Promise<CommitDiff> {
  return await withRepo(ownerId, repoName, async (repo) => {
    const sourceRef = await repo.getReference(`refs/heads/${sourceBranch}`);
    const targetRef = await repo.getReference(`refs/heads/${targetBranch}`);
    
    const sourceCommit = await repo.getCommit(sourceRef.target());
    const targetCommit = await repo.getCommit(targetRef.target());
    
    return await getDiffBetweenCommits(
      ownerId,
      repoName,
      targetCommit.sha(),
      sourceCommit.sha()
    );
  });
}

/**
 * Get diff for a pull request
 */
export async function getPullRequestDiff(
  ownerId: number,
  repoName: string,
  sourceBranch: string,
  targetBranch: string
): Promise<CommitDiff> {
  // PR diff shows what would be merged from source into target
  return await getDiffBetweenBranches(ownerId, repoName, sourceBranch, targetBranch);
}

/**
 * Get diff for a single file between two commits
 */
export async function getFileDiff(
  ownerId: number,
  repoName: string,
  filePath: string,
  fromSha: string,
  toSha: string
): Promise<FileDiff | null> {
  const commitDiff = await getDiffBetweenCommits(ownerId, repoName, fromSha, toSha);
  return commitDiff.files.find((f) => f.path === filePath) || null;
}

/**
 * Get file changes summary (without full patch) for a commit
 */
export async function getCommitFileChanges(
  ownerId: number,
  repoName: string,
  commitSha: string
): Promise<FileChange[]> {
  return await withRepo(ownerId, repoName, async (repo) => {
    const oid = getOid(commitSha);
    const commit = await repo.getCommit(oid);
    const commitTree = await commit.getTree();
    
    let parentTree: nodegit.Tree | null = null;
    const parents = commit.parents();
    if (parents.length > 0) {
      const parentCommit = await repo.getCommit(parents[0]);
      parentTree = await parentCommit.getTree();
    }
    
    let diff: nodegit.Diff;
    if (parentTree) {
      diff = await nodegit.Diff.treeToTree(repo, parentTree, commitTree);
    } else {
      diff = await nodegit.Diff.treeToTree(repo, null, commitTree);
    }
    
    const patches = await diff.patches();
    const changes: FileChange[] = [];
    
    for (const patch of patches) {
      const delta = patch.delta();
      const status = deltaStatusToString(delta.status());
      
      if (status) {
        changes.push({
          path: delta.newFile().path(),
          status,
          additions: await patch.lineStats().then((s) => s.total_additions),
          deletions: await patch.lineStats().then((s) => s.total_deletions),
        });
      }
    }
    
    return changes;
  });
}

/**
 * Check if two branches have conflicts
 */
export async function checkForConflicts(
  ownerId: number,
  repoName: string,
  sourceBranch: string,
  targetBranch: string
): Promise<{ hasConflicts: boolean; conflictingFiles: string[] }> {
  return await withRepo(ownerId, repoName, async (repo) => {
    const sourceRef = await repo.getReference(`refs/heads/${sourceBranch}`);
    const targetRef = await repo.getReference(`refs/heads/${targetBranch}`);
    
    const sourceCommit = await repo.getCommit(sourceRef.target());
    const targetCommit = await repo.getCommit(targetRef.target());
    
    // Create an index for the merge
    const index = await nodegit.Merge.commits(repo, targetCommit, sourceCommit, null);
    
    const hasConflicts = index.hasConflicts();
    const conflictingFiles: string[] = [];
    
    if (hasConflicts) {
      const entries = index.entries();
      for (const entry of entries) {
        const conflict = await index.conflictGet(entry.path);
        if (conflict) {
          conflictingFiles.push(entry.path);
        }
      }
    }
    
    return { hasConflicts, conflictingFiles };
  });
}

/**
 * Process diff and extract file changes
 */
async function processDiff(diff: nodegit.Diff): Promise<FileDiff[]> {
  const patches = await diff.patches();
  const files: FileDiff[] = [];
  
  for (const patch of patches) {
    const delta = patch.delta();
    const oldFile = delta.oldFile();
    const newFile = delta.newFile();
    
    const isBinary = delta.isBinary() === 1;
    const status = deltaStatusToString(delta.status());
    
    if (!status) continue;
    
    // Get patch text
    const patchText = await patch.toBuf().then((buf) => buf.toString('utf-8'));
    
    // Get line stats
    const lineStats = await patch.lineStats();
    
    // Get file contents for display (if not binary)
    let oldContent = '';
    let newContent = '';
    
    if (!isBinary) {
      if (status !== 'added') {
        // Try to get old content from blob
        try {
          const oldBlob = await delta.oldFile().id();
          if (oldBlob && !oldBlob.iszero()) {
            const repo = diff.repository();
            const blob = await repo.getBlob(oldBlob);
            oldContent = blob.toString();
          }
        } catch {
          // Blob might not exist
        }
      }
      
      if (status !== 'deleted') {
        // Try to get new content from blob
        try {
          const newBlob = await delta.newFile().id();
          if (newBlob && !newBlob.iszero()) {
            const repo = diff.repository();
            const blob = await repo.getBlob(newBlob);
            newContent = blob.toString();
          }
        } catch {
          // Blob might not exist
        }
      }
    }
    
    files.push({
      path: newFile.path(),
      oldPath: status === 'renamed' ? oldFile.path() : undefined,
      status,
      oldContent,
      newContent,
      patch: patchText,
      additions: lineStats.total_additions,
      deletions: lineStats.total_deletions,
      isBinary,
    });
  }
  
  return files;
}

/**
 * Convert nodegit delta status to our string format
 */
function deltaStatusToString(
  status: nodegit.Diff.DELTA
): 'added' | 'modified' | 'deleted' | 'renamed' | null {
  switch (status) {
    case nodegit.Diff.DELTA.ADDED:
      return 'added';
    case nodegit.Diff.DELTA.MODIFIED:
      return 'modified';
    case nodegit.Diff.DELTA.DELETED:
      return 'deleted';
    case nodegit.Diff.DELTA.RENAMED:
      return 'renamed';
    default:
      return null;
  }
}
