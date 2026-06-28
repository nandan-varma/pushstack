/**
 * Vite Plugin for Git HTTP Protocol
 * Intercepts /api/git/* requests and handles them directly
 * Bypasses TanStack Router which has issues with catch-all routes
 */

import type { Plugin } from 'vite'

async function loadGitHandlers() {
  const { parseGitUrl } = await import('./src/lib/git-url-parser')
  const { authenticateGitRequest, createAuthChallenge } = await import('./src/server/git-auth')
  const { 
    handleInfoRefs, 
    handleUploadPack, 
    handleReceivePack,
  } = await import('./src/server/git-http-backend')
  const { getRepoStorageCoordinates } = await import('./src/server/git-storage-naming')
  const { findRepositoryByName } = await import('./src/server/repositories')
  const { formatErrorResponse } = await import('./src/server/git-errors')
  
  return {
    parseGitUrl,
    authenticateGitRequest,
    createAuthChallenge,
    handleInfoRefs,
    handleUploadPack,
    handleReceivePack,
    getRepoStorageCoordinates,
    findRepositoryByName,
    formatErrorResponse,
  }
}

let gitHandlers: Awaited<ReturnType<typeof loadGitHandlers>> | null = null

export function gitHttpProtocol(): Plugin {
  return {
    name: 'git-http-protocol',
    async configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/git/')) {
          return next()
        }

        try {
          if (!gitHandlers) {
            gitHandlers = await loadGitHandlers()
          }
          
          const { 
            parseGitUrl,
            authenticateGitRequest,
            createAuthChallenge,
            handleInfoRefs,
            handleUploadPack,
            handleReceivePack,
            getRepoStorageCoordinates,
            findRepositoryByName,
            formatErrorResponse,
          } = gitHandlers
          
          const fullUrl = `http://${req.headers.host}${req.url}`
          const parsed = parseGitUrl(fullUrl)
          
          if (!parsed) {
            res.statusCode = 400
            res.end('Invalid git request')
            return
          }
          
          const { owner, repo, service, isInfoRefs } = parsed
          
          const request = new Request(fullUrl, {
            method: req.method,
            headers: req.headers as HeadersInit,
          })
          
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
          
          const requireWrite = service === 'git-receive-pack'
          
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
          
          const storage = getRepoStorageCoordinates(repository)

          if (req.method === 'GET' && isInfoRefs && service) {
            try {
              const result = await handleInfoRefs(
                storage.ownerKey,
                repo,
                service,
                authContext,
                repository.updatedAt,
                repository.defaultBranch || 'main',
                storage.legacyOwnerKeys,
              )
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
          
          if (req.method === 'POST' && service && !isInfoRefs) {
            const chunks: Buffer[] = []
            req.on('data', (chunk) => chunks.push(chunk))
            req.on('end', async () => {
              try {
                const body = Buffer.concat(chunks)
                
                const request = new Request(fullUrl, {
                  method: 'POST',
                  headers: req.headers as HeadersInit,
                  body: body,
                })
                
                let result
                if (service === 'git-upload-pack') {
                  result = await handleUploadPack(
                    storage.ownerKey,
                    repo,
                    request,
                    authContext,
                    repository.updatedAt,
                    repository.defaultBranch || 'main',
                    storage.legacyOwnerKeys,
                  )
                } else if (service === 'git-receive-pack') {
                  result = await handleReceivePack(
                    storage.ownerKey,
                    repo,
                    request,
                    authContext,
                    repository.updatedAt,
                    repository.defaultBranch || 'main',
                    repository.ownerId,
                    storage.legacyOwnerKeys,
                  )
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
