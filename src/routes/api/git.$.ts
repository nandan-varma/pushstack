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
import { handleInfoRefs, handleUploadPack, handleReceivePack } from '#/server/git-http-backend'
import { getRepoStorageCoordinates } from '#/server/git-storage-naming'
import { findRepositoryByName } from '#/server/repositories'
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
          
          const storage = getRepoStorageCoordinates(repository)

          // Handle info/refs request
          const result = await handleInfoRefs(
            storage.ownerKey,
            repo,
            service,
            authContext,
            repository.updatedAt,
            repository.defaultBranch || 'main',
            storage.legacyOwnerKeys,
          )
          
          return new Response(new Uint8Array(result.body), {
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
          
          const storage = getRepoStorageCoordinates(repository)

          // Read request body
          const requestBody = await request.arrayBuffer()
          
          // Handle upload-pack (clone/fetch) or receive-pack (push)
          let result
          if (service === 'git-upload-pack') {
            result = await handleUploadPack(
              storage.ownerKey,
              repo,
              requestBody,
              authContext,
              repository.updatedAt,
              repository.defaultBranch || 'main',
              storage.legacyOwnerKeys,
            )
          } else if (service === 'git-receive-pack') {
            result = await handleReceivePack(
              storage.ownerKey,
              repo,
              requestBody,
              authContext,
              repository.updatedAt,
              repository.defaultBranch || 'main',
              repository.ownerId,
              storage.legacyOwnerKeys,
            )
          } else {
            return new Response('Invalid service', { status: 400 })
          }
          
          return new Response(new Uint8Array(result.body), {
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
