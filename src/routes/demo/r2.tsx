import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  uploadToR2,
  listR2Files,
  deleteFromR2,
  getPresignedDownloadUrl,
  getPresignedUploadUrl,
} from '#/lib/r2-operations'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'

// Server functions
const listFiles = createServerFn({
  method: 'GET',
}).handler(async () => {
  return await listR2Files()
})

const uploadFile = createServerFn({
  method: 'POST',
})
  .inputValidator((data: { fileName: string; content: string; contentType: string }) => data)
  .handler(async ({ data }) => {
    // Convert base64 to buffer
    const buffer = Buffer.from(data.content, 'base64')
    return await uploadToR2(data.fileName, buffer, data.contentType)
  })

const deleteFile = createServerFn({
  method: 'POST',
})
  .inputValidator((data: { key: string }) => data)
  .handler(async ({ data }) => {
    return await deleteFromR2(data.key)
  })

const getDownloadUrl = createServerFn({
  method: 'POST',
})
  .inputValidator((data: { key: string }) => data)
  .handler(async ({ data }) => {
    return await getPresignedDownloadUrl(data.key, 3600)
  })

const getUploadUrl = createServerFn({
  method: 'POST',
})
  .inputValidator((data: { fileName: string; contentType: string }) => data)
  .handler(async ({ data }) => {
    return await getPresignedUploadUrl(data.fileName, data.contentType, 3600)
  })

export const Route = createFileRoute('/demo/r2')({
  component: R2Demo,
})

