/**
 * Git Operations Service
 * 
 * Core git operations: commits, branches, blobs, trees, and history.
 * This layer provides high-level git functionality built on git-manager.
 */

import * as nodegit from 'nodegit';
import * as path from 'node:path';
import { openRepo, createSignature, getOid, withRepo } from './git-manager';

// Types for our API
export interface CommitInfo {
  sha: string;
  message: string;
  author: {
    name: string;
    email: string;
    date: Date;
  };
  committer: {
    name: string;
    email: string;
    date: Date;
  };
  parents: string[];
  tree: string;
  filesChanged?: FileChange[];
}

export interface FileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  additions?: number;
  deletions?: number;
}

export interface BranchInfo {
  name: string;
  commit: string; // SHA
  isHead: boolean;
}

export interface FileInfo {
  path: string;
  content: string; // base64 for binary, utf-8 for text
  size: number;
  isBinary: boolean;
  sha: string; // blob SHA
  mode: string; // file mode (e.g., '100644')
}

export interface TreeEntry {
  name: string;
  path: string;
  type: 'blob' | 'tree'; // file or directory
  sha: string;
  size?: number;
  mode: string;
}

/**
 * Initialize a new repository with an initial commit
 */
export async function initRepository(
  ownerId: number,
  repoName: string,
  defaultBranch: string = 'main'
): Promise<CommitInfo> {
  const { initBareRepo } = await import('./git-manager');
  const repo = await initBareRepo(ownerId, repoName);
  
  // Create initial empty commit to establish main branch
  const signature = createSignature('PushStack', 'system@pushstack.dev');
  const index = await repo.index();
  const treeOid = await index.writeTree();
  
  const commitId = await repo.createCommit(
    `refs/heads/${defaultBranch}`,
    signature,
    signature,
    'Initial commit',
    treeOid,
    []
  );
  
  // Set HEAD to point to default branch
  await repo.setHead(`refs/heads/${defaultBranch}`);
  
  const commit = await repo.getCommit(commitId);
  return commitToInfo(commit);
}

/**
 * Create a new commit with file changes
 */
export async function createCommit(
  ownerId: number,
  repoName: string,
  branchName: string,
  message: string,
  files: Array<{ path: string; content: Buffer | string; mode?: string }>,
  author: { name: string; email: string }
): Promise<CommitInfo> {
  return await withRepo(ownerId, repoName, async (repo) => {
    // Get the current branch reference
    const refName = `refs/heads/${branchName}`;
    let parentCommit: nodegit.Commit | null = null;
    
    try {
      const ref = await repo.getReference(refName);
      parentCommit = await repo.getCommit(ref.target());
    } catch (error) {
      // Branch doesn't exist yet, will be created
    }
    
    // Build the tree
    const index = await repo.index();
    
    // If we have a parent, start with its tree
    if (parentCommit) {
      const tree = await parentCommit.getTree();
      await index.readTree(tree);
    }
    
    // Add/update files
    for (const file of files) {
      const content = Buffer.isBuffer(file.content)
        ? file.content
        : Buffer.from(file.content, 'utf-8');
      
      const oid = await repo.createBlobFromBuffer(content);
      
      await index.addByPath(file.path);
      const entry = index.getByPath(file.path);
      
      // Update entry with new blob
      await index.conflictRemove(file.path);
      await index.remove(file.path, 0);
      await index.add({
        path: file.path,
        oid: oid,
        mode: Number.parseInt(file.mode || '100644', 8),
        flags: 0,
      });
    }
    
    await index.write();
    const treeOid = await index.writeTree();
    
    // Create commit
    const signature = createSignature(author.name, author.email);
    const parents = parentCommit ? [parentCommit] : [];
    
    const commitId = await repo.createCommit(
      refName,
      signature,
      signature,
      message,
      treeOid,
      parents
    );
    
    const commit = await repo.getCommit(commitId);
    return commitToInfo(commit);
  });
}

/**
 * Get commit history for a branch
 */
