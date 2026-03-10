/**
 * Git HTTP Backend using node-git-server
 * Handles git smart HTTP protocol for clone, fetch, and push operations
 */

import { spawn } from 'node:child_process'
import { join } from 'node:path'
import type { GitAuthContext } from './git-auth'

/**
 * Get the path to the repository on disk
 * Uses user ID (not username) to match git-manager-iso.ts path format
 */
export function getRepoPath(userId: string, repo: string): string {
  // Base path for all git repositories
  const baseGitPath = process.env.GIT_REPOS_PATH || join(process.cwd(), '.git-repos')
  // Use userId directory (not username) to match web UI expectations
  return join(baseGitPath, userId, repo)
}

/**
 * Handle git-upload-pack (clone/fetch) using git command
 */
export async function handleUploadPack(
  repoPath: string,
  requestBody: ArrayBuffer,
  authContext: GitAuthContext
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  if (!authContext.canRead) {
    return {
      status: 403,
      headers: { 'Content-Type': 'text/plain' },
      body: Buffer.from('Forbidden: No read access')
    }
  }

  return executeCgiService('upload-pack', repoPath, requestBody)
}

/**
 * Handle git-receive-pack (push) using git command
 */
export async function handleReceivePack(
  repoPath: string,
  requestBody: ArrayBuffer,
  authContext: GitAuthContext
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  if (!authContext.canWrite) {
    return {
      status: 403,
      headers: { 'Content-Type': 'text/plain' },
      body: Buffer.from('Forbidden: No write access')
    }
  }

  return executeCgiService('receive-pack', repoPath, requestBody)
}

/**
 * Execute git service as CGI
 */
async function executeCgiService(
  service: 'upload-pack' | 'receive-pack',
  repoPath: string,
  requestBody: ArrayBuffer
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
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
          body: Buffer.from(`Git ${service} failed: ${errorMsg}`)
        })
        return
      }
      
      const body = Buffer.concat(chunks)
      resolve({
        status: 200,
        headers: {
          'Content-Type': `application/x-git-${service}-result`,
          'Cache-Control': 'no-cache'
        },
        body
      })
    })
    
    git.on('error', (err) => {
      console.error(`Failed to spawn git ${service}:`, err)
      resolve({
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
        body: Buffer.from(`Failed to execute git ${service}: ${err.message}`)
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
  repoPath: string,
  service: 'git-upload-pack' | 'git-receive-pack',
  authContext: GitAuthContext
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  // Check permissions
  if (service === 'git-upload-pack' && !authContext.canRead) {
    return {
      status: 403,
      headers: { 'Content-Type': 'text/plain' },
      body: Buffer.from('Forbidden: No read access')
    }
  }
  
  if (service === 'git-receive-pack' && !authContext.canWrite) {
    return {
      status: 403,
      headers: { 'Content-Type': 'text/plain' },
      body: Buffer.from('Forbidden: No write access')
    }
  }

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
          body: Buffer.from(`Repository not found or inaccessible`)
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
          'Cache-Control': 'no-cache'
        },
        body
      })
    })
    
    git.on('error', (err) => {
      console.error(`Failed to spawn git ${service}:`, err)
      resolve({
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
        body: Buffer.from(`Failed to execute git: ${err.message}`)
      })
    })
    
    git.stdin.end()
  })
}

/**
 * Initialize a bare repository on disk
 */
export async function initBareRepository(repoPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const git = spawn('git', ['init', '--bare', repoPath])
    
    git.on('close', (code) => {
      resolve(code === 0)
    })
    
    git.on('error', () => {
      resolve(false)
    })
  })
}
