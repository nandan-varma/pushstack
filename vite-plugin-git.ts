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
            initBareRepository 
          } = await import('./src/server/git-http-proto')
          const { r2RefBackend } = await import('./src/server/git-r2-backend')
          const { findRepositoryByName } = await import('./src/server/repositories')
          const { formatErrorResponse } = await import('./src/server/git-errors')
          
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
          
          // Get repository from database
          let repository
          try {
            repository = await findRepositoryByName(owner, repo)
            if (!repository) {
              res.statusCode = 404
              res.end('Repository not found')
              return
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Database error'
            res.statusCode = 500
            res.end(`Database error: ${errorMessage}`)
            return
          }
          
          // Determine if this is a write operation
          const requireWrite = service === 'git-receive-pack'
          
          // Authenticate the request
          let authContext
          try {
            authContext = await authenticateGitRequest(request, owner, repo, requireWrite)
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Authentication failed'
            
            if (errorMessage.includes('Unauthorized')) {
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
          
          // Check if repository is initialized in R2
          try {
            await r2RefBackend.readRef(repository.ownerId, repo, 'HEAD')
          } catch (error) {
            // Repository not initialized, initialize it
            try {
              await initBareRepository(repository.ownerId, repo, repository.defaultBranch || 'main')
            } catch (initError) {
              res.statusCode = 500
              res.end('Failed to initialize repository')
              return
            }
          }
          
          // Handle GET (info/refs)
          if (req.method === 'GET' && isInfoRefs && service) {
            try {
              const result = await handleInfoRefs(repository.ownerId, repo, service, authContext)
              res.statusCode = result.status
              Object.entries(result.headers).forEach(([key, value]) => {
                res.setHeader(key, value)
              })
              res.end(result.body)
            } catch (error) {
              const errorResponse = formatErrorResponse(error)
              res.statusCode = errorResponse.status
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify(errorResponse.body))
            }
            return
          }
          
          // Handle POST (upload-pack or receive-pack)
          if (req.method === 'POST' && service && !isInfoRefs) {
            // Read request body
            const chunks: Buffer[] = []
            req.on('data', (chunk) => chunks.push(chunk))
            req.on('end', async () => {
              try {
                const body = Buffer.concat(chunks)
                const requestBody = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
                
                let result
                if (service === 'git-upload-pack') {
                  result = await handleUploadPack(repository.ownerId, repo, requestBody, authContext)
                } else if (service === 'git-receive-pack') {
                  result = await handleReceivePack(repository.ownerId, repo, requestBody, authContext)
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
              } catch (error) {
                const errorResponse = formatErrorResponse(error)
                res.statusCode = errorResponse.status
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify(errorResponse.body))
              }
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
