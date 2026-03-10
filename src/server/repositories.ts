import { createServerFn } from '@tanstack/react-start';
import { db } from '../db';
import { repositories, stars, repositoryCollaborators, activities } from '../db/github-schema';
import { user } from '../db/schema';
import { auth } from '../lib/auth';
import { eq, and, desc, sql } from 'drizzle-orm';
import { z } from 'zod';

import { getRequestHeaders } from '@tanstack/react-start/server';

// Git operations imports
import { createCommit } from './git-operations-iso';
import { deleteRepo, initBareRepo } from './git-manager-iso';

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
  
  if (!repo) {
    throw new Error('Repository not found')
  }
  
  // Public repos are accessible to all
  if (repo.visibility === 'public') {
    return true
  }
  
  // Check if user is owner
  if (repo.ownerId === userId) {
    return true
  }
  
  // Check if user is collaborator
  const collab = await db.query.repositoryCollaborators.findFirst({
    where: and(
      eq(repositoryCollaborators.repoId, repoId),
      eq(repositoryCollaborators.userId, userId)
    ),
  })
  
  return !!collab
}

// Create repository schema
const createRepoSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  visibility: z.enum(['public', 'private']).default('public'),
})

// Create repository
export const createRepository = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => createRepoSchema.parse(data))
  .handler(async ({ data }) => {
    try {
      const user = await getCurrentUser()
      
      // Check if repository name already exists for this user
      const existing = await db.query.repositories.findFirst({
        where: and(
          eq(repositories.ownerId, user.id),
          eq(repositories.name, data.name)
        ),
      })
      
      if (existing) {
        throw new Error('Repository with this name already exists')
      }
      
      // Get owner ID as number (assuming user IDs are numeric strings or can be converted)
      const ownerId = Number.parseInt(user.id, 10);
      if (isNaN(ownerId)) {
        throw new Error('Invalid user ID format');
      }
      
      // Initialize git repository on filesystem
      const gitPath = await initBareRepo(ownerId, data.name);
      
      // Create initial commit with README
      const commitSha = await createCommit(
        ownerId,
        data.name,
        'Initial commit',
        [{ path: 'README.md', content: `# ${data.name}\n\n${data.description || 'No description provided'}` }],
        user.name || user.username || 'Unknown',
        user.email,
        'main'
      );
      
      // Create repository record in database
      const [repo] = await db.insert(repositories).values({
        ownerId: user.id,
        name: data.name,
        description: data.description || null,
        visibility: data.visibility,
        defaultBranch: 'main',
        gitPath, // Store filesystem path
      }).returning()
      
      // Log activity
      await db.insert(activities).values({
        userId: user.id,
        repoId: repo.id,
        type: 'create_repo',
        metadata: { 
          repoName: repo.name,
          initialCommitSha: commitSha,
        },
      })
      
      return repo
    } catch (error) {
      console.error('Error creating repository:', error);
      throw error;
    }
  })

// Get user repositories
export const getUserRepositories = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => z.object({ 
    userId: z.string().optional() 
  }).parse(data))
  .handler(async ({ data }) => {
    const currentUser = await getCurrentUser()
    const targetUserId = data.userId || currentUser.id
    
    const repos = await db.query.repositories.findMany({
      where: eq(repositories.ownerId, targetUserId),
      orderBy: [desc(repositories.updatedAt)],
      with: {
        owner: true,
      },
    })
    
    // Filter private repos if not the owner
    if (targetUserId !== currentUser.id) {
      return repos.filter(r => r.visibility === 'public')
    }
    
    return repos
  })

// Get repository by ID
export const getRepository = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => z.object({ 
    id: z.number() 
  }).parse(data))
  .handler(async ({ data }) => {
    const user = await getCurrentUser()
    
    if (!(await canAccessRepo(data.id, user.id))) {
      throw new Error('Access denied')
    }
    
    const repo = await db.query.repositories.findFirst({
      where: eq(repositories.id, data.id),
      with: {
        owner: true,
      },
    })
    
    if (!repo) {
      throw new Error('Repository not found')
    }
    
    // Get star count
    const starCount = await db.select({ count: sql`count(*)` })
      .from(stars)
      .where(eq(stars.repoId, data.id))
    
    // Check if current user starred
    const userStar = await db.query.stars.findFirst({
      where: and(
        eq(stars.repoId, data.id),
        eq(stars.userId, user.id)
      ),
    })
    
    return {
      ...repo,
      starCount: Number(starCount[0]?.count || 0),
      isStarred: !!userStar,
    }
  })

// Get repository by owner and name
export const getRepositoryByName = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => z.object({ 
    owner: z.string(),
    name: z.string() 
  }).parse(data))
  .handler(async ({ data }) => {
    const currentUser = await getCurrentUser()
    
    // Find owner by username
    const owner = await db.query.user.findFirst({
      where: eq(user.username, data.owner),
    })
    
    if (!owner) {
      throw new Error('Owner not found')
    }
    
    const repo = await db.query.repositories.findFirst({
      where: and(
        eq(repositories.ownerId, owner.id),
        eq(repositories.name, data.name)
      ),
      with: {
        owner: true,
      },
    })
    
    if (!repo) {
      throw new Error('Repository not found')
    }
    
    if (!(await canAccessRepo(repo.id, currentUser.id))) {
      throw new Error('Access denied')
    }
    
    return repo
  })

