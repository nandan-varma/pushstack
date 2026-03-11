import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { formatDistanceToNow } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { getRepositoryByName } from '@/server/repositories'
import { getBranches, getCommits } from '@/server/files'

export const Route = createFileRoute('/repo/$owner/$name/commits')({
  component: CommitsPage,
  validateSearch: (search: Record<string, unknown>) => {
    return {
      branch: (search.branch as string) || 'main',
    }
  },
})

function CommitsPage() {
  const { owner, name } = Route.useParams()
  const { branch } = Route.useSearch()
  const navigate = useNavigate()

  const { data: repo } = useQuery({
    queryKey: ['repository', owner, name],
    queryFn: () => getRepositoryByName({ data: { owner, name } }),
  })

  const { data: commits, isLoading } = useQuery({
    queryKey: ['commits', repo?.id, branch],
    queryFn: () => getCommits({ data: { repoId: repo!.id, branchName: branch } }),
    enabled: !!repo,
  })

  const { data: branches } = useQuery({
    queryKey: ['branches', repo?.id],
    queryFn: () => getBranches({ data: { repoId: repo!.id } }),
    enabled: !!repo,
  })

  const getInitials = (name: string) =>
    name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)

  return (
    <div className="container py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[var(--sea-ink)]">Commits</h1>
          <p className="text-[var(--sea-ink-soft)] mt-1">
            View commit history for this repository
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={branch}
            onChange={(e) =>
              navigate({
                to: '/repo/$owner/$name/commits',
                params: { owner, name },
                search: { branch: e.target.value },
              })
            }
            className="flex h-10 rounded-md border border-[var(--line)] bg-[var(--card-bg)] px-3 py-2 text-sm"
          >
            {branches?.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
          </select>
          <Link to="/repo/$owner/$name" params={{ owner, name }}>
            <Button variant="outline" size="sm">
              Back to Repository
            </Button>
          </Link>
        </div>
      </div>

      {/* Branch Info */}
      <Card className="p-4">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-[var(--sea-ink)]">
            Branch:
          </span>
          <code className="px-2 py-1 rounded bg-[var(--chip-bg)] text-[var(--sea-ink)] border border-[var(--chip-line)] text-sm font-mono">
            {branch}
          </code>
          {commits && (
            <span className="text-sm text-[var(--sea-ink-soft)]">
              • {commits.length} commit{commits.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </Card>

      {/* Commits List */}
      {isLoading ? (
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <Card key={i} className="p-4 animate-pulse">
              <div className="flex items-start gap-4">
                <div className="h-10 w-10 rounded-full bg-[var(--card-bg)]" />
                <div className="flex-1 space-y-2">
                  <div className="h-5 bg-[var(--card-bg)] rounded w-3/4" />
                  <div className="h-4 bg-[var(--card-bg)] rounded w-1/2" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : commits?.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-[var(--sea-ink-soft)] mb-4">
            No commits found in this branch
          </p>
          <Link to="/repo/$owner/$name" params={{ owner, name }}>
            <Button variant="outline">View Files</Button>
          </Link>
        </Card>
      ) : (
        <div className="space-y-3">
          {commits?.map((commit) => (
            <Card
              key={commit.sha}
              className="p-4 hover:border-[var(--accent)] transition-colors cursor-pointer"
              onClick={() =>
                navigate({
                  to: '/repo/$owner/$name/commit/$sha',
                  params: { owner, name, sha: commit.sha },
                })
              }
            >
              <div className="flex items-start gap-4">
                <Avatar>
                  <AvatarFallback>
                    {getInitials(commit.author?.name || commit.authorName || 'U')}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-medium text-[var(--sea-ink)] hover:text-[var(--accent)] truncate">
                    {commit.message}
                  </h3>
                  <div className="flex items-center gap-3 mt-2 text-sm text-[var(--sea-ink-soft)]">
                    <span>
                      {commit.author?.name || commit.authorName || 'Unknown'}
                    </span>
                    <span>•</span>
                    <span>
                      {formatDistanceToNow(new Date(commit.createdAt), {
                        addSuffix: true,
                      })}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <code className="px-2 py-1 rounded bg-[var(--chip-bg)] text-[var(--sea-ink)] border border-[var(--chip-line)] text-xs font-mono">
                    {commit.sha.substring(0, 7)}
                  </code>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