export async function getCommitHistory(
  ownerId: number,
  repoName: string,
  branchName: string,
  limit: number = 50,
  skip: number = 0
): Promise<CommitInfo[]> {
  return await withRepo(ownerId, repoName, async (repo) => {
    const refName = `refs/heads/${branchName}`;
    const ref = await repo.getReference(refName);
    const commit = await repo.getCommit(ref.target());
    
    const history = await (commit.history() as any).getCommitsUntil(() => true);
    
    const commits: CommitInfo[] = [];
    const start = skip;
    const end = Math.min(skip + limit, history.length);
    
    for (let i = start; i < end; i++) {
      commits.push(await commitToInfo(history[i]));
    }
    
    return commits;
  });
}

/**
 * Get a single commit by SHA
 */
export async function getCommit(
  ownerId: number,
  repoName: string,
  sha: string
): Promise<CommitInfo> {
  return await withRepo(ownerId, repoName, async (repo) => {
    const oid = getOid(sha);
    const commit = await repo.getCommit(oid);
    return await commitToInfo(commit);
  });
}

/**
 * Get all branches
 */
export async function getBranches(
  ownerId: number,
  repoName: string
): Promise<BranchInfo[]> {
  return await withRepo(ownerId, repoName, async (repo) => {
    const refs = await repo.getReferences();
    const headRef = await repo.head();
    const headTarget = headRef.target().tostrS();
    
    const branches: BranchInfo[] = [];
    
    for (const ref of refs) {
      if (ref.isBranch()) {
        const commit = await repo.getCommit(ref.target());
        branches.push({
          name: ref.shorthand(),
          commit: commit.sha(),
          isHead: ref.target().tostrS() === headTarget,
        });
      }
    }
    
    return branches;
  });
}

/**
 * Create a new branch from a commit
 */
export async function createBranch(
  ownerId: number,
  repoName: string,
  branchName: string,
  fromCommitSha?: string
): Promise<BranchInfo> {
  return await withRepo(ownerId, repoName, async (repo) => {
    let commit: nodegit.Commit;
    
    if (fromCommitSha) {
      const oid = getOid(fromCommitSha);
      commit = await repo.getCommit(oid);
    } else {
      // Use HEAD
      const head = await repo.head();
      commit = await repo.getCommit(head.target());
    }
    
    const ref = await repo.createBranch(branchName, commit, false);
    
    return {
      name: ref.shorthand(),
      commit: commit.sha(),
      isHead: false,
    };
  });
}

/**
 * Delete a branch
 */
export async function deleteBranch(
  ownerId: number,
  repoName: string,
  branchName: string
): Promise<void> {
  return await withRepo(ownerId, repoName, async (repo) => {
    const branch = await repo.getBranch(branchName);
    await nodegit.Branch.delete(branch);
  });
}

/**
 * Get file content at a specific commit
 */
export async function getBlob(
  ownerId: number,
  repoName: string,
  commitSha: string,
  filePath: string
): Promise<FileInfo> {
  return await withRepo(ownerId, repoName, async (repo) => {
    const oid = getOid(commitSha);
    const commit = await repo.getCommit(oid);
    const tree = await commit.getTree();
    
    const entry = await tree.getEntry(filePath);
    const blob = await entry.getBlob();
    
    const content = blob.content();
    const isBinary = blob.isBinary() === 1;
    
    return {
      path: filePath,
      content: isBinary ? content.toString('base64') : content.toString('utf-8'),
      size: blob.rawsize(),
      isBinary,
      sha: entry.sha(),
      mode: entry.filemode().toString(8),
    };
  });
}

/**
 * Get file content from a branch (latest commit)
 */
export async function getFileFromBranch(
  ownerId: number,
  repoName: string,
  branchName: string,
  filePath: string
): Promise<FileInfo> {
  return await withRepo(ownerId, repoName, async (repo) => {
    const refName = `refs/heads/${branchName}`;
    const ref = await repo.getReference(refName);
    const commit = await repo.getCommit(ref.target());
    
    return await getBlob(ownerId, repoName, commit.sha(), filePath);
  });
}

/**
 * List files in a directory (tree) at a specific commit
 */
