/**
 * Git Operations Service (isomorphic-git)
 * 
 * Core git operations like commit, branch, blob, and tree operations.
 */

import git from 'isomorphic-git';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getRepoPath, getDefaultAuthor } from './git-manager-iso';

export interface Branch {
  name: string;
  commit: string;
  isDefault: boolean;
}

export interface TreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  oid: string;
  size?: number;
}

export interface CommitInfo {
  oid: string;
  commit: {
    message: string;
    tree: string;
    parent: string[];
    author: {
      name: string;
      email: string;
      timestamp: number;
      timezoneOffset: number;
    };
    committer: {
      name: string;
      email: string;
      timestamp: number;
      timezoneOffset: number;
    };
  };
  payload: string;
}

/**
 * Create a commit with files
 */
export async function createCommit(
  ownerId: number,
  repoName: string,
  message: string,
  files: Array<{ path: string; content: string | Buffer }>,
  authorName?: string,
  authorEmail?: string,
  _branch: string = 'main' // TODO: Use branch parameter for checkout
): Promise<string> {
  const dir = getRepoPath(ownerId, repoName);
  
  const author = authorName && authorEmail
    ? { name: authorName, email: authorEmail, timestamp: Math.floor(Date.now() / 1000), timezoneOffset: 0 }
    : getDefaultAuthor();

  // Write files to the working directory
  for (const file of files) {
    const filePath = path.join(dir, file.path);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, file.content);
  }

  // Stage files
  for (const file of files) {
    await git.add({ fs, dir, filepath: file.path });
  }

  // Commit
  const commitOid = await git.commit({
    fs,
    dir,
    message,
    author,
    committer: author,
  });

  return commitOid;
}

/**
 * Get list of branches
 */
export async function getBranches(ownerId: number, repoName: string): Promise<Branch[]> {
  const dir = getRepoPath(ownerId, repoName);
  
  const branches = await git.listBranches({ fs, dir });
  const currentBranch = await git.currentBranch({ fs, dir, fullname: false });

  const result: Branch[] = [];

  for (const branch of branches) {
    const ref = await git.resolveRef({ fs, dir, ref: `refs/heads/${branch}` });
    result.push({
      name: branch,
      commit: ref,
      isDefault: branch === currentBranch,
    });
  }

  return result;
}

/**
 * Create a new branch
 */
export async function createBranch(
  ownerId: number,
  repoName: string,
  branchName: string,
  startPoint: string = 'main'
): Promise<void> {
  const dir = getRepoPath(ownerId, repoName);
  
  const ref = await git.resolveRef({ fs, dir, ref: `refs/heads/${startPoint}` });
  await git.branch({ fs, dir, ref: branchName, checkout: false, object: ref });
}

/**
 * Delete a branch
 */
export async function deleteBranch(
  ownerId: number,
  repoName: string,
  branchName: string
): Promise<void> {
  const dir = getRepoPath(ownerId, repoName);
  
  await git.deleteBranch({ fs, dir, ref: branchName });
}

/**
 * Get a blob (file content)
 */
export async function getBlob(
  ownerId: number,
  repoName: string,
  sha: string
): Promise<Buffer> {
  const dir = getRepoPath(ownerId, repoName);
  
  const { blob } = await git.readBlob({ fs, dir, oid: sha });
  return Buffer.from(blob);
}

/**
 * Get file content from a branch
 */
export async function getFileContent(
  ownerId: number,
  repoName: string,
  filePath: string,
  ref: string = 'main'
): Promise<Buffer> {
  const dir = getRepoPath(ownerId, repoName);
  
  const { blob } = await git.readBlob({ fs, dir, oid: ref, filepath: filePath });
  return Buffer.from(blob);
}

/**
 * Get tree entries (directory listing)
 */
export async function getTree(
  ownerId: number,
  repoName: string,
  ref: string = 'main',
  _treePath: string = '' // TODO: Implement subdirectory listing
): Promise<TreeEntry[]> {
  const dir = getRepoPath(ownerId, repoName);
  
  const commitOid = await git.resolveRef({ fs, dir, ref });
  const { commit } = await git.readCommit({ fs, dir, oid: commitOid });
  
  const tree = await git.readTree({ fs, dir, oid: commit.tree });
  
  return tree.tree.map((entry) => ({
    path: entry.path,
    mode: entry.mode,
    type: entry.type as 'blob' | 'tree',
    oid: entry.oid,
  }));
}

