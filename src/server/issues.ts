import { createServerFn } from '@tanstack/react-start';
import { getRequestHeaders } from '@tanstack/react-start/server';
import { db } from '../db';
import { issues, pullRequests, comments, repositories, activities, repositoryCollaborators } from '../db/github-schema';
import { auth } from '../lib/auth';
import { eq, and, desc } from 'drizzle-orm';
import { z } from 'zod';

// Git operations imports
import { analyzeMerge, mergeBranches } from './git-merge-iso';

// Get current user session helper
async function getCurrentUser() {
  const headers = getRequestHeaders()
  const session = await auth.api.getSession({ headers })
  if (!session?.user?.id) {
    throw new Error('Unauthorized')
  }
  return session.user
}

// Check if user can access repository
async function canAccessRepo(repoId: number, userId: string) {
  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.id, repoId),
  })
  
  if (!repo) return false
  if (repo.visibility === 'public') return true
  if (repo.ownerId === userId) return true
  
  const collab = await db.query.repositoryCollaborators.findFirst({
    where: and(
      eq(repositoryCollaborators.repoId, repoId),
      eq(repositoryCollaborators.userId, userId)
    ),
  })
  
  return !!collab
}

// ============ ISSUES ============

// Create issue
export const createIssue = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => z.object({
    repoId: z.number(),
    title: z.string().min(1),
    body: z.string().optional(),
    labels: z.array(z.string()).optional(),
  }).parse(data))
  .handler(async ({ data }) => {
    const user = await getCurrentUser()
    
    if (!(await canAccessRepo(data.repoId, user.id))) {
      throw new Error('Access denied')
    }
    
    const [issue] = await db.insert(issues).values({
      repoId: data.repoId,
      authorId: user.id,
      title: data.title,
      body: data.body || null,
      labels: data.labels || null,
      status: 'open',
    }).returning()
    
    // Log activity
    await db.insert(activities).values({
      userId: user.id,
      repoId: data.repoId,
      type: 'issue',
      metadata: { 
        issueId: issue.id, 
        title: issue.title,
        action: 'opened',
      },
    })
    
    return { ...issue, labels: issue.labels as {} }
  })

// Get issues
export const getIssues = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => z.object({
    repoId: z.number(),
    status: z.enum(['open', 'closed', 'all']).optional().default('open'),
  }).parse(data))
  .handler(async ({ data }) => {
    const user = await getCurrentUser()
    
    if (!(await canAccessRepo(data.repoId, user.id))) {
      throw new Error('Access denied')
    }
    
    const issueList = await db.query.issues.findMany({
      where: and(
        eq(issues.repoId, data.repoId),
        data.status !== 'all' ? eq(issues.status, data.status) : undefined
      ),
      with: {
        author: true,
      },
      orderBy: [desc(issues.createdAt)],
    })
    
    return issueList.map(issue => ({ ...issue, labels: issue.labels as {} }))
  })

// Get issue by ID
export const getIssue = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => z.object({
    issueId: z.number(),
  }).parse(data))
  .handler(async ({ data }) => {
    const user = await getCurrentUser()
    
    const issue = await db.query.issues.findFirst({
      where: eq(issues.id, data.issueId),
      with: {
        author: true,
        repository: true,
      },
    })
    
    if (!issue) {
      throw new Error('Issue not found')
    }
    
    if (!(await canAccessRepo(issue.repoId, user.id))) {
      throw new Error('Access denied')
    }
    
    return { ...issue, labels: issue.labels as {} }
  })

// Update issue
export const updateIssue = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => z.object({
    issueId: z.number(),
    title: z.string().optional(),
    body: z.string().optional(),
    status: z.enum(['open', 'closed']).optional(),
    labels: z.array(z.string()).optional(),
  }).parse(data))
  .handler(async ({ data }) => {
    const user = await getCurrentUser()
    
    const issue = await db.query.issues.findFirst({
      where: eq(issues.id, data.issueId),
    })
    
    if (!issue) {
      throw new Error('Issue not found')
    }
    
    if (!(await canAccessRepo(issue.repoId, user.id))) {
      throw new Error('Access denied')
    }
    
    const [updated] = await db.update(issues)
      .set({
        ...(data.title && { title: data.title }),
        ...(data.body !== undefined && { body: data.body }),
        ...(data.status && { 
          status: data.status,
          closedAt: data.status === 'closed' ? new Date() : null,
        }),
        ...(data.labels && { labels: data.labels }),
        updatedAt: new Date(),
      })
      .where(eq(issues.id, data.issueId))
      .returning()
    
    // Log activity if status changed
    if (data.status && data.status !== issue.status) {
      await db.insert(activities).values({
        userId: user.id,
        repoId: issue.repoId,
        type: 'issue',
        metadata: { 
          issueId: issue.id, 
          title: issue.title,
          action: data.status === 'closed' ? 'closed' : 'reopened',
        },
      })
    }
    
    return { ...updated, labels: updated.labels as {} }
  })

