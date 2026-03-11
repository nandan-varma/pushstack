/**
 * Git Operations Service (isomorphic-git)
 *
 * Reads directly from hydrated bare repositories and uses temporary worktrees
 * for mutations that require a checkout.
 */

import git from 'isomorphic-git'
import fs from 'node:fs'
import path from 'node:path'
import { getBareRepoOptions, getDefaultAuthor } from './git-manager-iso'
import { ensureRepositoryHydrated, syncRepositoryToR2, withRepositoryWorktree } from './git-repo-storage'

export interface Branch {
  name: string
  commit: string
  isDefault: boolean
}

export interface TreeEntry {
  path: string
  mode: string
  type: 'blob' | 'tree'
  oid: string
  size?: number
}

export interface CommitInfo {
  oid: string
  commit: {
    message: string
    tree: string
    parent: string[]
    author: {
      name: string
      email: string
      timestamp: number
      timezoneOffset: number
    }
    committer: {
      name: string
      email: string
      timestamp: number
      timezoneOffset: number
    }
  }
  payload: string
}

async function getRepoOptions(ownerId: number, repoName: string) {
  await ensureRepositoryHydrated(ownerId, repoName)
  return getBareRepoOptions(ownerId, repoName)
}

async function resolveCommit(ownerId: number, repoName: string, ref: string) {
  const repo = await getRepoOptions(ownerId, repoName)
  const oid = await git.resolveRef({ ...repo, ref })
  const result = await git.readCommit({ ...repo, oid })

  return {
    repo,
    oid,
    commit: result.commit,
  }
}

async function findTreeEntry(
  repo: Awaited<ReturnType<typeof getRepoOptions>>,
  rootTreeOid: string,
  treePath: string,
): Promise<TreeEntry | null> {
  if (!treePath) {
    return {
      path: '',
      mode: '040000',
      type: 'tree',
      oid: rootTreeOid,
    }
  }

  const parts = treePath.split('/').filter(Boolean)
  let currentTreeOid = rootTreeOid
  let currentPath = ''

  for (const [index, part] of parts.entries()) {
    const tree = await git.readTree({ ...repo, oid: currentTreeOid })
    const entry = tree.tree.find((candidate) => candidate.path === part)

    if (!entry) {
      return null
    }

    currentPath = currentPath ? path.posix.join(currentPath, entry.path) : entry.path

    if (index === parts.length - 1) {
      return {
        path: currentPath,
        mode: entry.mode,
        type: entry.type as 'blob' | 'tree',
        oid: entry.oid,
      }
    }

    if (entry.type !== 'tree') {
      return null
    }

    currentTreeOid = entry.oid
  }

  return null
}

async function listTreeEntries(
  repo: Awaited<ReturnType<typeof getRepoOptions>>,
  treeOid: string,
  prefix: string = '',
): Promise<TreeEntry[]> {
  const tree = await git.readTree({ ...repo, oid: treeOid })

  return tree.tree.map((entry) => ({
    path: prefix ? path.posix.join(prefix, entry.path) : entry.path,
    mode: entry.mode,
    type: entry.type as 'blob' | 'tree',
    oid: entry.oid,
  }))
}

/**
 * Create a commit with files.
 */
export async function createCommit(
  ownerId: number,
  repoName: string,
  message: string,
  files: Array<{ path: string; content: string | Buffer }>,
  authorName?: string,
  authorEmail?: string,
  branch: string = 'main',
): Promise<string> {
  const author = authorName && authorEmail
    ? { name: authorName, email: authorEmail, timestamp: Math.floor(Date.now() / 1000), timezoneOffset: 0 }
    : getDefaultAuthor()

  return withRepositoryWorktree(ownerId, repoName, branch, async ({ worktreePath }) => {
    for (const file of files) {
      const filePath = path.join(worktreePath, file.path)
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, file.content)
    }

    for (const file of files) {
      await git.add({ fs, dir: worktreePath, filepath: file.path })
    }

    await git.setConfig({ fs, dir: worktreePath, path: 'user.name', value: author.name })
    await git.setConfig({ fs, dir: worktreePath, path: 'user.email', value: author.email })

    return git.commit({
      fs,
      dir: worktreePath,
      message,
      author,
      committer: author,
    })
  })
}

/**
 * Get list of branches.
 */
export async function getBranches(ownerId: number, repoName: string): Promise<Branch[]> {
  const repo = await getRepoOptions(ownerId, repoName)
  const branches = await git.listBranches(repo)
  const currentBranch = await git.currentBranch({ ...repo, fullname: false })

  return Promise.all(branches.map(async (branch) => ({
    name: branch,
    commit: await git.resolveRef({ ...repo, ref: `refs/heads/${branch}` }),
    isDefault: branch === currentBranch,
  })))
}

/**
 * Create a new branch.
 */
export async function createBranch(
  ownerId: number,
  repoName: string,
  branchName: string,
  startPoint: string = 'main',
): Promise<void> {
  const repo = await getRepoOptions(ownerId, repoName)
  const object = await git.resolveRef({ ...repo, ref: `refs/heads/${startPoint}` })
  await git.branch({ ...repo, ref: branchName, checkout: false, object })
  await syncRepositoryToR2(ownerId, repoName)
}

