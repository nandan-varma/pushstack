import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { formatDistanceToNow } from 'date-fns'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getRepositoryByName } from '@/server/repositories'
import { getBranches } from '@/server/files'
import { getPullRequests, createPullRequest } from '@/server/issues'

export const Route = createFileRoute('/repo/$owner/$name/pulls')({
  component: PullRequestsPage,
})

function PullRequestsPage() {
  const { owner, name } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<'open' | 'closed' | 'merged' | 'all'>('open')
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [newPR, setNewPR] = useState({
    title: '',
    body: '',
    baseBranch: 'main',
    headBranch: '',
  })

  const { data: repo } = useQuery({
    queryKey: ['repository', owner, name],
    queryFn: () => getRepositoryByName({ data: { owner, name } }),
  })

  const { data: pullRequests, isLoading } = useQuery({
    queryKey: ['pullRequests', repo?.id, filter],
    queryFn: () => getPullRequests({ data: { repoId: repo!.id, status: filter === 'all' ? undefined : filter } }),
    enabled: !!repo,
  })

  const { data: branches } = useQuery({
    queryKey: ['branches', repo?.id],
    queryFn: () => getBranches({ data: { repoId: repo!.id } }),
    enabled: !!repo,
  })

  const createMutation = useMutation({
    mutationFn: createPullRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pullRequests'] })
      setIsCreateOpen(false)
      setNewPR({ title: '', body: '', baseBranch: 'main', headBranch: '' })
    },
  })

  const handleCreatePR = () => {
    if (!newPR.title.trim() || !newPR.headBranch || !repo) return
    createMutation.mutate({
      data: {
        repoId: repo.id,
        title: newPR.title,
        body: newPR.body,
        baseBranch: newPR.baseBranch,
        headBranch: newPR.headBranch,
      }
    })
  }

  const openPRsCount = pullRequests?.filter((pr) => pr.status === 'open').length || 0
  const closedPRsCount = pullRequests?.filter((pr) => pr.status === 'closed').length || 0
  const mergedPRsCount = pullRequests?.filter((pr) => pr.status === 'merged').length || 0

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'open':
        return 'success'
      case 'merged':
        return 'info'
      case 'closed':
        return 'default'
      default:
        return 'default'
    }
  }

  return (
    <div className="container py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[var(--sea-ink)]">Pull Requests</h1>
          <p className="text-[var(--sea-ink-soft)] mt-1">
            Propose changes and review code
          </p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button>New Pull Request</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Pull Request</DialogTitle>
              <DialogDescription>
                Merge changes from one branch into another
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={newPR.title}
                  onChange={(e) =>
                    setNewPR((prev) => ({ ...prev, title: e.target.value }))
                  }
                  placeholder="Pull request title"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="base">Base Branch</Label>
                  <select
                    id="base"
                    value={newPR.baseBranch}
                    onChange={(e) =>
                      setNewPR((prev) => ({ ...prev, baseBranch: e.target.value }))
                    }
                    className="flex h-10 w-full rounded-md border border-[var(--line)] bg-[var(--card-bg)] px-3 py-2 text-sm"
                  >
                    {branches?.map((branch) => (
                      <option key={branch.name} value={branch.name}>
                        {branch.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="head">Compare Branch</Label>
                  <select
                    id="head"
                    value={newPR.headBranch}
                    onChange={(e) =>
                      setNewPR((prev) => ({ ...prev, headBranch: e.target.value }))
                    }
                    className="flex h-10 w-full rounded-md border border-[var(--line)] bg-[var(--card-bg)] px-3 py-2 text-sm"
                  >
                    <option value="">Select branch...</option>
                    {branches
                      ?.filter((b) => b.name !== newPR.baseBranch)
                      .map((branch) => (
                        <option key={branch.name} value={branch.name}>
                          {branch.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="body">Description</Label>
                <Textarea
                  id="body"
                  value={newPR.body}
                  onChange={(e) =>
                    setNewPR((prev) => ({ ...prev, body: e.target.value }))
                  }
                  placeholder="Describe your changes..."
                  rows={6}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleCreatePR}
                disabled={
                  !newPR.title.trim() ||
                  !newPR.headBranch ||
                  createMutation.isPending
                }
              >
                {createMutation.isPending ? 'Creating...' : 'Create Pull Request'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 border-b border-[var(--line)]">
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            filter === 'open'
              ? 'border-[var(--accent)] text-[var(--accent)]'
              : 'border-transparent text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]'
          }`}
          onClick={() => setFilter('open')}
        >
          Open ({openPRsCount})
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            filter === 'merged'
              ? 'border-[var(--accent)] text-[var(--accent)]'
              : 'border-transparent text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]'
          }`}
          onClick={() => setFilter('merged')}
        >
          Merged ({mergedPRsCount})
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            filter === 'closed'
              ? 'border-[var(--accent)] text-[var(--accent)]'
              : 'border-transparent text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]'
          }`}
          onClick={() => setFilter('closed')}
        >
          Closed ({closedPRsCount})
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            filter === 'all'
              ? 'border-[var(--accent)] text-[var(--accent)]'
              : 'border-transparent text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]'
          }`}
          onClick={() => setFilter('all')}
        >
          All ({(pullRequests?.length || 0)})
        </button>
      </div>

      {/* Pull Requests List */}
      {isLoading ? (
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <Card key={i} className="p-4 animate-pulse">
              <div className="h-6 bg-[var(--card-bg)] rounded w-3/4 mb-2" />
              <div className="h-4 bg-[var(--card-bg)] rounded w-1/2" />
            </Card>
          ))}
        </div>
      ) : pullRequests?.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-[var(--sea-ink-soft)] mb-4">
            No {filter !== 'all' ? filter : ''} pull requests found
          </p>
          <Button onClick={() => setIsCreateOpen(true)}>
            Create First Pull Request
          </Button>
        </Card>
      ) : (
        <div className="space-y-2">
          {pullRequests?.map((pr) => (
            <Card
              key={pr.id}
              className="p-4 hover:border-[var(--accent)] transition-colors cursor-pointer"
              onClick={() =>
                navigate({
                  to: '/repo/$owner/$name/pulls/$id',
                  params: { owner, name, id: pr.id.toString() },
                })
              }
            >
              <div className="flex items-start gap-4">
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-medium text-[var(--sea-ink)] hover:text-[var(--accent)]">
                      {pr.title}
                    </h3>
                    <Badge variant={getStatusBadgeVariant(pr.status)}>
                      {pr.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-[var(--sea-ink-soft)]">
                    #{pr.id} opened{' '}
                    {formatDistanceToNow(new Date(pr.createdAt), {
                      addSuffix: true,
                    })}{' '}
                    by {pr.author?.name || 'Unknown'} •{' '}
                    <span className="font-mono">
                      {pr.headBranch} → {pr.baseBranch}
                    </span>
                  </p>
                </div>
                {pr._count?.comments > 0 && (
                  <div className="flex items-center gap-1 text-sm text-[var(--sea-ink-soft)]">
                    <span>💬</span>
                    <span>{pr._count.comments}</span>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
