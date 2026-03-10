import {
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getR2Client, getR2Config } from './r2'

export interface R2File {
  key: string
  size: number
  lastModified: Date
  etag: string
}

/**
 * Upload a file to R2
 */
export async function uploadToR2(key: string, body: Buffer | string, contentType?: string) {
  const client = getR2Client()
  const { bucketName } = getR2Config()

  await client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  )

  return { key, bucketName }
}

/**
 * Download a file from R2
 */
export async function downloadFromR2(key: string) {
  const client = getR2Client()
  const { bucketName } = getR2Config()

  const response = await client.send(
    new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    }),
  )

  if (!response.Body) {
    throw new Error('No body returned from R2')
  }

  const content = await response.Body.transformToByteArray()
  return {
    content: Buffer.from(content),
    contentType: response.ContentType,
    size: response.ContentLength,
  }
}

/**
 * Get a file from R2 (alias for downloadFromR2)
 */
export async function getFileFromR2(key: string) {
  const result = await downloadFromR2(key)
  return result.content
}

/**
 * List files in R2 bucket
 */
export async function listR2Files(prefix?: string, maxKeys = 100): Promise<R2File[]> {
  const client = getR2Client()
  const { bucketName } = getR2Config()

  const response = await client.send(
    new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: prefix,
      MaxKeys: maxKeys,
    }),
  )

  return (
    response.Contents?.map((obj) => ({
      key: obj.Key || '',
      size: obj.Size || 0,
      lastModified: obj.LastModified || new Date(),
      etag: obj.ETag || '',
    })) || []
  )
}

/**
 * Delete a file from R2
 */
export async function deleteFromR2(key: string) {
  const client = getR2Client()
  const { bucketName } = getR2Config()

  await client.send(
    new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key,
    }),
  )

  return { deleted: true, key }
}

/**
 * Check if a file exists in R2
 */
export async function fileExistsInR2(key: string): Promise<boolean> {
  const client = getR2Client()
  const { bucketName } = getR2Config()

  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: bucketName,
        Key: key,
      }),
    )
    return true
  } catch (error) {
    return false
  }
}

/**
 * Generate a presigned URL for downloading a file
 * @param key - The file key in R2
 * @param expiresIn - URL validity in seconds (default: 1 hour)
 */
export async function getPresignedDownloadUrl(key: string, expiresIn = 3600) {
  const client = getR2Client()
  const { bucketName } = getR2Config()

  return await getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    }),
    { expiresIn },
  )
}

/**
 * Generate a presigned URL for uploading a file
 * @param key - The file key in R2
 * @param contentType - Required content type for the upload
 * @param expiresIn - URL validity in seconds (default: 1 hour)
 */
export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn = 3600,
) {
  const client = getR2Client()
  const { bucketName } = getR2Config()

  return await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn },
  )
}

/**
 * Get public URL for a file (if bucket has public access)
 * Note: R2 buckets are private by default. Use presigned URLs instead.
 */
export function getPublicUrl(key: string): string {
  const { endpoint, bucketName } = getR2Config()
  return `${endpoint}/${bucketName}/${key}`
}
