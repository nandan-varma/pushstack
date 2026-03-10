/**
 * Git Manager Service
 * 
 * Manages nodegit instances, repository paths, and git configuration.
 * This is the foundation layer for all git operations.
 */

import * as nodegit from 'nodegit';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';

// Configuration
const GIT_BASE_PATH = process.env.GIT_REPOS_PATH || path.join(process.cwd(), 'data', 'repos');
const DEFAULT_USER_NAME = 'PushStack';
const DEFAULT_USER_EMAIL = 'system@pushstack.dev';

/**
 * Get the filesystem path for a repository
 */
export function getRepoPath(ownerId: number, repoName: string): string {
  return path.join(GIT_BASE_PATH, String(ownerId), `${repoName}.git`);
}

/**
 * Ensure the base git directory exists
 */
export async function ensureGitBaseDir(): Promise<void> {
  await fs.mkdir(GIT_BASE_PATH, { recursive: true });
}

/**
 * Initialize a new bare repository
 */
export async function initBareRepo(ownerId: number, repoName: string): Promise<nodegit.Repository> {
  const repoPath = getRepoPath(ownerId, repoName);
  
  // Ensure parent directory exists
  await fs.mkdir(path.dirname(repoPath), { recursive: true });
  
  // Initialize bare repository
  const repo = await nodegit.Repository.initExt(repoPath, {
    flags: nodegit.Repository.INIT_FLAG.BARE,
    mode: nodegit.Repository.INIT_MODE.SHARED_ALL,
  });
  
  // Create default config
  const config = await repo.config();
  await config.setString('user.name', DEFAULT_USER_NAME);
  await config.setString('user.email', DEFAULT_USER_EMAIL);
  
  return repo;
}

/**
 * Open an existing repository
 */
export async function openRepo(ownerId: number, repoName: string): Promise<nodegit.Repository> {
  const repoPath = getRepoPath(ownerId, repoName);
  
  try {
    return await nodegit.Repository.open(repoPath);
  } catch (error) {
    throw new Error(`Failed to open repository at ${repoPath}: ${error}`);
  }
}

/**
 * Check if a repository exists on filesystem
 */
export async function repoExists(ownerId: number, repoName: string): Promise<boolean> {
  const repoPath = getRepoPath(ownerId, repoName);
  
  try {
    await fs.access(repoPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete a repository from filesystem
 */
export async function deleteRepo(ownerId: number, repoName: string): Promise<void> {
  const repoPath = getRepoPath(ownerId, repoName);
  
  try {
    await fs.rm(repoPath, { recursive: true, force: true });
  } catch (error) {
    throw new Error(`Failed to delete repository at ${repoPath}: ${error}`);
  }
}

/**
 * Get OID (object ID) from SHA string
 */
export function getOid(sha: string): nodegit.Oid {
  return nodegit.Oid.fromString(sha);
}

/**
 * Create a signature for commits
 */
export function createSignature(name: string, email: string): nodegit.Signature {
  return nodegit.Signature.now(name, email);
}

/**
 * Get repository disk usage in bytes
 */
export async function getRepoDiskUsage(ownerId: number, repoName: string): Promise<number> {
  const repoPath = getRepoPath(ownerId, repoName);
  
  async function getDirectorySize(dirPath: string): Promise<number> {
    let size = 0;
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        size += await getDirectorySize(fullPath);
      } else {
        const stats = await fs.stat(fullPath);
        size += stats.size;
      }
    }
    
    return size;
  }
  
  try {
    return await getDirectorySize(repoPath);
  } catch {
    return 0;
  }
}

/**
 * Clone a repository (for forking)
 */
export async function cloneRepo(
  sourceOwnerId: number,
  sourceRepoName: string,
  targetOwnerId: number,
  targetRepoName: string
): Promise<nodegit.Repository> {
  const sourcePath = getRepoPath(sourceOwnerId, sourceRepoName);
  const targetPath = getRepoPath(targetOwnerId, targetRepoName);
  
  // Ensure target parent directory exists
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  
  // Clone as bare repository
  return await nodegit.Clone.clone(sourcePath, targetPath, {
    bare: 1,
  });
}

/**
 * Run git garbage collection
 */
export async function runGarbageCollection(ownerId: number, repoName: string): Promise<void> {
  const repo = await openRepo(ownerId, repoName);
  
  // Get the ODB (object database) and optimize it
  const odb = await repo.odb();
  // Note: nodegit doesn't expose gc directly, but we can use git command
  // For production, you'd want to periodically run: git gc --aggressive --prune=now
}

/**
 * Verify repository integrity
 */
export async function verifyRepo(ownerId: number, repoName: string): Promise<boolean> {
  try {
    const repo = await openRepo(ownerId, repoName);
    
    // Try to access HEAD to verify basic structure
    await repo.head();
    
    return true;
  } catch {
    return false;
  }
}

/**
 * Get repository HEAD reference
 */
export async function getHead(ownerId: number, repoName: string): Promise<nodegit.Reference> {
  const repo = await openRepo(ownerId, repoName);
  return await repo.head();
}

/**
 * Helper to safely handle repository operations with automatic cleanup
 */
export async function withRepo<T>(
  ownerId: number,
  repoName: string,
  operation: (repo: nodegit.Repository) => Promise<T>
): Promise<T> {
  const repo = await openRepo(ownerId, repoName);
  
  try {
    return await operation(repo);
  } finally {
    // nodegit handles cleanup automatically, but we can add explicit cleanup if needed
    repo.free();
  }
}
