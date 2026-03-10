/**
 * Git authentication middleware for HTTP protocol operations
 * Handles HTTP Basic Auth and repository access permissions
 */

import { db } from '../db'
import { repositories, repositoryCollaborators } from '../db/github-schema'
import { user as userTable } from '../db/schema'
import { auth } from '../lib/auth'
import { eq, and } from 'drizzle-orm'

export interface GitAuthContext {
  user: {
    id: string
    username: string | null
    email: string
    name: string | null
  }
  repo: {
    id: number
    ownerId: string
    name: string
    visibility: 'public' | 'private'
  }
  canRead: boolean
  canWrite: boolean
}

/**
 * Parse HTTP Basic Auth header
 * @param authHeader Authorization header value
 * @returns Object with username and password, or null
 */
function parseBasicAuth(authHeader: string | null): { username: string; password: string } | null {
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return null
  }
  
  try {
    const base64Credentials = authHeader.slice(6)
    const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8')
    const [username, password] = credentials.split(':')
    
    if (!username || !password) {
      return null
    }
    
    return { username, password }
  } catch {
    return null
  }
}

/**
 * Authenticate user via Better Auth session or HTTP Basic Auth
 * @param request Request object with headers
 * @returns User object or null if authentication fails
 */
async function authenticateUser(request: Request): Promise<GitAuthContext['user'] | null> {
  // Try session authentication first (for web UI)
  try {
    const session = await auth.api.getSession({
      headers: request.headers as any,
    })
    
    if (session?.user) {
      return {
        id: session.user.id,
        username: session.user.username || null,
        email: session.user.email,
        name: session.user.name || null,
      }
    }
  } catch {
    // Session auth failed, continue to Basic Auth
  }
  
  // Try HTTP Basic Auth (for git CLI)
  const authHeader = request.headers.get('authorization')
  const credentials = parseBasicAuth(authHeader)
  
  if (!credentials) {
    return null
  }
  
  // Verify credentials with Better Auth
  try {
    // For now, use username and check if user exists
    // TODO: Implement Personal Access Token (PAT) verification
    // The password should be a PAT in production
    
    const foundUser = await db.query.user.findFirst({
      where: eq(userTable.username, credentials.username),
    })
    
    if (!foundUser) {
      return null
    }
    
    // For MVP: Accept any password for authenticated users
    // In production: Verify PAT against stored tokens
    // TODO: Add PAT table and verification
    
    return {
      id: foundUser.id,
      username: foundUser.username,
      email: foundUser.email,
      name: foundUser.name,
    }
  } catch {
    return null
  }
}

/**
 * Check if user can read from repository
 * @param repoId Repository ID
 * @param userId User ID (can be null for anonymous)
 * @param repo Repository object
 * @returns true if user can read
 */
async function canReadRepo(
  repoId: number,
  userId: string | null,
  repo: { visibility: 'public' | 'private'; ownerId: string }
): Promise<boolean> {
  // Public repos are readable by everyone
  if (repo.visibility === 'public') {
    return true
  }
  
  // Private repos require authentication
  if (!userId) {
    return false
  }
  
  // Owner can always read
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

/**
 * Check if user can write to repository
 * @param repoId Repository ID
 * @param userId User ID (must be authenticated)
 * @param repo Repository object
 * @returns true if user can write
 */
async function canWriteRepo(
  repoId: number,
  userId: string | null,
  repo: { ownerId: string }
): Promise<boolean> {
  if (!userId) {
    return false
  }
  
  // Owner can always write
  if (repo.ownerId === userId) {
    return true
  }
  
  // Check if user is collaborator with write access
  const collab = await db.query.repositoryCollaborators.findFirst({
    where: and(
      eq(repositoryCollaborators.repoId, repoId),
      eq(repositoryCollaborators.userId, userId)
    ),
  })
  
  // Check role (assuming 'write' or 'admin' role)
  return collab?.role === 'write' || collab?.role === 'admin'
}

/**
 * Get repository by owner and name
 * @param owner Repository owner username
 * @param repoName Repository name (without .git extension)
 * @returns Repository object or null
 */
async function getRepo(owner: string, repoName: string) {
  const repoOwner = await db.query.user.findFirst({
    where: eq(userTable.username, owner),
  })
  
  if (!repoOwner) {
    return null
  }
  
  const repo = await db.query.repositories.findFirst({
    where: and(
      eq(repositories.ownerId, repoOwner.id),
      eq(repositories.name, repoName)
    ),
  })
  
  return repo
}

/**
 * Authenticate and authorize git operation
 * @param request Request object
 * @param owner Repository owner username
 * @param repoName Repository name (without .git extension)
 * @param requireWrite Whether write access is required (for push operations)
 * @returns GitAuthContext with user, repo, and permissions
 * @throws Error if authentication or authorization fails
 */
export async function authenticateGitRequest(
  request: Request,
  owner: string,
  repoName: string,
  requireWrite: boolean = false
): Promise<GitAuthContext> {
  // Authenticate user
  const user = await authenticateUser(request)
  
  // Get repository
  const repo = await getRepo(owner, repoName)
  
  if (!repo) {
    throw new Error('Repository not found')
  }
  
  // Check read permission
  const canRead = await canReadRepo(repo.id, user?.id || null, repo)
  
  if (!canRead) {
    throw new Error('Access denied: You do not have read access to this repository')
  }
  
  // Check write permission if required
  const canWrite = await canWriteRepo(repo.id, user?.id || null, repo)
  
  if (requireWrite && !canWrite) {
    throw new Error('Access denied: You do not have write access to this repository')
  }
  
  // Return auth context
  return {
    user: user || {
      id: 'anonymous',
      username: null,
      email: 'anonymous@localhost',
      name: null,
    },
    repo: {
      id: repo.id,
      ownerId: repo.ownerId,
      name: repo.name,
      visibility: repo.visibility as 'public' | 'private',
    },
    canRead,
    canWrite,
  }
}

/**
 * Create WWW-Authenticate header for 401 responses
 * @param realm Authentication realm
 * @returns WWW-Authenticate header value
 */
export function createAuthChallenge(realm: string = 'Git Repository'): string {
  return `Basic realm="${realm}"`
}
