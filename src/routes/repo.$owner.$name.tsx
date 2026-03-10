import { createFileRoute, redirect, Link, Outlet } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { auth } from '../lib/auth'
import { getRepositoryByName, toggleStar } from '../server/repositories'
import { getBranches } from '../server/files'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { CloneModal } from '@/components/CloneModal'
import { z } from 'zod'

const repoRouteSchema = z.object({
  owner: z.string(),
  name: z.string(),
})

const getAuthSession = createServerFn({ method: 'GET' }).handler(async () => {
  const headers = getRequestHeaders()
  return await auth.api.getSession({ headers })
})

export const Route = createFileRoute('/repo/$owner/$name')({
  component: RepositoryPage,
  beforeLoad: async () => {
    const session = await getAuthSession()
    
    if (!session?.user) {
      throw redirect({ to: '/auth/login' })
    }
    
    return { user: session.user }
  },
  parseParams: (params) => repoRouteSchema.parse(params),
})

function RepositoryPage() {
  const { owner, name } = Route.useParams()
  const { user } = Route.useRouteContext()
  const queryClient = useQueryClient()
  
  const { data: repo, isLoading } = useQuery({
    queryKey: ['repository', owner, name],
    queryFn: () => getRepositoryByName({ data: { owner, name } }),
  })
  
  const starMutation = useMutation({
    mutationFn: toggleStar,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repository', owner, name] })
    },
  })

  if (isLoading) {
    return (
      <div className="page-wrap py-8">
        <div className="h-64 animate-pulse rounded-xl border border-[var(--line)] bg-[var(--card-bg)]" />
      </div>
    )
  }

  if (!repo) {
    return (
      <div className="page-wrap py-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-[var(--sea-ink)]">Repository not found</h1>
          <Link to="/dashboard">
            <Button className="mt-4">Back to Dashboard</Button>
          </Link>
        </div>
      </div>
    )
  }

  const isOwner = repo.ownerId === user.id

  return (
    <div className="page-wrap py-8">
      {/* Repository Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 text-[var(--sea-ink-soft)]">
              <a href={`/user/${owner}`} className="hover:underline">
                {owner}
              </a>
              <span>/</span>
              <span className="font-semibold text-[var(--sea-ink)]">{name}</span>
              <span className={`ml-2 inline-block rounded-full border px-2 py-0.5 text-xs ${repo.visibility === 'public' ? 'border-green-500 text-green-600' : 'border-yellow-500 text-yellow-600'}`}>
                {repo.visibility}
              </span>
            </div>
            {repo.description && (
              <p className="mt-2 text-[var(--sea-ink-soft)]">{repo.description}</p>
            )}
          </div>
          
          <div className="flex gap-2">
            <CloneModal owner={owner} repoName={name} />
            
            <Button
              variant="outline"
              size="sm"
              onClick={() => starMutation.mutate({ data: { repoId: repo.id } })}
              disabled={starMutation.isPending}
            >
              ☆ Star
            </Button>
            
            {isOwner && (
              <a href={`/repo/${owner}/${name}/settings`}>
                <Button variant="outline" size="sm">Settings</Button>
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="mb-6 border-b border-[var(--line)]">
        <nav className="flex gap-6">
          <Link
            to="/repo/$owner/$name"
            params={{ owner, name }}
            className="border-b-2 border-transparent px-1 pb-3 text-sm font-medium transition hover:text-[var(--lagoon-deep)] [&.active]:border-[var(--lagoon-deep)] [&.active]:text-[var(--lagoon-deep)]"
            activeProps={{ className: 'active' }}
          >
            Code
          </Link>
          <Link
            to="/repo/$owner/$name/issues"
            params={{ owner, name }}
            className="border-b-2 border-transparent px-1 pb-3 text-sm font-medium transition hover:text-[var(--lagoon-deep)] [&.active]:border-[var(--lagoon-deep)] [&.active]:text-[var(--lagoon-deep)]"
            activeProps={{ className: 'active' }}
          >
            Issues
          </Link>
          <Link
            to="/repo/$owner/$name/pulls"
            params={{ owner, name }}
            className="border-b-2 border-transparent px-1 pb-3 text-sm font-medium transition hover:text-[var(--lagoon-deep)] [&.active]:border-[var(--lagoon-deep)] [&.active]:text-[var(--lagoon-deep)]"
            activeProps={{ className: 'active' }}
          >
            Pull Requests
          </Link>
          <Link
            to="/repo/$owner/$name/commits"
            params={{ owner, name }}
            className="border-b-2 border-transparent px-1 pb-3 text-sm font-medium transition hover:text-[var(--lagoon-deep)] [&.active]:border-[var(--lagoon-deep)] [&.active]:text-[var(--lagoon-deep)]"
            activeProps={{ className: 'active' }}
          >
            Commits
          </Link>
        </nav>
      </div>

      {/* Content Area */}
      <Outlet />
    </div>
  )
}
