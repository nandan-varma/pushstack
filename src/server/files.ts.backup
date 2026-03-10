import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { db } from '../db'
import { repositoryFiles, commits, branches, repositories, activities } from '../db/schema'
import { auth } from '../lib/auth'
import { uploadToR2, getPresignedDownloadUrl, deleteFromR2, getFileFromR2 } from '../lib/r2-operations'
import { eq, and, desc } from 'drizzle-orm'
import { z } from 'zod'

// Get current user session helper
async function getCurrentUser() {
  const headers = getRequestHeaders()
  const session = await auth.api.getSession({ headers })
  if (!session?.user?.id) {
    throw new Error('Unauthorized')
  }
  return session.user
}

// Check write access to repository
async function canWriteToRepo(repoId: number, userId: string) {
  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.id, repoId),
  })
  
  if (!repo) {
    return false
  }
  
  // Owner has write access
  if (repo.ownerId === userId) {
    return true
  }
  
  // Check collaborator role
  const collab = await db.query.repositoryCollaborators.findFirst({
    where: and(
      eq(db.query.repositoryCollaborators.repoId, repoId),
      eq(db.query.repositoryCollaborators.userId, userId)
    ),
  })
  
  return collab?.role === 'write' || collab?.role === 'admin'
}

// Upload file schema
const uploadFileSchema = z.object({
  repoId: z.number(),
  branchName: z.string(),
  path: z.string(),
  content: z.string(), // Base64 encoded content
  commitMessage: z.string(),
})

// Upload file to repository
export const uploadFile = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => uploadFileSchema.parse(data))
  .handler(async ({ data }) => {
    const user = await getCurrentUser()
    
    if (!(await canWriteToRepo(data.repoId, user.id))) {
      throw new Error('No write access to repository')
    }
    
    // Get or create branch
    let branch = await db.query.branches.findFirst({
      where: and(
        eq(branches.repoId, data.repoId),
        eq(branches.name, data.branchName)
      ),
    })
    
    if (!branch) {
      // Create new branch
      const [newBranch] = await db.insert(branches).values({
        repoId: data.repoId,
        name: data.branchName,
        isDefault: false,
      }).returning()
      branch = newBranch
    }
    
    // Generate R2 key
    const r2Key = `repo-${data.repoId}/branch-${branch.id}/${data.path}`
    
    // Upload to R2
    const buffer = Buffer.from(data.content, 'base64')
    await uploadToR2(r2Key, buffer, 'application/octet-stream')
    
    // Check if file exists
    const existingFile = await db.query.repositoryFiles.findFirst({
      where: and(
        eq(repositoryFiles.repoId, data.repoId),
        eq(repositoryFiles.branchId, branch.id),
        eq(repositoryFiles.path, data.path)
      ),
    })
    
    let file
    if (existingFile) {
      // Update existing file
      [file] = await db.update(repositoryFiles)
        .set({
          r2Key,
          size: buffer.length,
          updatedAt: new Date(),
        })
        .where(eq(repositoryFiles.id, existingFile.id))
        .returning()
    } else {
      // Create new file
      [file] = await db.insert(repositoryFiles).values({
        repoId: data.repoId,
        branchId: branch.id,
        path: data.path,
        r2Key,
        size: buffer.length,
        type: 'file',
      }).returning()
    }
    
    // Create commit
    const [commit] = await db.insert(commits).values({
      repoId: data.repoId,
      branchId: branch.id,
      authorId: user.id,
      message: data.commitMessage,
      filesChanged: [{ path: data.path, action: existingFile ? 'modified' : 'added', r2Key }],
    }).returning()
    
    // Update file with commit ID
    await db.update(repositoryFiles)
      .set({ lastCommitId: commit.id })
      .where(eq(repositoryFiles.id, file.id))
    
    // Update branch with latest commit
    await db.update(branches)
      .set({ lastCommitId: commit.id })
      .where(eq(branches.id, branch.id))
    
    // Update repository updated_at
    await db.update(repositories)
      .set({ updatedAt: new Date() })
      .where(eq(repositories.id, data.repoId))
    
    // Log activity
    await db.insert(activities).values({
      userId: user.id,
      repoId: data.repoId,
      type: 'commit',
      metadata: { 
        commitId: commit.id, 
        message: data.commitMessage,
        filesCount: 1,
      },
    })
    
    return { file, commit }
  })

