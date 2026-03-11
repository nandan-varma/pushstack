import { createFileRoute } from '@tanstack/react-router'
/**
 * Git HTTP Protocol Catch-All Route
 * Handles all git smart HTTP protocol requests:
 * - GET /api/git/{owner}/{repo}.git/info/refs?service=git-upload-pack
 * - POST /api/git/{owner}/{repo}.git/git-upload-pack
 * - POST /api/git/{owner}/{repo}.git/git-receive-pack
 */

import { parseGitUrl } from '#/lib/git-url-parser'
import { authenticateGitRequest, createAuthChallenge } from '#/server/git-auth'
import { handleInfoRefs, handleUploadPack, handleReceivePack, initBareRepository } from '#/server/git-http-proto'
import { findRepositoryByName } from '#/server/repositories'
import { r2RefBackend } from '#/server/git-r2-backend'
import { formatErrorResponse } from '#/server/git-errors'

export const Route = createFileRoute('/api/git/$')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
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
          const authContext = await authenticateGitRequest(request, owner, repo, service === 'git-receive-pack')
          if (!authContext) {
            return new Response('Unauthorized', { 
              status: 401,
              headers: { 'WWW-Authenticate': createAuthChallenge() }
            })
          }
          
          // Check if repository is initialized in R2
          try {
            await r2RefBackend.readRef(repository.ownerId, repo, 'HEAD')
          } catch (error) {
            // Repository not initialized, initialize it
            await initBareRepository(repository.ownerId, repo, repository.defaultBranch || 'main')
          }
          
          // Handle info/refs request
          const result = await handleInfoRefs(repository.ownerId, repo, service, authContext)
          
          return new Response(result.body, {
            status: result.status,
            headers: result.headers
          })
        } catch (error) {
          const errorResponse = formatErrorResponse(error)
          return new Response(JSON.stringify(errorResponse.body), {
            status: errorResponse.status,
            headers: {
              'Content-Type': 'application/json',
              ...errorResponse.headers,
            }
          })
        }
      },
      
      POST: async ({ request }) => {
        try {
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
          const authContext = await authenticateGitRequest(request, owner, repo, service === 'git-receive-pack')
          if (!authContext) {
            return new Response('Unauthorized', { 
              status: 401,
              headers: { 'WWW-Authenticate': createAuthChallenge() }
            })
          }
          
          // Check if repository is initialized in R2
          try {
            await r2RefBackend.readRef(repository.ownerId, repo, 'HEAD')
          } catch (error) {
            // Repository not initialized, initialize it
            await initBareRepository(repository.ownerId, repo, repository.defaultBranch || 'main')
          }
          
          // Read request body
          const requestBody = await request.arrayBuffer()
          
          // Handle upload-pack (clone/fetch) or receive-pack (push)
          let result
          if (service === 'git-upload-pack') {
            result = await handleUploadPack(repository.ownerId, repo, requestBody, authContext)
          } else if (service === 'git-receive-pack') {
            result = await handleReceivePack(repository.ownerId, repo, requestBody, authContext)
          } else {
            return new Response('Invalid service', { status: 400 })
          }
          
          return new Response(result.body, {
            status: result.status,
            headers: result.headers
          })
        } catch (error) {
          const errorResponse = formatErrorResponse(error)
          return new Response(JSON.stringify(errorResponse.body), {
            status: errorResponse.status,
            headers: {
              'Content-Type': 'application/json',
              ...errorResponse.headers,
            }
          })
        }
      }
    }
  }
})
