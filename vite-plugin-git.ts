/**
 * Vite Plugin for Git HTTP Protocol
 * Intercepts /api/git/* requests and handles them directly
 * Bypasses TanStack Router which has issues with catch-all routes
 */

import type { Plugin } from 'vite'

export function gitHttpProtocol(): Plugin {
  return {
    name: 'git-http-protocol',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        // Only handle /api/git/* requests
        if (!req.url?.startsWith('/api/git/')) {
          return next()
        }

        try {
          // Lazy imports to avoid loading at build time
          const { parseGitUrl } = await import('./src/lib/git-url-parser')
          const { authenticateGitRequest, createAuthChallenge } = await import('./src/server/git-auth')
          const { 
            handleInfoRefs, 
            handleUploadPack, 
            handleReceivePack, 
            getRepoPath, 
            initBareRepository 
          } = await import('./src/server/git-http-backend')
          const { existsSync } = await import('node:fs')
          
          const fullUrl = `http://${req.headers.host}${req.url}`
          const parsed = parseGitUrl(fullUrl)
          
          if (!parsed) {
            res.statusCode = 400
            res.end('Invalid git request')
            return
          }
          
          const { owner, repo, service, isInfoRefs } = parsed
          
          // Create request object compatible with auth function
          const request = new Request(fullUrl, {
            method: req.method,
            headers: req.headers as HeadersInit,
          })
          
          // Determine if this is a write operation
          const requireWrite = service === 'git-receive-pack'
          
          // Authenticate the request (will also verify repo exists)
          let authContext
          try {
            authContext = await authenticateGitRequest(request, owner, repo, requireWrite)
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Authentication failed'
            
            if (errorMessage.includes('Repository not found')) {
              res.statusCode = 404
              res.end('Repository not found')
            } else if (errorMessage.includes('Unauthorized')) {
              // Return 401 to prompt for credentials
              res.statusCode = 401
              res.setHeader('WWW-Authenticate', createAuthChallenge())
              res.end('Unauthorized: Authentication required')
            } else if (errorMessage.includes('Access denied')) {
              res.statusCode = 403
              res.end(errorMessage)
            } else {
              res.statusCode = 401
              res.setHeader('WWW-Authenticate', createAuthChallenge())
              res.end('Unauthorized')
            }
            return
          }
          
          if (!authContext) {
            res.statusCode = 401
            res.setHeader('WWW-Authenticate', createAuthChallenge())
            res.end('Unauthorized')
            return
          }
          
          // Get repository path on disk using owner ID (not username)
          // This matches the path format used by git-manager-iso.ts
          const repoPath = getRepoPath(authContext.repo.ownerId, repo)
          
          // Initialize repository if it doesn't exist
          if (!existsSync(repoPath)) {
            const initialized = await initBareRepository(repoPath)
            if (!initialized) {
              res.statusCode = 500
              res.end('Failed to initialize repository')
              return
            }
          }
          
          // Handle GET (info/refs)
          if (req.method === 'GET' && isInfoRefs && service) {
            const result = await handleInfoRefs(repoPath, service, authContext)
            res.statusCode = result.status
            Object.entries(result.headers).forEach(([key, value]) => {
              res.setHeader(key, value)
            })
            res.end(result.body)
            return
          }
          
          // Handle POST (upload-pack or receive-pack)
          if (req.method === 'POST' && service && !isInfoRefs) {
            // Read request body
            const chunks: Buffer[] = []
            req.on('data', (chunk) => chunks.push(chunk))
            req.on('end', async () => {
              const body = Buffer.concat(chunks)
              const requestBody = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
              
              let result
              if (service === 'git-upload-pack') {
                result = await handleUploadPack(repoPath, requestBody, authContext)
              } else if (service === 'git-receive-pack') {
                result = await handleReceivePack(repoPath, requestBody, authContext)
              } else {
                res.statusCode = 400
                res.end('Invalid service')
                return
              }
              
              res.statusCode = result.status
              Object.entries(result.headers).forEach(([key, value]) => {
                res.setHeader(key, value)
              })
              res.end(result.body)
            })
            return
          }
          
          // Invalid request
          res.statusCode = 400
          res.end('Invalid git request')
        } catch (error) {
          console.error('Git HTTP protocol error:', error)
          res.statusCode = 500
          res.end('Internal server error')
        }
      })
    },
  }
}
