/**
 * File Operations Server Functions
 * 
 * Handles file operations using real git repositories via nodegit.
 * All file/commit/branch operations now interact with actual git repos on filesystem.
 */

import { createServerFn } from '@tanstack/react-start';
import { getRequestHeaders } from '@tanstack/react-start/server';
import { db } from '../db';
import { repositories, activities, user } from '../db/github-schema';
import { auth } from '../lib/auth';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';

// Git operations imports
import * as GitOps from './git-operations';
import * as GitDiff from './git-diff';
import * as GitLFS from './git-lfs';
import { repoExists } from './git-manager';

// Get current user session helper
async function getCurrentUser() {
  const headers = getRequestHeaders();
  const session = await auth.api.getSession({ headers });
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }
  return session.user;
}

// Check write access to repository
async function canWriteToRepo(repoId: number, userId: string) {
  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.id, repoId),
  });
  
  if (!repo) {
    return false;
  }
  
  // Owner has write access
  if (repo.ownerId === userId) {
    return true;
  }
  
  // Check collaborator role
  const collab = await db.query.repositoryCollaborators.findFirst({
    where: and(
      eq(repositories.id, repoId),
      eq(repositories.ownerId, userId)
    ),
  });
  
  return collab?.role === 'write' || collab?.role === 'admin';
}

/**
 * Get repository by owner username and name
 */
export const getRepositoryByName = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => z.object({
    owner: z.string(),
    name: z.string(),
  }).parse(data))
  .handler(async ({ data }) => {
    await getCurrentUser();
    
    // Find owner by username
    const owner = await db.query.user.findFirst({
      where: eq(user.username, data.owner),
    });
    
    if (!owner) {
      throw new Error('Owner not found');
    }
    
    // Get repository
    const repo = await db.query.repositories.findFirst({
      where: and(
        eq(repositories.ownerId, owner.id),
        eq(repositories.name, data.name)
      ),
      with: {
        owner: true,
      },
    });
    
    if (!repo) {
      throw new Error('Repository not found');
    }
    
    return repo;
  });

// Upload file schema
const uploadFileSchema = z.object({
  repoId: z.number(),
  branchName: z.string(),
  path: z.string(),
  content: z.string(), // Base64 encoded content
  commitMessage: z.string(),
});

/**
 * Upload file to repository - creates a git commit
 */
export const uploadFile = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => uploadFileSchema.parse(data))
  .handler(async ({ data }) => {
    const user = await getCurrentUser();
    
    if (!(await canWriteToRepo(data.repoId, user.id))) {
      throw new Error('No write access to repository');
    }
    
    // Get repository
    const repo = await db.query.repositories.findFirst({
      where: eq(repositories.id, data.repoId),
      with: { owner: true },
    });
    
    if (!repo) {
      throw new Error('Repository not found');
    }
    
    // Decode content
    const buffer = Buffer.from(data.content, 'base64');
    
    // Process file (check for LFS)
    const ownerId = Number.parseInt(repo.ownerId, 10);
    const { content: processedContent, isLFS, lfsObject } = await GitLFS.processFileUpload(
      ownerId,
      repo.name,
      data.path,
      buffer
    );
    
    // Create commit with the file
    const commitInfo = await GitOps.createCommit(
      ownerId,
      repo.name,
      data.branchName,
      data.commitMessage,
      [{ path: data.path, content: processedContent }],
      { name: user.name || user.username || 'Unknown', email: user.email }
    );
    
    // Update repository updated_at
    await db.update(repositories)
      .set({ updatedAt: new Date() })
      .where(eq(repositories.id, data.repoId));
    
    // Log activity
    await db.insert(activities).values({
      userId: user.id,
      repoId: data.repoId,
      type: 'commit',
      metadata: { 
        commitSha: commitInfo.sha, 
        message: data.commitMessage,
        filesCount: 1,
        isLFS,
      },
    });
    
    return { 
      commit: commitInfo,
      isLFS,
      lfsObject,
    };
  });

/**
 * Get file from repository
 */