// Get file from repository
export const getFile = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => z.object({
    repoId: z.number(),
    branchName: z.string(),
    path: z.string(),
  }).parse(data))
  .handler(async ({ data }) => {
    await getCurrentUser()
    
    // Get branch
    const branch = await db.query.branches.findFirst({
      where: and(
        eq(branches.repoId, data.repoId),
        eq(branches.name, data.branchName)
      ),
    })
    
    if (!branch) {
      throw new Error('Branch not found')
    }
    
    // Get file metadata
    const file = await db.query.repositoryFiles.findFirst({
      where: and(
        eq(repositoryFiles.repoId, data.repoId),
        eq(repositoryFiles.branchId, branch.id),
        eq(repositoryFiles.path, data.path)
      ),
      with: {
        lastCommit: {
          with: {
            author: true,
          },
        },
      },
    })
    
    if (!file) {
      throw new Error('File not found')
    }
    
    // Get file content from R2
    const content = await getFileFromR2(file.r2Key)
    
    return {
      ...file,
      content: content.toString('base64'),
    }
  })

// Get presigned download URL for file
export const getFileDownloadUrl = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => z.object({
    repoId: z.number(),
    branchName: z.string(),
    path: z.string(),
  }).parse(data))
  .handler(async ({ data }) => {
    await getCurrentUser()
    
    // Get branch
    const branch = await db.query.branches.findFirst({
      where: and(
        eq(branches.repoId, data.repoId),
        eq(branches.name, data.branchName)
      ),
    })
    
    if (!branch) {
      throw new Error('Branch not found')
    }
    
    // Get file metadata
    const file = await db.query.repositoryFiles.findFirst({
      where: and(
        eq(repositoryFiles.repoId, data.repoId),
        eq(repositoryFiles.branchId, branch.id),
        eq(repositoryFiles.path, data.path)
      ),
    })
    
    if (!file) {
      throw new Error('File not found')
    }
    
    // Generate presigned URL (valid for 1 hour)
    const url = await getPresignedDownloadUrl(file.r2Key, 3600)
    
    return { url, file }
  })

// List files in repository
export const listFiles = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => z.object({
    repoId: z.number(),
    branchName: z.string(),
    path: z.string().optional(),
  }).parse(data))
  .handler(async ({ data }) => {
    await getCurrentUser()
    
    // Get branch
    const branch = await db.query.branches.findFirst({
      where: and(
        eq(branches.repoId, data.repoId),
        eq(branches.name, data.branchName)
      ),
    })
    
    if (!branch) {
      throw new Error('Branch not found')
    }
    
    // Get all files in branch
    const files = await db.query.repositoryFiles.findMany({
      where: and(
        eq(repositoryFiles.repoId, data.repoId),
        eq(repositoryFiles.branchId, branch.id)
      ),
      with: {
        lastCommit: {
          with: {
            author: true,
          },
        },
      },
      orderBy: [repositoryFiles.path],
    })
    
    // Filter by path if provided
    if (data.path) {
      const prefix = data.path.endsWith('/') ? data.path : `${data.path}/`
      return files.filter(f => f.path.startsWith(prefix))
    }
    
    return files
  })

// Delete file from repository
export const deleteFile = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => z.object({
    repoId: z.number(),
    branchName: z.string(),
    path: z.string(),
    commitMessage: z.string(),
  }).parse(data))
  .handler(async ({ data }) => {
    const user = await getCurrentUser()
    
    if (!(await canWriteToRepo(data.repoId, user.id))) {
      throw new Error('No write access to repository')
    }
    
    // Get branch
    const branch = await db.query.branches.findFirst({
      where: and(
        eq(branches.repoId, data.repoId),
        eq(branches.name, data.branchName)
      ),
    })
    
    if (!branch) {
      throw new Error('Branch not found')
    }
    
    // Get file
    const file = await db.query.repositoryFiles.findFirst({
      where: and(
        eq(repositoryFiles.repoId, data.repoId),
        eq(repositoryFiles.branchId, branch.id),
        eq(repositoryFiles.path, data.path)
      ),
    })
    
    if (!file) {
      throw new Error('File not found')
    }
    
    // Delete from R2
    await deleteFromR2(file.r2Key)
    
    // Delete from database
    await db.delete(repositoryFiles)
      .where(eq(repositoryFiles.id, file.id))
    
    // Create commit
    const [commit] = await db.insert(commits).values({
      repoId: data.repoId,
      branchId: branch.id,
      authorId: user.id,
      message: data.commitMessage,
      filesChanged: [{ path: data.path, action: 'deleted', r2Key: file.r2Key }],
    }).returning()
    
    // Log activity
    await db.insert(activities).values({
      userId: user.id,
      repoId: data.repoId,
      type: 'commit',
      metadata: { 
        commitId: commit.id, 
        message: data.commitMessage,
        filesCount: 1,
      },
    })
    
    return { success: true, commit }
  })