// Update repository
export const updateRepository = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => z.object({
    id: z.number(),
    name: z.string().min(1).max(100).optional(),
    description: z.string().optional(),
    visibility: z.enum(['public', 'private']).optional(),
  }).parse(data))
  .handler(async ({ data }) => {
    const user = await getCurrentUser()
    
    const repo = await db.query.repositories.findFirst({
      where: eq(repositories.id, data.id),
    })
    
    if (!repo) {
      throw new Error('Repository not found')
    }
    
    if (repo.ownerId !== user.id) {
      throw new Error('Only repository owner can update')
    }
    
    const [updated] = await db.update(repositories)
      .set({
        ...(data.name && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.visibility && { visibility: data.visibility }),
        updatedAt: new Date(),
      })
      .where(eq(repositories.id, data.id))
      .returning()
    
    return updated
  })

// Delete repository
export const deleteRepository = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => z.object({ 
    id: z.number() 
  }).parse(data))
  .handler(async ({ data }) => {
    const user = await getCurrentUser()
    
    const repo = await db.query.repositories.findFirst({
      where: eq(repositories.id, data.id),
    })
    
    if (!repo) {
      throw new Error('Repository not found');
    }
    
    if (repo.ownerId !== user.id) {
      throw new Error('Only repository owner can delete')
    }
    
    // Get owner ID as number
    const ownerId = Number.parseInt(repo.ownerId, 10);
    
    // Optionally backup before deleting (TODO: implement with isomorphic-git)
    // try {
    //   await backupRepositoryToR2(ownerId, repo.name);
    // } catch (error) {
    //   console.error('Failed to backup repository before deletion:', error);
    // }
    
    // Delete git repository from filesystem
    await deleteRepo(ownerId, repo.name);
    
    // Delete from database (cascades to related tables)
    await db.delete(repositories)
      .where(eq(repositories.id, data.id))
    
    return { success: true }
  })

// Star/unstar repository
export const toggleStar = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => z.object({ 
    repoId: z.number() 
  }).parse(data))
  .handler(async ({ data }) => {
    const user = await getCurrentUser()
    
    if (!(await canAccessRepo(data.repoId, user.id))) {
      throw new Error('Repository not found')
    }
    
    const existingStar = await db.query.stars.findFirst({
      where: and(
        eq(stars.repoId, data.repoId),
        eq(stars.userId, user.id)
      ),
    })
    
    if (existingStar) {
      // Unstar
      await db.delete(stars)
        .where(and(
          eq(stars.repoId, data.repoId),
          eq(stars.userId, user.id)
        ))
      
      return { starred: false }
    } else {
      // Star
      await db.insert(stars).values({
        repoId: data.repoId,
        userId: user.id,
      })
      
      // Log activity
      await db.insert(activities).values({
        userId: user.id,
        repoId: data.repoId,
        type: 'star',
      })
      
      return { starred: true }
    }
  })

// Get repository collaborators
export const getCollaborators = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => z.object({ 
    repoId: z.number() 
  }).parse(data))
  .handler(async ({ data }) => {
    const user = await getCurrentUser()
    
    if (!(await canAccessRepo(data.repoId, user.id))) {
      throw new Error('Access denied')
    }
    
    const collabs = await db.query.repositoryCollaborators.findMany({
      where: eq(repositoryCollaborators.repoId, data.repoId),
      with: {
        user: true,
      },
    })
    
    return collabs
  })

// Add collaborator
export const addCollaborator = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => z.object({
    repoId: z.number(),
    userId: z.string(),
    role: z.enum(['read', 'write', 'admin']).default('read'),
  }).parse(data))
  .handler(async ({ data }) => {
    const user = await getCurrentUser()
    
    const repo = await db.query.repositories.findFirst({
      where: eq(repositories.id, data.repoId),
    })
    
    if (!repo) {
      throw new Error('Repository not found')
    }
    
    if (repo.ownerId !== user.id) {
      throw new Error('Only repository owner can add collaborators')
    }
    
    const [collab] = await db.insert(repositoryCollaborators).values({
      repoId: data.repoId,
      userId: data.userId,
      role: data.role,
    }).returning()
    
    return collab
  })

// Remove collaborator
export const removeCollaborator = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => z.object({
    repoId: z.number(),
    userId: z.string(),
  }).parse(data))
  .handler(async ({ data }) => {
    const user = await getCurrentUser()
    
    const repo = await db.query.repositories.findFirst({
      where: eq(repositories.id, data.repoId),
    })
    
    if (!repo) {
      throw new Error('Repository not found')
    }
    
    if (repo.ownerId !== user.id) {
      throw new Error('Only repository owner can remove collaborators')
    }
    
    await db.delete(repositoryCollaborators)
      .where(and(
        eq(repositoryCollaborators.repoId, data.repoId),
        eq(repositoryCollaborators.userId, data.userId)
      ))
    
    return { success: true }
  })