export const getFile = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => z.object({
    repoId: z.number(),
    branchName: z.string(),
    path: z.string(),
  }).parse(data))
  .handler(async ({ data }) => {
    await getCurrentUser();
    
    // Get repository
    const repo = await db.query.repositories.findFirst({
      where: eq(repositories.id, data.repoId),
    });
    
    if (!repo) {
      throw new Error('Repository not found');
    }
    
    const ownerId = Number.parseInt(repo.ownerId, 10);
    
    // Get file from git
    const fileInfo = await GitOps.getFileFromBranch(
      ownerId,
      repo.name,
      data.branchName,
      data.path
    );
    
    // Resolve LFS if needed
    let content = fileInfo.content;
    let resolvedFromLFS = false;
    
    if (!fileInfo.isBinary && GitLFS.isLFSPointer(fileInfo.content)) {
      const buffer = await GitLFS.resolveFileContent(
        ownerId,
        repo.name,
        Buffer.from(fileInfo.content, 'utf-8')
      );
      content = buffer.toString('base64');
      resolvedFromLFS = true;
    }
    
    return {
      ...fileInfo,
      content,
      resolvedFromLFS,
    };
  });

/**
 * Get presigned download URL for file
 */
export const getFileDownloadUrl = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => z.object({
    repoId: z.number(),
    branchName: z.string(),
    path: z.string(),
  }).parse(data))
  .handler(async ({ data }) => {
    await getCurrentUser();
    
    // Get repository
    const repo = await db.query.repositories.findFirst({
      where: eq(repositories.id, data.repoId),
    });
    
    if (!repo) {
      throw new Error('Repository not found');
    }
    
    const ownerId = Number.parseInt(repo.ownerId, 10);
    
    // Get file info
    const fileInfo = await GitOps.getFileFromBranch(
      ownerId,
      repo.name,
      data.branchName,
      data.path
    );
    
    // Check if LFS
    if (!fileInfo.isBinary && GitLFS.isLFSPointer(fileInfo.content)) {
      const pointer = GitLFS.parseLFSPointer(fileInfo.content);
      if (pointer) {
        const url = await GitLFS.getLFSDownloadUrl(ownerId, repo.name, pointer.oid);
        return { url, isLFS: true, size: pointer.size };
      }
    }
    
    // For non-LFS files, return content directly
    // In production, you might want to use presigned URLs for large files too
    return { 
      content: fileInfo.content, 
      isLFS: false,
      size: fileInfo.size,
    };
  });

/**
 * List files in repository directory
 */
export const listFiles = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => z.object({
    repoId: z.number(),
    branchName: z.string(),
    path: z.string().optional().default(''),
  }).parse(data))
  .handler(async ({ data }) => {
    await getCurrentUser();
    
    // Get repository
    const repo = await db.query.repositories.findFirst({
      where: eq(repositories.id, data.repoId),
    });
    
    if (!repo) {
      throw new Error('Repository not found');
    }
    
    const ownerId = Number.parseInt(repo.ownerId, 10);
    
    // Get tree from git
    const entries = await GitOps.getTreeFromBranch(
      ownerId,
      repo.name,
      data.branchName,
      data.path
    );
    
    return entries;
  });

/**
 * Delete file from repository
 */
export const deleteFile = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => z.object({
    repoId: z.number(),
    branchName: z.string(),
    path: z.string(),
    commitMessage: z.string(),
  }).parse(data))
  .handler(async ({ data }) => {
    const user = await getCurrentUser();
    
    if (!(await canWriteToRepo(data.repoId, user.id))) {
      throw new Error('No write access to repository');
    }
    
    // Get repository
    const repo = await db.query.repositories.findFirst({
      where: eq(repositories.id, data.repoId),
    });
    
    if (!repo) {
      throw new Error('Repository not found');
    }
    
    const ownerId = Number.parseInt(repo.ownerId, 10);
    
    // Delete file and create commit
    const commitInfo = await GitOps.deleteFile(
      ownerId,
      repo.name,
      data.branchName,
      data.path,
      data.commitMessage,
      { name: user.name || user.username || 'Unknown', email: user.email }
    );
    
    // Log activity
    await db.insert(activities).values({
      userId: user.id,
      repoId: data.repoId,
      type: 'commit',
      metadata: { 
        commitSha: commitInfo.sha, 
        message: data.commitMessage,
        filesCount: 1,
      },
    });
    
    return { success: true, commit: commitInfo };
  });

/**
 * Get repository branches
 */
export const getBranches = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => z.object({
    repoId: z.number(),
  }).parse(data))
  .handler(async ({ data }) => {
    await getCurrentUser();
    
    // Get repository
    const repo = await db.query.repositories.findFirst({
      where: eq(repositories.id, data.repoId),
    });
    
    if (!repo) {
      throw new Error('Repository not found');
    }
    
    const ownerId = Number.parseInt(repo.ownerId, 10);
    
    // Get branches from git
    const branches = await GitOps.getBranches(ownerId, repo.name);
    
    return branches;
  });

/**
 * Create branch
 */