// Get repository branches
export const getBranches = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => z.object({
    repoId: z.number(),
  }).parse(data))
  .handler(async ({ data }) => {
    await getCurrentUser()
    
    const branchList = await db.query.branches.findMany({
      where: eq(branches.repoId, data.repoId),
      with: {
        lastCommit: {
          with: {
            author: true,
          },
        },
      },
      orderBy: [desc(branches.isDefault), branches.name],
    })
    
    return branchList
  })

// Create branch
export const createBranch = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => z.object({
    repoId: z.number(),
    name: z.string(),
    sourceBranchName: z.string().optional(),
  }).parse(data))
  .handler(async ({ data }) => {
    const user = await getCurrentUser()
    
    if (!(await canWriteToRepo(data.repoId, user.id))) {
      throw new Error('No write access to repository')
    }
    
    // Check if branch already exists
    const existing = await db.query.branches.findFirst({
      where: and(
        eq(branches.repoId, data.repoId),
        eq(branches.name, data.name)
      ),
    })
    
    if (existing) {
      throw new Error('Branch already exists')
    }
    
    // Get source branch if provided
    let sourceCommitId = null
    if (data.sourceBranchName) {
      const sourceBranch = await db.query.branches.findFirst({
        where: and(
          eq(branches.repoId, data.repoId),
          eq(branches.name, data.sourceBranchName)
        ),
      })
      sourceCommitId = sourceBranch?.lastCommitId || null
    }
    
    // Create branch
    const [branch] = await db.insert(branches).values({
      repoId: data.repoId,
      name: data.name,
      lastCommitId: sourceCommitId,
      isDefault: false,
    }).returning()
    
    // If source branch provided, copy files
    if (data.sourceBranchName) {
      const sourceBranch = await db.query.branches.findFirst({
        where: and(
          eq(branches.repoId, data.repoId),
          eq(branches.name, data.sourceBranchName)
        ),
      })
      
      if (sourceBranch) {
        const sourceFiles = await db.query.repositoryFiles.findMany({
          where: and(
            eq(repositoryFiles.repoId, data.repoId),
            eq(repositoryFiles.branchId, sourceBranch.id)
          ),
        })
        
        // Copy files to new branch
        for (const file of sourceFiles) {
          await db.insert(repositoryFiles).values({
            repoId: data.repoId,
            branchId: branch.id,
            path: file.path,
            r2Key: file.r2Key, // R2 key can be shared across branches
            size: file.size,
            type: file.type,
            lastCommitId: file.lastCommitId,
          })
        }
      }
    }
    
    return branch
  })

// Get commits for a branch
export const getCommits = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => z.object({
    repoId: z.number(),
    branchName: z.string(),
    limit: z.number().optional().default(50),
  }).parse(data))
  .handler(async ({ data }) => {
    await getCurrentUser()
    
    // Get branch
    const branch = await db.query.branches.findFirst({
      where: and(
        eq(branches.repoId, data.repoId),
        eq(branches.name, data.branchName)
      ),
    })
    
    if (!branch) {
      throw new Error('Branch not found')
    }
    
    // Get commits
    const commitList = await db.query.commits.findMany({
      where: and(
        eq(commits.repoId, data.repoId),
        eq(commits.branchId, branch.id)
      ),
      with: {
        author: true,
      },
      orderBy: [desc(commits.createdAt)],
      limit: data.limit,
    })
    
    return commitList
  })

// Get commit details
export const getCommit = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => z.object({
    commitId: z.number(),
  }).parse(data))
  .handler(async ({ data }) => {
    await getCurrentUser()
    
    const commit = await db.query.commits.findFirst({
      where: eq(commits.id, data.commitId),
      with: {
        author: true,
        repository: true,
        branch: true,
      },
    })
    
    if (!commit) {
      throw new Error('Commit not found')
    }
    
    return commit
  })