/**
 * Get commit information
 */
export async function getCommit(
  ownerId: number,
  repoName: string,
  sha: string
): Promise<CommitInfo> {
  const dir = getRepoPath(ownerId, repoName);
  
  const result = await git.readCommit({ fs, dir, oid: sha });
  
  return {
    oid: result.oid,
    commit: result.commit,
    payload: result.payload,
  };
}

/**
 * Get commit log
 */
export async function getCommitLog(
  ownerId: number,
  repoName: string,
  ref: string = 'main',
  depth: number = 50
): Promise<CommitInfo[]> {
  const dir = getRepoPath(ownerId, repoName);
  
  const commits = await git.log({ fs, dir, ref, depth });
  
  return commits.map((c) => ({
    oid: c.oid,
    commit: c.commit,
    payload: c.payload || '',
  }));
}

/**
 * Checkout a branch
 */
export async function checkoutBranch(
  ownerId: number,
  repoName: string,
  branchName: string
): Promise<void> {
  const dir = getRepoPath(ownerId, repoName);
  
  await git.checkout({ fs, dir, ref: branchName });
}

/**
 * Get a file from a branch (simpler API)
 */
export async function getFileFromBranch(
  ownerId: number,
  repoName: string,
  branchName: string,
  filePath: string
): Promise<{ content: string; size: number; isBinary: boolean }> {
  const buffer = await getFileContent(ownerId, repoName, filePath, branchName);
  
  // Check if binary (simple check - presence of null bytes)
  const isBinary = buffer.includes(0);
  
  return {
    content: isBinary ? buffer.toString('base64') : buffer.toString('utf-8'),
    size: buffer.length,
    isBinary,
  };
}

/**
 * Get tree entries from a branch with path
 */
export async function getTreeFromBranch(
  ownerId: number,
  repoName: string,
  branchName: string,
  treePath: string = ''
): Promise<TreeEntry[]> {
  const dir = getRepoPath(ownerId, repoName);
  
  const commitOid = await git.resolveRef({ fs, dir, ref: branchName });
  const { commit } = await git.readCommit({ fs, dir, oid: commitOid });
  
  // If no path specified, read root tree
  if (!treePath) {
    const tree = await git.readTree({ fs, dir, oid: commit.tree });
    return tree.tree.map((entry) => ({
      path: entry.path,
      mode: entry.mode,
      type: entry.type as 'blob' | 'tree',
      oid: entry.oid,
    }));
  }
  
  // Navigate to the specified path
  const { oid } = await git.readBlob({ fs, dir, oid: commitOid, filepath: treePath });
  
  // Try to read as tree
  try {
    const tree = await git.readTree({ fs, dir, oid });
    return tree.tree.map((entry) => ({
      path: path.join(treePath, entry.path),
      mode: entry.mode,
      type: entry.type as 'blob' | 'tree',
      oid: entry.oid,
    }));
  } catch {
    // Not a tree, return empty
    return [];
  }
}

/**
 * Delete a file (creates commit without the file)
 */
export async function deleteFile(
  ownerId: number,
  repoName: string,
  _branchName: string, // TODO: Use branch for checkout before deletion
  filePath: string,
  message: string,
  author: { name: string; email: string }
): Promise<{ sha: string; message: string }> {
  const dir = getRepoPath(ownerId, repoName);
  
  const authorInfo = {
    name: author.name,
    email: author.email,
    timestamp: Math.floor(Date.now() / 1000),
    timezoneOffset: 0,
  };
  
  // Remove the file from working directory
  const fullPath = path.join(dir, filePath);
  await fs.rm(fullPath, { force: true });
  
  // Stage deletion
  await git.remove({ fs, dir, filepath: filePath });
  
  // Commit
  const commitOid = await git.commit({
    fs,
    dir,
    message,
    author: authorInfo,
    committer: authorInfo,
  });
  
  return { sha: commitOid, message };
}

/**
 * Get commit history (wrapper for log)
 */
export async function getCommitHistory(
  ownerId: number,
  repoName: string,
  branchName: string,
  limit: number = 50,
  skip: number = 0
): Promise<CommitInfo[]> {
  const all = await getCommitLog(ownerId, repoName, branchName, limit + skip);
  return all.slice(skip, skip + limit);
}

