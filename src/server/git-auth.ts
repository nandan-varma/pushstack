/**
 * Git authentication middleware for HTTP protocol operations
 * Handles HTTP Basic Auth and repository access permissions
 */

import { db } from '../db'
import { repositoryCollaborators } from '../db/github-schema'
import { user as userTable } from '../db/schema'
import { auth } from '../lib/auth'
import { eq, and } from 'drizzle-orm'
import { findRepositoryByName } from './repositories'

export interface GitAuthContext {
  userId: string
  username: string
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

type AuthenticatedGitUser = GitAuthContext['user'] & {
  tokenScopes?: string[]
}

function isGitAuthDisabled(): boolean {
  return process.env.GIT_DISABLE_AUTH === 'true'
}

function isPersonalAccessToken(value: string): boolean {
  return value.startsWith('ghp_')
}

function hasRequiredTokenScope(scopes: string[] | undefined, requiredScope: 'repo:read' | 'repo:write'): boolean {
  if (!scopes || scopes.length === 0) {
    return true
  }

  if (scopes.includes('repo') || scopes.includes('*')) {
    return true
  }

  if (requiredScope === 'repo:read' && scopes.includes('repo:write')) {
    return true
  }

  return scopes.includes(requiredScope)
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
async function authenticateUser(request: Request): Promise<AuthenticatedGitUser | null> {
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
  
  // Git clients normally send PATs in the password slot, but keep username fallback for compatibility.
  if (isPersonalAccessToken(credentials.password)) {
    return await authenticateToken(credentials.password)
  }

  if (isPersonalAccessToken(credentials.username)) {
    return await authenticateToken(credentials.username)
  }
  
  // Verify password with Better Auth
  try {
    // Look up user by username (can be username or email)
    const foundUser = await db.query.user.findFirst({
      where: eq(userTable.username, credentials.username),
    })
    
    if (!foundUser) {
      // Try email as fallback
      const userByEmail = await db.query.user.findFirst({
        where: eq(userTable.email, credentials.username),
      })
      
      if (!userByEmail) {
        return null
      }
      
      // Verify password using Better Auth
      // Note: Better Auth doesn't expose password verification directly
      // For now, we'll use a simplified check
      // In production, use Better Auth's signIn API or implement proper verification
      try {
        const signInResult = await auth.api.signInEmail({
          email: userByEmail.email,
          password: credentials.password,
        } as any)
        
        if (signInResult) {
          return {
            id: userByEmail.id,
            username: userByEmail.username,
            email: userByEmail.email,
            name: userByEmail.name,
          }
        }
      } catch {
        // Sign in failed, invalid password
        return null
      }
      
      return null
    }
    
    // Verify password for user found by username
    try {
      const signInResult = await auth.api.signInEmail({
        email: foundUser.email,
        password: credentials.password,
      } as any)
      
      if (signInResult) {
        return {
          id: foundUser.id,
          username: foundUser.username,
          email: foundUser.email,
          name: foundUser.name,
        }
      }
    } catch {
      // Sign in failed, invalid password
      return null
    }
    
    return null
  } catch (error) {
    console.error('Git auth error:', error)
    return null
  }
}

/**
 * Authenticate user via Personal Access Token
 * @param token PAT string (starts with 'ghp_')
 * @returns User object or null if token is invalid
 */
async function authenticateToken(token: string): Promise<AuthenticatedGitUser | null> {
  try {
    // Hash the token for lookup
    const crypto = await import('node:crypto')
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
    
    // Look up token in database
    const { tokens } = await import('../db/github-schema')
    const foundToken = await db.query.tokens.findFirst({
      where: eq(tokens.tokenHash, tokenHash),
      with: {
        user: true,
      },
    })
    
    if (!foundToken) {
      return null
    }
    
    // Check if token is expired
    if (foundToken.expiresAt && new Date(foundToken.expiresAt) < new Date()) {
      return null
    }
    
    // Update last used timestamp
    await db.update(tokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(tokens.id, foundToken.id))
    
    return {
      id: foundToken.userId,
      username: foundToken.user.username,
      email: foundToken.user.email,
      name: foundToken.user.name,
      tokenScopes: Array.isArray(foundToken.scopes) ? foundToken.scopes.filter((scope): scope is string => typeof scope === 'string') : [],
    }
  } catch (error) {
    console.error('Token auth error:', error)
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
  // Get repository
  const repo = await findRepositoryByName(owner, repoName)
  
  if (!repo) {
    throw new Error('Repository not found')
  }

  if (isGitAuthDisabled()) {
    const credentials = parseBasicAuth(request.headers.get('authorization'))
    const username = credentials?.username || owner || 'git-test-user'

    return {
      userId: repo.ownerId,
      username,
      user: {
        id: repo.ownerId,
        username,
        email: `${username}@local.test`,
        name: username,
      },
      repo: {
        id: repo.id,
        ownerId: repo.ownerId,
        name: repo.name,
        visibility: repo.visibility as 'public' | 'private',
      },
      canRead: true,
      canWrite: true,
    }
  }

  // Authenticate user
  const user = await authenticateUser(request)
  
  // For write operations, require authentication first
  if (requireWrite && !user) {
    throw new Error('Unauthorized: Authentication required for write access')
  }
  
  // Check read permission
  const canRead = await canReadRepo(repo.id, user?.id || null, { visibility: repo.visibility as 'public' | 'private', ownerId: repo.ownerId })
  
  if (!canRead) {
    throw new Error('Access denied: You do not have read access to this repository')
  }
  
  // Check write permission if required
  const canWrite = await canWriteRepo(repo.id, user?.id || null, { ownerId: repo.ownerId })

  if (user?.tokenScopes && !hasRequiredTokenScope(user.tokenScopes, 'repo:read')) {
    throw new Error('Access denied: Token does not include repository read scope')
  }

  if (requireWrite && !canWrite) {
    throw new Error('Access denied: You do not have write access to this repository')
  }

  if (requireWrite && user?.tokenScopes && !hasRequiredTokenScope(user.tokenScopes, 'repo:write')) {
    throw new Error('Access denied: Token does not include repository write scope')
  }
  
  // Return auth context
  return {
    userId: user?.id || 'anonymous',
    username: user?.username || 'anonymous',
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