export const createBranch = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => z.object({
    repoId: z.number(),
    name: z.string(),
    fromCommitSha: z.string().optional(),
  }).parse(data))
  .handler(async ({ data }) => {
    const user = await getCurrentUser();
    
    if (!(await canWriteToRepo(data.repoId, user.id))) {
      throw new Error('No write access to repository');
    }
    
    // Get repository
    const repo = await db.query.repositories.findFirst({
      where: eq(repositories.id, data.repoId),
    });
    
    if (!repo) {
      throw new Error('Repository not found');
    }
    
    const ownerId = Number.parseInt(repo.ownerId, 10);
    
    // Create branch in git
    const branch = await GitOps.createBranch(
      ownerId,
      repo.name,
      data.name,
      data.fromCommitSha
    );
    
    return branch;
  });

/**
 * Delete branch
 */
export const deleteBranch = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => z.object({
    repoId: z.number(),
    name: z.string(),
  }).parse(data))
  .handler(async ({ data }) => {
    const user = await getCurrentUser();
    
    if (!(await canWriteToRepo(data.repoId, user.id))) {
      throw new Error('No write access to repository');
    }
    
    // Get repository
    const repo = await db.query.repositories.findFirst({
      where: eq(repositories.id, data.repoId),
    });
    
    if (!repo) {
      throw new Error('Repository not found');
    }
    
    // Don't allow deleting default branch
    if (data.name === repo.defaultBranch) {
      throw new Error('Cannot delete default branch');
    }
    
    const ownerId = Number.parseInt(repo.ownerId, 10);
    
    // Delete branch from git
    await GitOps.deleteBranch(ownerId, repo.name, data.name);
    
    return { success: true };
  });

/**
 * Get commits for a branch
 */
export const getCommits = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => z.object({
    repoId: z.number(),
    branchName: z.string(),
    limit: z.number().optional().default(50),
    skip: z.number().optional().default(0),
  }).parse(data))
  .handler(async ({ data }) => {
    await getCurrentUser();
    
    // Get repository
    const repo = await db.query.repositories.findFirst({
      where: eq(repositories.id, data.repoId),
    });
    
    if (!repo) {
      throw new Error('Repository not found');
    }
    
    const ownerId = Number.parseInt(repo.ownerId, 10);
    
    // Get commit history from git
    const commits = await GitOps.getCommitHistory(
      ownerId,
      repo.name,
      data.branchName,
      data.limit,
      data.skip
    );
    
    return commits;
  });

/**
 * Get commit details by SHA
 */
export const getCommit = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => z.object({
    repoId: z.number(),
    commitSha: z.string(),
  }).parse(data))
  .handler(async ({ data }) => {
    await getCurrentUser();
    
    // Get repository
    const repo = await db.query.repositories.findFirst({
      where: eq(repositories.id, data.repoId),
    });
    
    if (!repo) {
      throw new Error('Repository not found');
    }
    
    const ownerId = Number.parseInt(repo.ownerId, 10);
    
    // Get commit from git
    const commit = await GitOps.getCommit(ownerId, repo.name, data.commitSha);
    
    return commit;
  });

/**
 * Get commit diff
 */
export const getCommitDiff = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => z.object({
    repoId: z.number(),
    commitSha: z.string(),
  }).parse(data))
  .handler(async ({ data }) => {
    await getCurrentUser();
    
    // Get repository
    const repo = await db.query.repositories.findFirst({
      where: eq(repositories.id, data.repoId),
    });
    
    if (!repo) {
      throw new Error('Repository not found');
    }
    
    const ownerId = Number.parseInt(repo.ownerId, 10);
    
    // Get diff from git
    const diff = await GitDiff.getCommitDiff(ownerId, repo.name, data.commitSha);
    
    return diff;
  });

/**
 * Get diff between branches (for pull requests)
 */
export const getBranchDiff = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => z.object({
    repoId: z.number(),
    sourceBranch: z.string(),
    targetBranch: z.string(),
  }).parse(data))
  .handler(async ({ data }) => {
    await getCurrentUser();
    
    // Get repository
    const repo = await db.query.repositories.findFirst({
      where: eq(repositories.id, data.repoId),
    });
    
    if (!repo) {
      throw new Error('Repository not found');
    }
    
    const ownerId = Number.parseInt(repo.ownerId, 10);
    
    // Get diff from git
    const diff = await GitDiff.getDiffBetweenBranches(
      ownerId,
      repo.name,
      data.sourceBranch,
      data.targetBranch
    );
    
    return diff;
  });
