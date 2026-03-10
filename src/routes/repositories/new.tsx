import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { auth } from '../../lib/auth'
import { createRepository } from '../../server/repositories'
import { useMutation } from '@tanstack/react-query'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Textarea } from '../../components/ui/textarea'
import { Select } from '../../components/ui/select'

const getAuthSession = createServerFn({ method: 'GET' }).handler(async () => {
  const headers = getRequestHeaders()
  return await auth.api.getSession({ headers })
})

export const Route = createFileRoute('/repositories/new')({
  component: NewRepositoryPage,
  beforeLoad: async () => {
    const session = await getAuthSession()
    
    if (!session?.user) {
      throw redirect({ to: '/auth/login' })
    }
    
    return { user: session.user }
  },
})

function NewRepositoryPage() {
  const navigate = useNavigate()
  const { user } = Route.useRouteContext()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<'public' | 'private'>('public')
  const [error, setError] = useState('')

  const createRepoMutation = useMutation({
    mutationFn: createRepository,
    onSuccess: (repo) => {
      navigate({ to: `/repo/${user.name}/${repo.name}` })
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to create repository')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    
    if (!name.trim()) {
      setError('Repository name is required')
      return
    }
    
    createRepoMutation.mutate({
      data: { name, description, visibility },
    })
  }

  return (
    <div className="page-wrap py-8">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-[var(--sea-ink)]">
            Create a new repository
          </h1>
          <p className="mt-2 text-[var(--sea-ink-soft)]">
            A repository contains all project files and revision history.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="rounded-lg bg-red-50 p-4 text-sm text-red-600 border border-red-200">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="name">Repository name *</Label>
            <Input
              id="name"
              type="text"
              placeholder="my-awesome-project"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              pattern="[a-zA-Z0-9-_]+"
              title="Only letters, numbers, hyphens, and underscores allowed"
            />
            <p className="text-xs text-[var(--sea-ink-soft)]">
              {user.name}/{name || 'repository-name'}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              placeholder="A brief description of your repository"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="visibility">Visibility</Label>
            <div className="space-y-3">
              <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition ${visibility === 'public' ? 'border-[var(--lagoon-deep)] bg-[rgba(79,184,178,0.05)]' : 'border-[var(--line)]'}`}>
                <input
                  type="radio"
                  name="visibility"
                  value="public"
                  checked={visibility === 'public'}
                  onChange={() => setVisibility('public')}
                  className="mt-0.5"
                />
                <div>
                  <div className="font-semibold text-[var(--sea-ink)]">
                    Public
                  </div>
                  <div className="text-sm text-[var(--sea-ink-soft)]">
                    Anyone can see this repository
                  </div>
                </div>
              </label>
              
              <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition ${visibility === 'private' ? 'border-[var(--lagoon-deep)] bg-[rgba(79,184,178,0.05)]' : 'border-[var(--line)]'}`}>
                <input
                  type="radio"
                  name="visibility"
                  value="private"
                  checked={visibility === 'private'}
                  onChange={() => setVisibility('private')}
                  className="mt-0.5"
                />
                <div>
                  <div className="font-semibold text-[var(--sea-ink)]">
                    Private
                  </div>
                  <div className="text-sm text-[var(--sea-ink-soft)]">
                    You choose who can see and commit
                  </div>
                </div>
              </label>
            </div>
          </div>

          <div className="flex gap-3">
            <Button
              type="submit"
              disabled={createRepoMutation.isPending}
            >
              {createRepoMutation.isPending ? 'Creating...' : 'Create repository'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate({ to: '/dashboard' })}
            >
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
