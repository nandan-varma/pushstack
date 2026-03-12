/**
 * Git Manager Service (isomorphic-git)
 * 
 * Manages git repositories using isomorphic-git for Worker/edge compatibility.
 * This is the foundation layer for all git operations.
 */

import git from 'isomorphic-git'
import http from 'isomorphic-git/http/node'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Configuration
const GIT_BASE_PATH = process.env.GIT_REPOS_PATH || path.join(os.homedir(), '.pushstack', 'repos')
const DEFAULT_USER_NAME = 'PushStack'
const DEFAULT_USER_EMAIL = 'system@pushstack.dev'

/**
 * Get the filesystem path for a repository
 */
export function getRepoPath(ownerKey: string, repoName: string): string {
  return path.join(GIT_BASE_PATH, ownerKey, repoName)
}

export function getBareRepoOptions(ownerKey: string, repoName: string) {
  return {
    fs,
    gitdir: getRepoPath(ownerKey, repoName),
  }
}

/**
 * Ensure the base git directory exists
 */
export async function ensureGitBaseDir(): Promise<void> {
  await fs.mkdir(GIT_BASE_PATH, { recursive: true })
}

/**
 * Initialize a new repository
 */
export async function initBareRepo(ownerKey: string, repoName: string, defaultBranch: string = 'main'): Promise<string> {
  const dir = getRepoPath(ownerKey, repoName)
  
  // Ensure parent directory exists
  await fs.mkdir(path.dirname(dir), { recursive: true })
  await fs.mkdir(dir, { recursive: true })
  
  // Initialize as bare repository
  await git.init({ fs, dir, defaultBranch, bare: true })
  
  // Set default config
  await git.setConfig({ fs, dir, path: 'user.name', value: DEFAULT_USER_NAME })
  await git.setConfig({ fs, dir, path: 'user.email', value: DEFAULT_USER_EMAIL })
  
  return dir
}

/**
 * Check if a repository exists on filesystem
 */
export async function repoExists(ownerKey: string, repoName: string): Promise<boolean> {
  const dir = getRepoPath(ownerKey, repoName)
  
  try {
    // For bare repos, check for HEAD or refs directory
    await fs.access(path.join(dir, 'HEAD'))
    return true
  } catch {
    return false
  }
}

/**
 * Delete a repository from filesystem
 */
export async function deleteRepo(ownerKey: string, repoName: string): Promise<void> {
  const dir = getRepoPath(ownerKey, repoName)
  
  try {
    await fs.rm(dir, { recursive: true, force: true })
  } catch (error) {
    throw new Error(`Failed to delete repository at ${dir}: ${error}`)
  }
}

/**
 * Clone a repository
 */
export async function cloneRepo(
  url: string,
  ownerKey: string,
  repoName: string
): Promise<string> {
  const dir = getRepoPath(ownerKey, repoName)
  
  await fs.mkdir(path.dirname(dir), { recursive: true })
  
  await git.clone({
    fs,
    http,
    dir,
    url,
    singleBranch: false,
  })
  
  return dir
}

/**
 * Get disk usage of a repository
 */
export async function getRepoDiskUsage(dir: string): Promise<number> {
  let totalSize = 0

  async function calculateSize(dirPath: string) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)

      if (entry.isDirectory()) {
        await calculateSize(fullPath);
      } else {
        const stats = await fs.stat(fullPath)
        totalSize += stats.size
      }
    }
  }

  await calculateSize(dir)
  return totalSize
}

/**
 * Default author object
 */
export function getDefaultAuthor() {
  return {
    name: DEFAULT_USER_NAME,
    email: DEFAULT_USER_EMAIL,
    timestamp: Math.floor(Date.now() / 1000),
    timezoneOffset: 0,
  }
}
