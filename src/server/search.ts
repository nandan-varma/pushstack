import { createServerFn } from '@tanstack/start/server'
import { db } from '../db'
import { repositories, issues, activities, user } from '../db/schema'
import { auth } from '../lib/auth'
import { or, ilike, desc, eq, and } from 'drizzle-orm'
import { z } from 'zod'

// Get current user session helper
async function getCurrentUser() {
  const session = await auth.api.getSession({
    headers: new Headers()
  })
  if (!session?.user?.id) {
    throw new Error('Unauthorized')
  }
  return session.user
}

// Search repositories
export const searchRepositories = createServerFn({ method: 'GET' })
  .validator((data: unknown) => z.object({
    query: z.string().min(1),
    limit: z.number().optional().default(20),
  }).parse(data))
  .handler(async ({ data }) => {
    const currentUser = await getCurrentUser()
    
    // Search public repositories and user's own repositories
    const repos = await db.query.repositories.findMany({
      where: or(
        and(
          ilike(repositories.name, `%${data.query}%`),
          eq(repositories.visibility, 'public')
        ),
        and(
          ilike(repositories.name, `%${data.query}%`),
          eq(repositories.ownerId, currentUser.id)
        )
      ),
      with: {
        owner: true,
      },
      orderBy: [desc(repositories.updatedAt)],
      limit: data.limit,
    })
    
    return repos
  })

// Search issues
export const searchIssues = createServerFn({ method: 'GET' })
  .validator((data: unknown) => z.object({
    repoId: z.number(),
    query: z.string().min(1),
    limit: z.number().optional().default(20),
  }).parse(data))
  .handler(async ({ data }) => {
    await getCurrentUser()
    
    const issueList = await db.query.issues.findMany({
      where: and(
        eq(issues.repoId, data.repoId),
        or(
          ilike(issues.title, `%${data.query}%`),
          ilike(issues.body, `%${data.query}%`)
        )
      ),
      with: {
        author: true,
      },
      orderBy: [desc(issues.createdAt)],
      limit: data.limit,
    })
    
    return issueList
  })

// Search users
export const searchUsers = createServerFn({ method: 'GET' })
  .validator((data: unknown) => z.object({
    query: z.string().min(1),
    limit: z.number().optional().default(20),
  }).parse(data))
  .handler(async ({ data }) => {
    await getCurrentUser()
    
    const users = await db.query.user.findMany({
      where: or(
        ilike(user.name, `%${data.query}%`),
        ilike(user.email, `%${data.query}%`)
      ),
      limit: data.limit,
    })
    
    return users
  })

// Get user activity feed
export const getUserActivity = createServerFn({ method: 'GET' })
  .validator((data: unknown) => z.object({
    userId: z.string().optional(),
    limit: z.number().optional().default(50),
  }).parse(data))
  .handler(async ({ data }) => {
    const currentUser = await getCurrentUser()
    const targetUserId = data.userId || currentUser.id
    
    const activityList = await db.query.activities.findMany({
      where: eq(activities.userId, targetUserId),
      with: {
        user: true,
        repository: true,
      },
      orderBy: [desc(activities.createdAt)],
      limit: data.limit,
    })
    
    return activityList
  })

// Get repository activity feed
export const getRepositoryActivity = createServerFn({ method: 'GET' })
  .validator((data: unknown) => z.object({
    repoId: z.number(),
    limit: z.number().optional().default(50),
  }).parse(data))
  .handler(async ({ data }) => {
    await getCurrentUser()
    
    const activityList = await db.query.activities.findMany({
      where: eq(activities.repoId, data.repoId),
      with: {
        user: true,
      },
      orderBy: [desc(activities.createdAt)],
      limit: data.limit,
    })
    
    return activityList
  })

// Get global activity feed (public repositories)
export const getGlobalActivity = createServerFn({ method: 'GET' })
  .validator((data: unknown) => z.object({
    limit: z.number().optional().default(50),
  }).parse(data))
  .handler(async ({ data }) => {
    await getCurrentUser()
    
    const activityList = await db.query.activities.findMany({
      with: {
        user: true,
        repository: true,
      },
      orderBy: [desc(activities.createdAt)],
      limit: data.limit,
    })
    
    // Filter to only public repositories
    return activityList.filter(a => a.repository?.visibility === 'public')
  })
