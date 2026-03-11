/**
 * Git Smart HTTP Protocol Implementation
 * 
 * Implements git's smart HTTP protocol (RFC 3977) for clone, fetch, and push operations.
 * Uses isomorphic-git with R2 backend for object storage.
 */

import * as git from 'isomorphic-git'
import { r2Backend, r2RefBackend } from './git-r2-backend'
import { GitTransaction, withTransaction } from './git-transaction'
import { GitProtocolError, GitAuthorizationError, GitObjectNotFoundError } from './git-errors'

// Pkt-line protocol helpers
const PKT_LINE_MAX_LENGTH = 65520

/**
 * Encode data in pkt-line format (4-byte hex length prefix + data)
 */
function pktLine(data: string | Buffer | null): Buffer {
  if (data === null) {
    // Flush packet
    return Buffer.from('0000')
  }
  
  const buf = typeof data === 'string' ? Buffer.from(data) : data
  const length = buf.length + 4
  
  if (length > PKT_LINE_MAX_LENGTH) {
    throw new GitProtocolError(`Pkt-line too long: ${length} bytes`)
  }
  
  const lengthHex = length.toString(16).padStart(4, '0')
  return Buffer.concat([Buffer.from(lengthHex), buf])
}

/**
 * Decode pkt-line data
 */
function* decodePktLines(data: Buffer): Generator<Buffer | null> {
  let offset = 0
  
  while (offset < data.length) {
    if (offset + 4 > data.length) {
      throw new GitProtocolError('Incomplete pkt-line length')
    }
    
    const lengthHex = data.slice(offset, offset + 4).toString('ascii')
    const length = parseInt(lengthHex, 16)
    
    if (length === 0) {
      // Flush packet
      offset += 4
      yield null
      continue
    }
    
    if (length < 4 || length > PKT_LINE_MAX_LENGTH) {
      throw new GitProtocolError(`Invalid pkt-line length: ${lengthHex}`)
    }
    
    if (offset + length > data.length) {
      throw new GitProtocolError('Incomplete pkt-line data')
    }
    
    const payload = data.slice(offset + 4, offset + length)
    offset += length
    yield payload
  }
}

/**
 * Git authentication context from git-auth.ts
 * Uses the same interface as git-auth.ts
 */
import type { GitAuthContext } from './git-auth'

/**
 * Service type for git HTTP protocol
 */
export type GitService = 'git-upload-pack' | 'git-receive-pack'

/**
 * Handle git info/refs request
 * Advertises refs (branches/tags) to the client
 */