function R2Demo() {
  const queryClient = useQueryClient()
  const [uploadMethod, setUploadMethod] = useState<'direct' | 'presigned'>('direct')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  // Fetch files list
  const { data: files = [], isLoading } = useQuery({
    queryKey: ['r2-files'],
    queryFn: () => listFiles(),
  })

  // Direct upload mutation
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const buffer = await file.arrayBuffer()
      const base64 = Buffer.from(buffer).toString('base64')
      return uploadFile({
        data: {
          fileName: file.name,
          content: base64,
          contentType: file.type,
        },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['r2-files'] })
      setSelectedFile(null)
    },
  })

  // Presigned URL upload mutation
  const presignedUploadMutation = useMutation({
    mutationFn: async (file: File) => {
      // Step 1: Get presigned URL
      const url = await getUploadUrl({
        data: {
          fileName: file.name,
          contentType: file.type,
        },
      })

      // Step 2: Upload directly to R2 using presigned URL
      const response = await fetch(url, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type,
        },
      })

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`)
      }

      return { fileName: file.name }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['r2-files'] })
      setSelectedFile(null)
    },
  })

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: deleteFile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['r2-files'] })
    },
  })

  // Download handler
  const handleDownload = async (key: string) => {
    const url = await getDownloadUrl({ data: { key } })
    window.open(url, '_blank')
  }

  const handleUpload = () => {
    if (!selectedFile) return

    if (uploadMethod === 'direct') {
      uploadMutation.mutate(selectedFile)
    } else {
      presignedUploadMutation.mutate(selectedFile)
    }
  }

  const isPending =
    uploadMutation.isPending || presignedUploadMutation.isPending || deleteMutation.isPending

  return (
    <main className="min-h-screen bg-gradient-to-br from-orange-50 via-red-50 to-pink-50 dark:from-slate-950 dark:via-orange-950/20 dark:to-slate-950 px-4 py-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-lg rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 p-8 mb-6">
          <div className="flex items-start gap-4 mb-4">
            <div className="text-5xl">☁️</div>
            <div className="flex-1">
              <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                Cloudflare R2 Storage
              </h1>
              <p className="text-slate-600 dark:text-slate-400 mb-4">
                S3-compatible object storage with zero egress fees
              </p>
              <div className="flex flex-wrap gap-2">
                <span className="px-3 py-1 rounded-lg bg-orange-100 dark:bg-orange-900/30 text-xs font-medium text-orange-700 dark:text-orange-300">
                  AWS SDK Compatible
                </span>
                <span className="px-3 py-1 rounded-lg bg-red-100 dark:bg-red-900/30 text-xs font-medium text-red-700 dark:text-red-300">
                  Zero Egress Fees
                </span>
                <span className="px-3 py-1 rounded-lg bg-pink-100 dark:bg-pink-900/30 text-xs font-medium text-pink-700 dark:text-pink-300">
                  Presigned URLs
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Upload Section */}
        <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-lg rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 p-6 mb-6">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
            Upload Files
          </h2>

          <div className="space-y-4">
            {/* Upload Method Toggle */}
            <div>
              <Label className="mb-2 block">Upload Method</Label>
              <div className="flex gap-2">
                <Button
                  variant={uploadMethod === 'direct' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setUploadMethod('direct')}
                >
                  Direct Upload
                </Button>
                <Button
                  variant={uploadMethod === 'presigned' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setUploadMethod('presigned')}
                >
                  Presigned URL
                </Button>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                {uploadMethod === 'direct'
                  ? 'File is uploaded through server function (passes through your server)'
                  : 'File is uploaded directly to R2 using a presigned URL (bypasses your server)'}
              </p>
            </div>

            {/* File Input */}
            <div>
              <Label htmlFor="file">Select File</Label>
              <Input
                id="file"
                type="file"
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                disabled={isPending}
              />
              {selectedFile && (
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
                  Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(2)} KB)
                </p>
              )}
            </div>

            {/* Upload Button */}
            <Button onClick={handleUpload} disabled={!selectedFile || isPending} className="w-full">
              {isPending ? 'Uploading...' : 'Upload to R2'}
            </Button>
          </div>
        </div>

        {/* Files List */}
        <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-lg rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 p-6">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
            Stored Files ({files.length})
          </h2>

          {isLoading ? (
            <div className="text-center py-12">
              <div className="h-8 w-8 mx-auto border-4 border-slate-200 border-t-orange-500 rounded-full animate-spin" />
              <p className="mt-4 text-slate-600 dark:text-slate-400">Loading files...</p>
            </div>
          ) : files.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-6xl mb-4">📦</div>
              <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">
                No files yet
              </h3>
              <p className="text-slate-600 dark:text-slate-400">
                Upload your first file to get started!
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {files.map((file) => (
                <div
                  key={file.key}
                  className="flex items-center justify-between p-4 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-900 dark:text-white truncate">
                      {file.key}
                    </p>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {(file.size / 1024).toFixed(2)} KB •{' '}
                      {new Date(file.lastModified).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-2 ml-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDownload(file.key)}
                    >
                      Download
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => deleteMutation.mutate({ data: { key: file.key } })}
                      disabled={deleteMutation.isPending}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Implementation Details */}
        <div className="mt-6 bg-white/80 dark:bg-slate-900/80 backdrop-blur-lg rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 p-6">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-3">
            Implementation Details
          </h3>
          <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
            <div>
              <strong className="text-slate-900 dark:text-white">Direct Upload:</strong>
              <p>File → Browser → Server Function → R2</p>
              <ul className="list-disc list-inside mt-1 ml-4 space-y-1">
                <li>File content sent as base64 through server function</li>
                <li>Server validates and uploads to R2 using AWS SDK</li>
                <li>Good for smaller files and additional validation</li>
              </ul>
            </div>
            <div>
              <strong className="text-slate-900 dark:text-white">Presigned URL Upload:</strong>
              <p>File → Browser → R2 (direct)</p>
              <ul className="list-disc list-inside mt-1 ml-4 space-y-1">
                <li>Server generates presigned URL with expiration</li>
                <li>Browser uploads directly to R2 using presigned URL</li>
                <li>Best for large files, reduces server bandwidth</li>
                <li>Can restrict Content-Type and origin with CORS</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Back Link */}
        <div className="mt-8 text-center">
          <a
            href="/demo"
            className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 font-medium"
          >
            ← Back to Demos
          </a>
        </div>
      </div>
    </main>
  )
}
