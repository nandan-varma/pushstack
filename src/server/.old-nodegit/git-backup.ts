/**
 * Git Backup Service
 * 
 * Handle repository backups to R2 using git bundles and restoration.
 */

import * as nodegit from 'nodegit';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { openRepo, getRepoPath, withRepo } from './git-manager';
import { uploadToR2, downloadFromR2 } from '#/lib/r2-operations';

export interface BackupInfo {
  timestamp: Date;
  size: number;
  r2Key: string;
  commitCount: number;
  branches: string[];
}

/**
 * Create a git bundle and backup to R2
 */
export async function backupRepositoryToR2(
  ownerId: number,
  repoName: string
): Promise<BackupInfo> {
  return await withRepo(ownerId, repoName, async (repo) => {
    const repoPath = getRepoPath(ownerId, repoName);
    const timestamp = new Date();
    const bundleFilename = `${repoName}-${timestamp.getTime()}.bundle`;
    const bundlePath = path.join('/tmp', bundleFilename);
    
    // Get all branches to include in bundle
    const refs = await repo.getReferences();
    const branches: string[] = [];
    
    for (const ref of refs) {
      if (ref.isBranch()) {
        branches.push(ref.name());
      }
    }
    
    // Create bundle using git command (nodegit doesn't have bundle API)
    const { exec } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execAsync = promisify(exec);
    
    try {
      // Create bundle with all refs
      await execAsync(
        `git bundle create "${bundlePath}" --all`,
        { cwd: repoPath }
      );
      
      // Get bundle file size
      const stats = await fs.stat(bundlePath);
      
      // Upload to R2
      const r2Key = `backups/${ownerId}/${bundleFilename}`;
      const bundleContent = await fs.readFile(bundlePath);
      await uploadToR2(r2Key, bundleContent);
      
      // Get commit count
      const head = await repo.head();
      const commit = await repo.getCommit(head.target());
      const history = await (commit.history() as any).getCommitsUntil(() => true);
      
      // Clean up local bundle file
      await fs.unlink(bundlePath);
      
      return {
        timestamp,
        size: stats.size,
        r2Key,
        commitCount: history.length,
        branches,
      };
    } catch (error) {
      // Clean up on error
      try {
        await fs.unlink(bundlePath);
      } catch {
        // Ignore cleanup errors
      }
      throw new Error(`Backup failed: ${error}`);
    }
  });
}

/**
 * Restore a repository from R2 backup
 */
export async function restoreRepositoryFromR2(
  ownerId: number,
  repoName: string,
  r2Key: string
): Promise<{ success: boolean; message: string }> {
  const repoPath = getRepoPath(ownerId, repoName);
  const bundlePath = path.join('/tmp', `restore-${Date.now()}.bundle`);
  
  try {
    // Download bundle from R2
    const bundleContent = await downloadFromR2(r2Key);
    if (!bundleContent) {
      throw new Error('Bundle not found in R2');
    }
    
    await fs.writeFile(bundlePath, bundleContent);
    
    // Verify bundle
    const { exec } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execAsync = promisify(exec);
    
    await execAsync(`git bundle verify "${bundlePath}"`);
    
    // Ensure parent directory exists
    await fs.mkdir(path.dirname(repoPath), { recursive: true });
    
    // Clone from bundle
    await nodegit.Repository.initExt(repoPath, {
      flags: nodegit.Repository.INIT_FLAG.BARE,
    });
    
    // Fetch from bundle
    await execAsync(
      `git fetch "${bundlePath}" 'refs/heads/*:refs/heads/*'`,
      { cwd: repoPath }
    );
    
    // Clean up bundle file
    await fs.unlink(bundlePath);
    
    return {
      success: true,
      message: 'Repository restored successfully',
    };
  } catch (error) {
    // Clean up on error
    try {
      await fs.unlink(bundlePath);
    } catch {
      // Ignore cleanup errors
    }
    
    return {
      success: false,
      message: `Restore failed: ${error}`,
    };
  }
}

/**
 * List available backups for a repository
 */
export async function listBackups(
  ownerId: number,
  repoName: string
): Promise<Array<{ r2Key: string; timestamp: Date; size?: number }>> {
  // Note: This requires implementing R2 list functionality
  // For now, return empty array - implement when R2 list is available
  return [];
}

/**
 * Archive inactive repository to R2 and remove from filesystem
 */
export async function archiveRepository(
  ownerId: number,
  repoName: string
): Promise<{ r2Key: string; size: number }> {
  const backupInfo = await backupRepositoryToR2(ownerId, repoName);
  
  // Remove from filesystem
  const { deleteRepo } = await import('./git-manager');
  await deleteRepo(ownerId, repoName);
  
  return {
    r2Key: backupInfo.r2Key,
    size: backupInfo.size,
  };
}

/**
 * Restore archived repository from R2
 */
export async function restoreArchivedRepository(
  ownerId: number,
  repoName: string,
  r2Key: string
): Promise<{ success: boolean; message: string }> {
  return await restoreRepositoryFromR2(ownerId, repoName, r2Key);
}

/**
 * Create incremental backup (only changes since last backup)
 */
export async function createIncrementalBackup(
  ownerId: number,
  repoName: string,
  lastBackupCommitSha?: string
): Promise<BackupInfo> {
  // For simplicity, we'll do a full backup
  // In production, you could create incremental bundles with commit ranges
  return await backupRepositoryToR2(ownerId, repoName);
}

/**
 * Schedule automatic backups (to be called by cron/scheduler)
 */
export async function scheduleBackup(
  ownerId: number,
  repoName: string,
  interval: 'daily' | 'weekly' | 'monthly'
): Promise<void> {
  // This is a placeholder for integration with a job scheduler
  // In production, integrate with a task queue like Bull or cron
  
  // For now, just perform an immediate backup
  await backupRepositoryToR2(ownerId, repoName);
}