export async function getTree(
  ownerId: number,
  repoName: string,
  commitSha: string,
  dirPath: string = ''
): Promise<TreeEntry[]> {
  return await withRepo(ownerId, repoName, async (repo) => {
    const oid = getOid(commitSha);
    const commit = await repo.getCommit(oid);
    let tree = await commit.getTree();
    
    // Navigate to subdirectory if specified
    if (dirPath) {
      const entry = await tree.getEntry(dirPath);
      if (!entry.isTree()) {
        throw new Error(`Path ${dirPath} is not a directory`);
      }
      tree = await entry.getTree();
    }
    
    const entries: TreeEntry[] = [];
    const treeEntries = tree.entries();
    
    for (const entry of treeEntries) {
      const fullPath = dirPath ? `${dirPath}/${entry.name()}` : entry.name();
      
      entries.push({
        name: entry.name(),
        path: fullPath,
        type: entry.isTree() ? 'tree' : 'blob',
        sha: entry.sha(),
        mode: entry.filemode().toString(8),
        size: entry.isBlob() ? (await entry.getBlob()).rawsize() : undefined,
      });
    }
    
    return entries;
  });
}

/**
 * List files in a directory from a branch
 */
export async function getTreeFromBranch(
  ownerId: number,
  repoName: string,
  branchName: string,
  dirPath: string = ''
): Promise<TreeEntry[]> {
  return await withRepo(ownerId, repoName, async (repo) => {
    const refName = `refs/heads/${branchName}`;
    const ref = await repo.getReference(refName);
    const commit = await repo.getCommit(ref.target());
    
    return await getTree(ownerId, repoName, commit.sha(), dirPath);
  });
}

/**
 * Delete a file from a branch
 */
export async function deleteFile(
  ownerId: number,
  repoName: string,
  branchName: string,
  filePath: string,
  message: string,
  author: { name: string; email: string }
): Promise<CommitInfo> {
  return await withRepo(ownerId, repoName, async (repo) => {
    const refName = `refs/heads/${branchName}`;
    const ref = await repo.getReference(refName);
    const parentCommit = await repo.getCommit(ref.target());
    
    // Get parent tree
    const parentTree = await parentCommit.getTree();
    const index = await repo.index();
    await index.readTree(parentTree);
    
    // Remove the file
    await index.remove(filePath, 0);
    await index.write();
    
    const treeOid = await index.writeTree();
    
    // Create commit
    const signature = createSignature(author.name, author.email);
    const commitId = await repo.createCommit(
      refName,
      signature,
      signature,
      message,
      treeOid,
      [parentCommit]
    );
    
    const commit = await repo.getCommit(commitId);
    return commitToInfo(commit);
  });
}

/**
 * Get branch HEAD commit SHA
 */
export async function getBranchHead(
  ownerId: number,
  repoName: string,
  branchName: string
): Promise<string> {
  return await withRepo(ownerId, repoName, async (repo) => {
    const refName = `refs/heads/${branchName}`;
    const ref = await repo.getReference(refName);
    return ref.target().tostrS();
  });
}

/**
 * Check if a branch exists
 */
export async function branchExists(
  ownerId: number,
  repoName: string,
  branchName: string
): Promise<boolean> {
  try {
    await getBranchHead(ownerId, repoName, branchName);
    return true;
  } catch {
    return false;
  }
}

/**
 * Helper: Convert nodegit Commit to CommitInfo
 */
async function commitToInfo(commit: nodegit.Commit): Promise<CommitInfo> {
  const author = commit.author();
  const committer = commit.committer();
  const parents = commit.parents();
  
  return {
    sha: commit.sha(),
    message: commit.message(),
    author: {
      name: author.name(),
      email: author.email(),
      date: author.when().time() ? new Date(author.when().time() * 1000) : new Date(),
    },
    committer: {
      name: committer.name(),
      email: committer.email(),
      date: committer.when().time() ? new Date(committer.when().time() * 1000) : new Date(),
    },
    parents: parents.map((p) => p.tostrS()),
    tree: commit.treeId().tostrS(),
  };
}