// ============ PULL REQUESTS ============

// Create pull request
export const createPullRequest = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => z.object({
    repoId: z.number(),
    title: z.string().min(1),
    body: z.string().optional(),
    sourceBranchName: z.string(),
    targetBranchName: z.string(),
  }).parse(data))
  .handler(async ({ data }) => {
    const user = await getCurrentUser()
    
    if (!(await canAccessRepo(data.repoId, user.id))) {
      throw new Error('Access denied')
    }
    
    // Validate branches exist - we now work with branch names directly
    if (data.sourceBranchName === data.targetBranchName) {
      throw new Error('Cannot create PR from same branch')
    }
    
    const [pr] = await db.insert(pullRequests).values({
      repoId: data.repoId,
      authorId: user.id,
      title: data.title,
      body: data.body || null,
      sourceBranch: data.sourceBranchName,
      targetBranch: data.targetBranchName,
      status: 'open',
    }).returning()
    
    // Log activity
    await db.insert(activities).values({
      userId: user.id,
      repoId: data.repoId,
      type: 'pr',
      metadata: { 
        prId: pr.id, 
        title: pr.title,
        action: 'opened',
      },
    })
    
    return pr
  })

// Get pull requests
export const getPullRequests = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => z.object({
    repoId: z.number(),
    status: z.enum(['open', 'closed', 'merged', 'all']).optional().default('open'),
  }).parse(data))
  .handler(async ({ data }) => {
    const user = await getCurrentUser()
    
    if (!(await canAccessRepo(data.repoId, user.id))) {
      throw new Error('Access denied')
    }
    
    const prList = await db.query.pullRequests.findMany({
      where: and(
        eq(pullRequests.repoId, data.repoId),
        data.status !== 'all' ? eq(pullRequests.status, data.status) : undefined
      ),
      with: {
        author: true,
      },
      orderBy: [desc(pullRequests.createdAt)],
    })
    
    return prList
  })

// Get pull request by ID
export const getPullRequest = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => z.object({
    prId: z.number(),
  }).parse(data))
  .handler(async ({ data }) => {
    const user = await getCurrentUser()
    
    const pr = await db.query.pullRequests.findFirst({
      where: eq(pullRequests.id, data.prId),
      with: {
        author: true,
        repository: true,
      },
    })
    
    if (!pr) {
      throw new Error('Pull request not found')
    }
    
    if (!(await canAccessRepo(pr.repoId, user.id))) {
      throw new Error('Access denied')
    }
    
    return pr
  })

// Update pull request
export const updatePullRequest = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => z.object({
    prId: z.number(),
    title: z.string().optional(),
    body: z.string().optional(),
    status: z.enum(['open', 'closed']).optional(),
  }).parse(data))
  .handler(async ({ data }) => {
    const user = await getCurrentUser()
    
    const pr = await db.query.pullRequests.findFirst({
      where: eq(pullRequests.id, data.prId),
    })
    
    if (!pr) {
      throw new Error('Pull request not found')
    }
    
    if (!(await canAccessRepo(pr.repoId, user.id))) {
      throw new Error('Access denied')
    }
    
    const [updated] = await db.update(pullRequests)
      .set({
        ...(data.title && { title: data.title }),
        ...(data.body !== undefined && { body: data.body }),
        ...(data.status && { status: data.status }),
        updatedAt: new Date(),
      })
      .where(eq(pullRequests.id, data.prId))
      .returning()
    
    return updated
  })