/**
 * Delete a branch.
 */
export async function deleteBranch(
  ownerId: number,
  repoName: string,
  branchName: string,
): Promise<void> {
  const repo = await getRepoOptions(ownerId, repoName)
  await git.deleteBranch({ ...repo, ref: branchName })
  await syncRepositoryToR2(ownerId, repoName)
}

/**
 * Get a blob by OID.
 */
export async function getBlob(
  ownerId: number,
  repoName: string,
  sha: string,
): Promise<Buffer> {
  const repo = await getRepoOptions(ownerId, repoName)
  const { blob } = await git.readBlob({ ...repo, oid: sha })
  return Buffer.from(blob)
}

/**
 * Get file content from a ref.
 */
export async function getFileContent(
  ownerId: number,
  repoName: string,
  filePath: string,
  ref: string = 'main',
): Promise<Buffer> {
  const { repo, commit } = await resolveCommit(ownerId, repoName, ref)
  const entry = await findTreeEntry(repo, commit.tree, filePath)

  if (!entry || entry.type !== 'blob') {
    throw new Error(`File not found: ${filePath}`)
  }

  const { blob } = await git.readBlob({ ...repo, oid: entry.oid })
  return Buffer.from(blob)
}

/**
 * Get tree entries for a ref.
 */
export async function getTree(
  ownerId: number,
  repoName: string,
  ref: string = 'main',
  treePath: string = '',
): Promise<TreeEntry[]> {
  return getTreeFromBranch(ownerId, repoName, ref, treePath)
}

/**
 * Get commit information.
 */
export async function getCommit(
  ownerId: number,
  repoName: string,
  sha: string,
): Promise<CommitInfo> {
  const repo = await getRepoOptions(ownerId, repoName)
  const result = await git.readCommit({ ...repo, oid: sha })

  return {
    oid: result.oid,
    commit: result.commit,
    payload: result.payload,
  }
}

/**
 * Get commit log.
 */
export async function getCommitLog(
  ownerId: number,
  repoName: string,
  ref: string = 'main',
  depth: number = 50,
): Promise<CommitInfo[]> {
  const repo = await getRepoOptions(ownerId, repoName)
  const commits = await git.log({ ...repo, ref, depth })

  return commits.map((commit) => ({
    oid: commit.oid,
    commit: commit.commit,
    payload: commit.payload || '',
  }))
}

/**
 * Checkout validation for compatibility with older callers.
 */
export async function checkoutBranch(
  ownerId: number,
  repoName: string,
  branchName: string,
): Promise<void> {
  const repo = await getRepoOptions(ownerId, repoName)
  await git.resolveRef({ ...repo, ref: `refs/heads/${branchName}` })
}

/**
 * Get a file from a branch.
 */
export async function getFileFromBranch(
  ownerId: number,
  repoName: string,
  branchName: string,
  filePath: string,
): Promise<{ content: string; size: number; isBinary: boolean }> {
  const buffer = await getFileContent(ownerId, repoName, filePath, branchName)
  const isBinary = buffer.includes(0)

  return {
    content: isBinary ? buffer.toString('base64') : buffer.toString('utf-8'),
    size: buffer.length,
    isBinary,
  }
}

/**
 * Get tree entries from a branch with an optional subdirectory path.
 */
export async function getTreeFromBranch(
  ownerId: number,
  repoName: string,
  branchName: string,
  treePath: string = '',
): Promise<TreeEntry[]> {
  const { repo, commit } = await resolveCommit(ownerId, repoName, branchName)

  if (!treePath) {
    return listTreeEntries(repo, commit.tree)
  }

  const entry = await findTreeEntry(repo, commit.tree, treePath)

  if (!entry || entry.type !== 'tree') {
    return []
  }

  return listTreeEntries(repo, entry.oid, entry.path)
}

/**
 * Delete a file by creating a commit without it.
 */
export async function deleteFile(
  ownerId: number,
  repoName: string,
  branchName: string,
  filePath: string,
  message: string,
  author: { name: string; email: string },
): Promise<{ sha: string; message: string }> {
  const authorInfo = {
    name: author.name,
    email: author.email,
    timestamp: Math.floor(Date.now() / 1000),
    timezoneOffset: 0,
  }

  const sha = await withRepositoryWorktree(ownerId, repoName, branchName, async ({ worktreePath }) => {
    const fullPath = path.join(worktreePath, filePath)
    fs.rmSync(fullPath, { force: true })
    await git.remove({ fs, dir: worktreePath, filepath: filePath })
    await git.setConfig({ fs, dir: worktreePath, path: 'user.name', value: authorInfo.name })
    await git.setConfig({ fs, dir: worktreePath, path: 'user.email', value: authorInfo.email })

    return git.commit({
      fs,
      dir: worktreePath,
      message,
      author: authorInfo,
      committer: authorInfo,
    })
  })

  return { sha, message }
}

/**
 * Get commit history with skip/limit.
 */
export async function getCommitHistory(
  ownerId: number,
  repoName: string,
  branchName: string,
  limit: number = 50,
  skip: number = 0,
): Promise<CommitInfo[]> {
  const all = await getCommitLog(ownerId, repoName, branchName, limit + skip)
  return all.slice(skip, skip + limit)
}