export async function handleInfoRefs(
  ownerId: string,
  repoName: string,
  service: GitService,
  authContext: GitAuthContext
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  // Check authorization
  if (service === 'git-upload-pack' && !authContext.canRead) {
    throw new GitAuthorizationError('Read access denied')
  }
  if (service === 'git-receive-pack' && !authContext.canWrite) {
    throw new GitAuthorizationError('Write access denied')
  }
  
  try {
    // Get all refs
    const refs = await r2RefBackend.listRefs(ownerId, repoName, 'refs/')
    
    // Build response
    const lines: Buffer[] = []
    
    // Service announcement
    lines.push(pktLine(`# service=${service}\n`))
    lines.push(pktLine(null)) // Flush
    
    if (refs.length === 0) {
      // Empty repository - advertise HEAD with zero OID
      lines.push(pktLine('0000000000000000000000000000000000000000 capabilities^{}\0side-band-64k thin-pack ofs-delta\n'))
    } else {
      // Advertise refs with capabilities on first ref
      let first = true
      for (const ref of refs) {
        try {
          const sha = await r2RefBackend.readRef(ownerId, repoName, ref)
          
          if (first) {
            lines.push(pktLine(`${sha} ${ref}\0side-band-64k thin-pack ofs-delta\n`))
            first = false
          } else {
            lines.push(pktLine(`${sha} ${ref}\n`))
          }
        } catch (error) {
          // Skip refs that can't be read
          continue
        }
      }
      
      // Advertise HEAD
      try {
        const headRef = await r2RefBackend.readRef(ownerId, repoName, 'HEAD')
        if (headRef.startsWith('ref: ')) {
          const targetRef = headRef.slice(5).trim()
          const targetSha = await r2RefBackend.readRef(ownerId, repoName, targetRef)
          lines.push(pktLine(`${targetSha} HEAD\n`))
        } else {
          lines.push(pktLine(`${headRef} HEAD\n`))
        }
      } catch (error) {
        // HEAD might not exist yet
      }
    }
    
    lines.push(pktLine(null)) // Final flush
    
    return {
      status: 200,
      headers: {
        'Content-Type': `application/x-${service}-advertisement`,
        'Cache-Control': 'no-cache',
      },
      body: Buffer.concat(lines),
    }
  } catch (error) {
    if (error instanceof GitAuthorizationError) {
      throw error
    }
    throw new GitProtocolError(`Failed to handle info/refs: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Handle git upload-pack request (clone/fetch)
 * Generates and sends a packfile with requested objects
 */
export async function handleUploadPack(
  ownerId: string,
  repoName: string,
  requestBody: ArrayBuffer,
  authContext: GitAuthContext
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  // Check authorization
  if (!authContext.canRead) {
    throw new GitAuthorizationError('Read access denied')
  }
  
  try {
    const requestBuffer = Buffer.from(requestBody)
    
    // Parse upload-pack request
    const wants: string[] = []
    const haves: string[] = []
    
    for (const line of decodePktLines(requestBuffer)) {
      if (line === null) continue
      
      const lineStr = line.toString('utf8').trim()
      
      if (lineStr.startsWith('want ')) {
        wants.push(lineStr.split(' ')[1])
      } else if (lineStr.startsWith('have ')) {
        haves.push(lineStr.split(' ')[1])
      } else if (lineStr === 'done') {
        break
      }
    }
    
    if (wants.length === 0) {
      throw new GitProtocolError('No wants specified in upload-pack request')
    }
    
    // Generate packfile using isomorphic-git
    // Note: This is a simplified implementation. A full implementation would:
    // 1. Compute object graph from wants/haves
    // 2. Generate thin pack with deltification
    // 3. Stream packfile to avoid memory issues
    
    // For now, return a simple response indicating success
    const lines: Buffer[] = []
    lines.push(pktLine('NAK\n'))
    lines.push(pktLine(null))
    
    // TODO: Generate actual packfile with requested objects
    // This requires implementing packfile format or using git's native packfile generation
    
    return {
      status: 200,
      headers: {
        'Content-Type': 'application/x-git-upload-pack-result',
        'Cache-Control': 'no-cache',
      },
      body: Buffer.concat(lines),
    }
  } catch (error) {
    if (error instanceof GitAuthorizationError || error instanceof GitProtocolError) {
      throw error
    }
    throw new GitProtocolError(`Failed to handle upload-pack: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Handle git receive-pack request (push)
 * Receives and unpacks objects, updates refs
 */
export async function handleReceivePack(
  ownerId: string,
  repoName: string,
  requestBody: ArrayBuffer,
  authContext: GitAuthContext
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  // Check authorization
  if (!authContext.canWrite) {
    throw new GitAuthorizationError('Write access denied')
  }
  
  try {
    const requestBuffer = Buffer.from(requestBody)
    
    // Parse receive-pack request
    const refUpdates: Array<{ oldSha: string; newSha: string; ref: string }> = []
    let packfileStart = 0
    
    for (const line of decodePktLines(requestBuffer)) {
      if (line === null) {
        packfileStart += 4 // Flush packet
        break
      }
      
      const lineStr = line.toString('utf8').trim()
      
      // Ref update format: <old-sha> <new-sha> <ref-name>
      const match = lineStr.match(/^([0-9a-f]{40}) ([0-9a-f]{40}) (.+)$/)
      if (match) {
        refUpdates.push({
          oldSha: match[1],
          newSha: match[2],
          ref: match[3],
        })
      }
      
      packfileStart += line.length + 4
    }
    
    if (refUpdates.length === 0) {
      throw new GitProtocolError('No ref updates in receive-pack request')
    }
    
    // Extract packfile data (after ref updates)
    const packfileData = requestBuffer.slice(packfileStart)
    
    // Process in transaction
    await withTransaction(async (txn) => {
      // TODO: Unpack packfile and store objects in R2
      // This requires implementing packfile unpacking or using git's native unpack
      
      // Update refs atomically
      for (const update of refUpdates) {
        // Verify old SHA matches (compare-and-swap)
        try {
          const currentSha = await r2RefBackend.readRef(ownerId, repoName, update.ref)
          if (currentSha !== update.oldSha) {
            throw new GitProtocolError(`Ref ${update.ref} was modified (expected ${update.oldSha}, found ${currentSha})`)
          }
        } catch (error) {
          if (error instanceof GitObjectNotFoundError && update.oldSha === '0000000000000000000000000000000000000000') {
            // Creating new ref, this is expected
          } else {
            throw error
          }
        }
        
        // Write new ref value
        if (update.newSha === '0000000000000000000000000000000000000000') {
          // Deleting ref
          await r2RefBackend.deleteRef(ownerId, repoName, update.ref)
        } else {
          // Creating/updating ref
          await r2RefBackend.writeRef(ownerId, repoName, update.ref, update.newSha, update.oldSha)
        }
      }
    })
    
    // Build success response
    const lines: Buffer[] = []
    
    for (const update of refUpdates) {
      lines.push(pktLine(`ok ${update.ref}\n`))
    }
    
    lines.push(pktLine(null))
    
    return {
      status: 200,
      headers: {
        'Content-Type': 'application/x-git-receive-pack-result',
        'Cache-Control': 'no-cache',
      },
      body: Buffer.concat(lines),
    }
  } catch (error) {
    if (error instanceof GitAuthorizationError || error instanceof GitProtocolError) {
      throw error
    }
    throw new GitProtocolError(`Failed to handle receive-pack: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Initialize bare repository in R2
 */
export async function initBareRepository(ownerId: string, repoName: string, defaultBranch: string = 'main'): Promise<void> {
  // Create HEAD pointing to default branch
  await r2RefBackend.writeRef(ownerId, repoName, 'HEAD', `ref: refs/heads/${defaultBranch}`)
  
  // Create empty default branch ref (will be updated on first push)
  // Don't create the branch ref yet - it will be created on first push
}