// Merge pull request
export const mergePullRequest = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => z.object({
    prId: z.number(),
    commitMessage: z.string().optional(),
    strategy: z.enum(['merge', 'ours', 'theirs']).optional().default('merge'),
  }).parse(data))
  .handler(async ({ data }) => {
    const user = await getCurrentUser()
    
    const pr = await db.query.pullRequests.findFirst({
      where: eq(pullRequests.id, data.prId),
      with: {
        repository: {
          with: {
            owner: true,
          },
        },
      },
    })
    
    if (!pr) {
      throw new Error('Pull request not found')
    }
    
    if (!(await canAccessRepo(pr.repoId, user.id))) {
      throw new Error('Access denied')
    }
    
    if (pr.status !== 'open') {
      throw new Error('Pull request is not open')
    }
    
    // Get repository
    const repo = pr.repository;
    const ownerId = Number.parseInt(repo.ownerId, 10);
    
    // Analyze merge first to check for conflicts
    const analysis = await analyzeMerge(
      ownerId,
      repo.name,
      pr.sourceBranch,
      pr.targetBranch
    );
    
    if (!analysis.canMerge) {
      throw new Error(
        `Cannot merge: ${analysis.hasConflicts ? 'has conflicts' : 'unknown issue'}`
      );
    }
    
    // Perform the merge
    const mergeMessage = data.commitMessage || `Merge pull request #${pr.id}: ${pr.title}`;
    const mergeResult = await mergeBranches(
      ownerId,
      repo.name,
      pr.sourceBranch,
      pr.targetBranch,
      {
        message: mergeMessage,
        authorName: user.name || user.username || 'Unknown',
        authorEmail: user.email,
        strategy: data.strategy,
      }
    );
    
    if (!mergeResult.success) {
      throw new Error(`Merge failed: ${mergeResult.conflicts?.join(', ') || 'Unknown error'}`);
    }
    
    // Update PR status
    await db.update(pullRequests)
      .set({
        status: 'merged',
        mergedAt: new Date(),
        mergedBy: user.id,
        mergeCommitSha: mergeResult.commitSha,
      })
      .where(eq(pullRequests.id, data.prId))
    
    // Log activity
    await db.insert(activities).values({
      userId: user.id,
      repoId: pr.repoId,
      type: 'pr',
      metadata: { 
        prId: pr.id, 
        title: pr.title,
        action: 'merged',
        mergeCommitSha: mergeResult.commitSha,
      },
    })
    
    return { 
      success: true,
      commitSha: mergeResult.commitSha,
    }
  })

// ============ COMMENTS ============

// Create comment
export const createComment = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => z.object({
    repoId: z.number(),
    issueId: z.number().optional(),
    pullRequestId: z.number().optional(),
    body: z.string().min(1),
  }).parse(data))
  .handler(async ({ data }) => {
    const user = await getCurrentUser()
    
    if (!(await canAccessRepo(data.repoId, user.id))) {
      throw new Error('Access denied')
    }
    
    if (!data.issueId && !data.pullRequestId) {
      throw new Error('Must specify issueId or pullRequestId')
    }
    
    const [comment] = await db.insert(comments).values({
      repoId: data.repoId,
      issueId: data.issueId || null,
      pullRequestId: data.pullRequestId || null,
      authorId: user.id,
      body: data.body,
    }).returning()
    
    // Log activity
    await db.insert(activities).values({
      userId: user.id,
      repoId: data.repoId,
      type: 'comment',
      metadata: { 
        commentId: comment.id,
        issueId: data.issueId,
        prId: data.pullRequestId,
      },
    })
    
    return comment
  })

// Get comments
export const getComments = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => z.object({
    issueId: z.number().optional(),
    pullRequestId: z.number().optional(),
  }).parse(data))
  .handler(async ({ data }) => {
    await getCurrentUser()
    
    if (!data.issueId && !data.pullRequestId) {
      throw new Error('Must specify issueId or pullRequestId')
    }
    
    const commentList = await db.query.comments.findMany({
      where: data.issueId 
        ? eq(comments.issueId, data.issueId)
        : eq(comments.pullRequestId, data.pullRequestId!),
      with: {
        author: true,
      },
      orderBy: [comments.createdAt],
    })
    
    return commentList
  })

// Update comment
export const updateComment = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => z.object({
    commentId: z.number(),
    body: z.string().min(1),
  }).parse(data))
  .handler(async ({ data }) => {
    const user = await getCurrentUser()
    
    const comment = await db.query.comments.findFirst({
      where: eq(comments.id, data.commentId),
    })
    
    if (!comment) {
      throw new Error('Comment not found')
    }
    
    if (comment.authorId !== user.id) {
      throw new Error('Only comment author can edit')
    }
    
    const [updated] = await db.update(comments)
      .set({
        body: data.body,
        updatedAt: new Date(),
      })
      .where(eq(comments.id, data.commentId))
      .returning()
    
    return updated
  })

// Delete comment
export const deleteComment = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => z.object({
    commentId: z.number(),
  }).parse(data))
  .handler(async ({ data }) => {
    const user = await getCurrentUser()
    
    const comment = await db.query.comments.findFirst({
      where: eq(comments.id, data.commentId),
      with: {
        repository: true,
      },
    })
    
    if (!comment) {
      throw new Error('Comment not found')
    }
    
    // Only comment author or repo owner can delete
    if (comment.authorId !== user.id && comment.repository.ownerId !== user.id) {
      throw new Error('Not authorized to delete this comment')
    }
    
    await db.delete(comments)
      .where(eq(comments.id, data.commentId))
    
    return { success: true }
  })
