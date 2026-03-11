import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getRepositoryByName } from '@/server/repositories'
import { getBranches, uploadFile } from '@/server/files'
import { auth } from '../../lib/auth'

const getAuthSession = createServerFn({ method: 'GET' }).handler(async () => {
  const headers = getRequestHeaders()
  return await auth.api.getSession({ headers })
})

export const Route = createFileRoute('/repo/$owner/$name/upload')({
  beforeLoad: async () => {
    const session = await getAuthSession()

    if (!session?.user) {
      throw redirect({ to: '/auth/login' })
    }
  },
  component: FileUploadPage,
})

function FileUploadPage() {
  const { owner, name } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  
  const [file, setFile] = useState<File | null>(null)
  const [path, setPath] = useState('')
  const [commitMessage, setCommitMessage] = useState('')
  const [branch, setBranch] = useState('main')
  const [isDragging, setIsDragging] = useState(false)

  const { data: repo } = useQuery({
    queryKey: ['repository', owner, name],
    queryFn: () => getRepositoryByName({ data: { owner, name } }),
  })

  const { data: branches } = useQuery({
    queryKey: ['branches', repo?.id],
    queryFn: () => getBranches({ data: { repoId: repo!.id } }),
    enabled: !!repo,
  })

  const uploadMutation = useMutation({
    mutationFn: uploadFile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] })
      navigate({ to: '/repo/$owner/$name', params: { owner, name } })
    },
  })

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0])
      if (!path) {
        setPath(e.dataTransfer.files[0].name)
      }
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => {
    setIsDragging(false)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      setFile(e.target.files[0])
      if (!path) {
        setPath(e.target.files[0].name)
      }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file || !path || !commitMessage || !repo) return

    const reader = new FileReader()
    reader.onload = async () => {
      const buffer = reader.result as ArrayBuffer
      const bytes = new Uint8Array(buffer)
      let binary = ''
      for (const byte of bytes) {
        binary += String.fromCharCode(byte)
      }
      const base64 = window.btoa(binary)
      
      uploadMutation.mutate({
        data: {
          repoId: repo.id,
          branchName: branch,
          path,
          content: base64,
          commitMessage,
        }
      })
    }
    reader.readAsArrayBuffer(file)
  }

  return (
    <div className="container max-w-4xl py-8">
      <Card>
        <CardHeader>
          <CardTitle>Upload File to {owner}/{name}</CardTitle>
          <CardDescription>
            Add a new file to the repository
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Branch Selection */}
            <div className="space-y-2">
              <Label htmlFor="branch">Branch</Label>
              <select
                id="branch"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className="flex h-10 w-full rounded-md border border-[var(--line)] bg-[var(--card-bg)] px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-[var(--sea-ink-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {branches?.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            {/* File Drop Zone */}
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                isDragging
                  ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                  : 'border-[var(--line)]'
              }`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              {file ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-[var(--sea-ink)]">
                    {file.name}
                  </p>
                  <p className="text-xs text-[var(--sea-ink-soft)]">
                    {(file.size / 1024).toFixed(2)} KB
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setFile(null)}
                  >
                    Remove
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-[var(--sea-ink)]">
                    Drop a file here or click to select
                  </p>
                  <input
                    type="file"
                    onChange={handleFileChange}
                    className="hidden"
                    id="file-input"
                  />
                  <Label htmlFor="file-input">
                    <Button type="button" variant="outline" asChild>
                      <span>Choose File</span>
                    </Button>
                  </Label>
                </div>
              )}
            </div>

            {/* File Path */}
            <div className="space-y-2">
              <Label htmlFor="path">File Path</Label>
              <Input
                id="path"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="path/to/file.txt"
                required
              />
              <p className="text-xs text-[var(--sea-ink-soft)]">
                The path where the file will be stored in the repository
              </p>
            </div>

            {/* Commit Message */}
            <div className="space-y-2">
              <Label htmlFor="message">Commit Message</Label>
              <Textarea
                id="message"
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder="Add file via upload"
                required
                rows={3}
              />
            </div>

            {/* Submit */}
            <div className="flex gap-2">
              <Button
                type="submit"
                disabled={!file || !path || !commitMessage || uploadMutation.isPending}
              >
                {uploadMutation.isPending ? 'Uploading...' : 'Upload File'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate({ to: '/repo/$owner/$name', params: { owner, name } })}
              >
                Cancel
              </Button>
            </div>

            {uploadMutation.isError && (
              <p className="text-sm text-red-600">
                Error: {uploadMutation.error?.message || 'Failed to upload file'}
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
