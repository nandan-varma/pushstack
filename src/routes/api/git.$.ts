/**
 * Git HTTP Protocol Catch-All Route
 * Handles all git smart HTTP protocol requests:
 * - GET /api/git/{owner}/{repo}.git/info/refs?service=git-upload-pack
 * - POST /api/git/{owner}/{repo}.git/git-upload-pack
 * - POST /api/git/{owner}/{repo}.git/git-receive-pack
 */

import { createAPIFileRoute } from '@tanstack/start/api'
import { parseGitUrl } from '~/lib/git-url-parser'
import { authenticateGitRequest, createAuthChallenge } from '~/server/git-auth'
import { handleInfoRefs, handleUploadPack, handleReceivePack, getRepoPath, initBareRepository } from '~/server/git-http-backend'
import { findRepositoryByName } from '~/server/repositories'
import { existsSync } from 'node:fs'

// Add component to prevent auto-generation issues
export const component = () => null

export const Route = createAPIFileRoute('/api/git/$')({
  GET: async ({ request }) => {
    const url = request.url
    const parsed = parseGitUrl(url)
    
    if (!parsed || !parsed.isInfoRefs || !parsed.service) {
      return new Response('Invalid git request', { status: 400 })
    }
    
    const { owner, repo, service } = parsed
    
    // Get repository from database
    const repository = await findRepositoryByName(owner, repo)
    if (!repository) {
      return new Response('Repository not found', { status: 404 })
    }
    
    // Authenticate the request
    const authContext = await authenticateGitRequest(request, repository)
    if (!authContext) {
      return new Response('Unauthorized', { 
        status: 401,
        headers: { 'WWW-Authenticate': createAuthChallenge() }
      })
    }
    
    // Get repository path on disk
    const repoPath = getRepoPath(owner, repo)
    
    // Initialize repository if it doesn't exist
    if (!existsSync(repoPath)) {
      const initialized = await initBareRepository(repoPath)
      if (!initialized) {
        return new Response('Failed to initialize repository', { status: 500 })
      }
    }
    
    // Handle info/refs request
    const result = await handleInfoRefs(repoPath, service, authContext)
    
    return new Response(result.body, {
      status: result.status,
      headers: result.headers
    })
  },
  
  POST: async ({ request }) => {
    const url = request.url
    const parsed = parseGitUrl(url)
    
    if (!parsed || !parsed.service || parsed.isInfoRefs) {
      return new Response('Invalid git request', { status: 400 })
    }
    
    const { owner, repo, service } = parsed
    
    // Get repository from database
    const repository = await findRepositoryByName(owner, repo)
    if (!repository) {
      return new Response('Repository not found', { status: 404 })
    }
    
    // Authenticate the request
    const authContext = await authenticateGitRequest(request, repository)
    if (!authContext) {
      return new Response('Unauthorized', { 
        status: 401,
        headers: { 'WWW-Authenticate': createAuthChallenge() }
      })
    }
    
    // Get repository path on disk
    const repoPath = getRepoPath(owner, repo)
    
    // Initialize repository if it doesn't exist
    if (!existsSync(repoPath)) {
      const initialized = await initBareRepository(repoPath)
      if (!initialized) {
        return new Response('Failed to initialize repository', { status: 500 })
      }
    }
    
    // Read request body
    const requestBody = await request.arrayBuffer()
    
    // Handle upload-pack (clone/fetch) or receive-pack (push)
    let result
    if (service === 'git-upload-pack') {
      result = await handleUploadPack(repoPath, requestBody, authContext)
    } else if (service === 'git-receive-pack') {
      result = await handleReceivePack(repoPath, requestBody, authContext)
    } else {
      return new Response('Invalid service', { status: 400 })
    }
    
    return new Response(result.body, {
      status: result.status,
      headers: result.headers
    })
  }
})
