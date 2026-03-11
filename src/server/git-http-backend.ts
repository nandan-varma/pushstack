/**
 * Git HTTP Backend using native git services
 * Handles git smart HTTP protocol for clone, fetch, and push operations
 */

import { spawn } from 'node:child_process'
import type { GitAuthContext } from './git-auth'
import { ensureRepositoryHydrated, initRepositoryStorage, syncRepositoryToR2 } from './git-repo-storage'

type GitHttpResult = {
  status: number
  headers: Record<string, string>
  body: Buffer
}

/**
 * Handle git-upload-pack (clone/fetch) using git command
 */
export async function handleUploadPack(
  ownerId: number,
  repoName: string,
  requestBody: ArrayBuffer,
  authContext: GitAuthContext,
  remoteUpdatedAt?: Date | null,
  defaultBranch: string = 'main',
): Promise<GitHttpResult> {
  if (!authContext.canRead) {
    return {
      status: 403,
      headers: { 'Content-Type': 'text/plain' },
      body: Buffer.from('Forbidden: No read access'),
    }
  }

  const repoPath = await ensureRepositoryHydrated(ownerId, repoName, remoteUpdatedAt, defaultBranch)
  return executeCgiService('upload-pack', repoPath, requestBody)
}

/**
 * Handle git-receive-pack (push) using git command
 */
export async function handleReceivePack(
  ownerId: number,
  repoName: string,
  requestBody: ArrayBuffer,
  authContext: GitAuthContext,
  remoteUpdatedAt?: Date | null,
  defaultBranch: string = 'main',
): Promise<GitHttpResult> {
  if (!authContext.canWrite) {
    return {
      status: 403,
      headers: { 'Content-Type': 'text/plain' },
      body: Buffer.from('Forbidden: No write access'),
    }
  }

  const repoPath = await ensureRepositoryHydrated(ownerId, repoName, remoteUpdatedAt, defaultBranch)
  const result = await executeCgiService('receive-pack', repoPath, requestBody)

  if (result.status === 200) {
    await syncRepositoryToR2(ownerId, repoName)
  }

  return result
}

/**
 * Execute git service as CGI
 */
async function executeCgiService(
  service: 'upload-pack' | 'receive-pack',
  repoPath: string,
  requestBody: ArrayBuffer
): Promise<GitHttpResult> {
  return new Promise((resolve) => {
    const git = spawn('git', [service, '--stateless-rpc', repoPath])
    
    const chunks: Buffer[] = []
    const errorChunks: Buffer[] = []
    
    git.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    
    git.stderr.on('data', (chunk: Buffer) => {
      errorChunks.push(chunk)
    })
    
    git.on('close', (code) => {
      if (code !== 0) {
        const errorMsg = Buffer.concat(errorChunks).toString()
        console.error(`Git ${service} failed:`, errorMsg)
        resolve({
          status: 500,
          headers: { 'Content-Type': 'text/plain' },
          body: Buffer.from(`Git ${service} failed: ${errorMsg}`),
        })
        return
      }
      
      const body = Buffer.concat(chunks)
      resolve({
        status: 200,
        headers: {
          'Content-Type': `application/x-git-${service}-result`,
          'Cache-Control': 'no-cache',
        },
        body,
      })
    })
    
    git.on('error', (err) => {
      console.error(`Failed to spawn git ${service}:`, err)
      resolve({
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
        body: Buffer.from(`Failed to execute git ${service}: ${err.message}`),
      })
    })
    
    // Write request body to git stdin
    if (requestBody.byteLength > 0) {
      git.stdin.write(Buffer.from(requestBody))
    }
    git.stdin.end()
  })
}

/**
 * Generate git info/refs response
 */
export async function handleInfoRefs(
  ownerId: number,
  repoName: string,
  service: 'git-upload-pack' | 'git-receive-pack',
  authContext: GitAuthContext,
  remoteUpdatedAt?: Date | null,
  defaultBranch: string = 'main',
): Promise<GitHttpResult> {
  // Check permissions
  if (service === 'git-upload-pack' && !authContext.canRead) {
    return {
      status: 403,
      headers: { 'Content-Type': 'text/plain' },
      body: Buffer.from('Forbidden: No read access'),
    }
  }
  
  if (service === 'git-receive-pack' && !authContext.canWrite) {
    return {
      status: 403,
      headers: { 'Content-Type': 'text/plain' },
      body: Buffer.from('Forbidden: No write access'),
    }
  }

  const repoPath = await ensureRepositoryHydrated(ownerId, repoName, remoteUpdatedAt, defaultBranch)

  return new Promise((resolve) => {
    const git = spawn('git', [service.replace('git-', ''), '--stateless-rpc', '--advertise-refs', repoPath])
    
    const chunks: Buffer[] = []
    const errorChunks: Buffer[] = []
    
    git.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    
    git.stderr.on('data', (chunk: Buffer) => {
      errorChunks.push(chunk)
    })
    
    git.on('close', (code) => {
      if (code !== 0) {
        const errorMsg = Buffer.concat(errorChunks).toString()
        console.error(`Git ${service} --advertise-refs failed:`, errorMsg)
        resolve({
          status: 500,
          headers: { 'Content-Type': 'text/plain' },
          body: Buffer.from('Repository not found or inaccessible'),
        })
        return
      }
      
      const refs = Buffer.concat(chunks)
      
      // Format as git smart HTTP protocol response
      const serviceHeader = `# service=${service}\n`
      const headerLength = (serviceHeader.length + 4).toString(16).padStart(4, '0')
      const header = Buffer.from(`${headerLength}${serviceHeader}0000`)
      const body = Buffer.concat([header, refs])
      
      resolve({
        status: 200,
        headers: {
          'Content-Type': `application/x-${service}-advertisement`,
          'Cache-Control': 'no-cache',
        },
        body,
      })
    })
    
    git.on('error', (err) => {
      console.error(`Failed to spawn git ${service}:`, err)
      resolve({
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
        body: Buffer.from(`Failed to execute git: ${err.message}`),
      })
    })
    
    git.stdin.end()
  })
}

/**
 * Initialize a bare repository on disk
 */
export async function initBareRepository(ownerId: number, repoName: string, defaultBranch: string = 'main'): Promise<void> {
  await initRepositoryStorage(ownerId, repoName, defaultBranch)
}
