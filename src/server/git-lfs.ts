/**
 * Git LFS (Large File Storage) Service
 * 
 * Handle large file storage using R2 with Git LFS protocol.
 */

import * as nodegit from 'nodegit';
import * as crypto from 'node:crypto';
import { uploadToR2, downloadFromR2, getPresignedDownloadUrl, getPresignedUploadUrl } from '#/lib/r2-operations';

// LFS configuration
const LFS_THRESHOLD_BYTES = 10 * 1024 * 1024; // 10 MB
const LFS_VERSION = 'https://git-lfs.github.com/spec/v1';

export interface LFSPointer {
  version: string;
  oid: string; // SHA256 of the file
  size: number;
}

export interface LFSObject {
  oid: string;
  size: number;
  r2Key: string;
}

/**
 * Check if a file should use LFS
 */
export function shouldUseLFS(size: number): boolean {
  return size >= LFS_THRESHOLD_BYTES;
}

/**
 * Calculate SHA256 hash for LFS object
 */
export function calculateLFSHash(content: Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Generate LFS pointer file content
 */
export function generateLFSPointer(oid: string, size: number): string {
  return [
    `version ${LFS_VERSION}`,
    `oid sha256:${oid}`,
    `size ${size}`,
  ].join('\n') + '\n';
}

/**
 * Parse LFS pointer file content
 */
export function parseLFSPointer(content: string): LFSPointer | null {
  const lines = content.trim().split('\n');
  
  if (lines.length < 3) return null;
  
  const versionLine = lines.find(l => l.startsWith('version '));
  const oidLine = lines.find(l => l.startsWith('oid sha256:'));
  const sizeLine = lines.find(l => l.startsWith('size '));
  
  if (!versionLine || !oidLine || !sizeLine) return null;
  
  const version = versionLine.replace('version ', '');
  const oid = oidLine.replace('oid sha256:', '');
  const size = Number.parseInt(sizeLine.replace('size ', ''), 10);
  
  if (version !== LFS_VERSION || !oid || isNaN(size)) return null;
  
  return { version, oid, size };
}

/**
 * Check if content is an LFS pointer
 */
export function isLFSPointer(content: string): boolean {
  return parseLFSPointer(content) !== null;
}

/**
 * Upload large file to R2 LFS storage
 */
export async function uploadLFSObject(
  ownerId: number,
  repoName: string,
  content: Buffer
): Promise<LFSObject> {
  const oid = calculateLFSHash(content);
  const size = content.length;
  const r2Key = `lfs/${ownerId}/${repoName}/${oid.substring(0, 2)}/${oid.substring(2, 4)}/${oid}`;
  
  // Upload to R2
  await uploadToR2(r2Key, content);
  
  return { oid, size, r2Key };
}

/**
 * Download LFS object from R2
 */
export async function downloadLFSObject(
  oid: string,
  ownerId: number,
  repoName: string
): Promise<Buffer | null> {
  const r2Key = `lfs/${ownerId}/${repoName}/${oid.substring(0, 2)}/${oid.substring(2, 4)}/${oid}`;
  
  const content = await downloadFromR2(r2Key);
  return content;
}

/**
 * Process file upload - use LFS if needed
 */
export async function processFileUpload(
  ownerId: number,
  repoName: string,
  filePath: string,
  content: Buffer
): Promise<{ content: Buffer; isLFS: boolean; lfsObject?: LFSObject }> {
  if (shouldUseLFS(content.length)) {
    // Upload to LFS
    const lfsObject = await uploadLFSObject(ownerId, repoName, content);
    
    // Create pointer file
    const pointerContent = generateLFSPointer(lfsObject.oid, lfsObject.size);
    
    return {
      content: Buffer.from(pointerContent, 'utf-8'),
      isLFS: true,
      lfsObject,
    };
  }
  
  return {
    content,
    isLFS: false,
  };
}

/**
 * Resolve file content - fetch from LFS if pointer
 */
export async function resolveFileContent(
  ownerId: number,
  repoName: string,
  content: Buffer
): Promise<Buffer> {
  const contentStr = content.toString('utf-8');
  const pointer = parseLFSPointer(contentStr);
  
  if (pointer) {
    // It's an LFS pointer - fetch actual content
    const lfsContent = await downloadLFSObject(pointer.oid, ownerId, repoName);
    if (lfsContent) {
      return lfsContent;
    }
    throw new Error(`LFS object not found: ${pointer.oid}`);
  }
  
  // Regular file content
  return content;
}

/**
 * Get presigned URL for LFS object download
 */
export async function getLFSDownloadUrl(
  ownerId: number,
  repoName: string,
  oid: string,
  expiresIn: number = 3600
): Promise<string> {
  const r2Key = `lfs/${ownerId}/${repoName}/${oid.substring(0, 2)}/${oid.substring(2, 4)}/${oid}`;
  return await getPresignedDownloadUrl(r2Key, expiresIn);
}

/**
 * Get presigned URL for LFS object upload
 */
export async function getLFSUploadUrl(
  ownerId: number,
  repoName: string,
  oid: string,
  expiresIn: number = 3600
): Promise<string> {
  const r2Key = `lfs/${ownerId}/${repoName}/${oid.substring(0, 2)}/${oid.substring(2, 4)}/${oid}`;
  return await getPresignedUploadUrl(r2Key, expiresIn);
}

/**
 * Verify LFS object exists and matches size
 */
export async function verifyLFSObject(
  ownerId: number,
  repoName: string,
  oid: string,
  expectedSize: number
): Promise<boolean> {
  try {
    const content = await downloadLFSObject(oid, ownerId, repoName);
    if (!content) return false;
    
    if (content.length !== expectedSize) return false;
    
    const actualOid = calculateLFSHash(content);
    return actualOid === oid;
  } catch {
    return false;
  }
}

/**
 * Clean up orphaned LFS objects (not referenced by any pointer)
 */
export async function cleanupOrphanedLFSObjects(
  ownerId: number,
  repoName: string
): Promise<{ removed: number; freedBytes: number }> {
  // This is a placeholder for LFS garbage collection
  // In production, you would:
  // 1. List all LFS objects in R2
  // 2. Scan all refs/commits for pointer files
  // 3. Remove objects not referenced
  
  return { removed: 0, freedBytes: 0 };
}
