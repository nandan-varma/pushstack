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
import { getIssues, createIssue } from '@/server/issues'

export const Route = createFileRoute('/repo/$owner/$name/issues')({
  component: IssuesPage,
})

function IssuesPage() {
  const { owner, name } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<'open' | 'closed' | 'all'>('open')
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [newIssue, setNewIssue] = useState({ title: '', body: '' })

  const { data: repo } = useQuery({
    queryKey: ['repository', owner, name],
    queryFn: () => getRepositoryByName({ data: { owner, name } }),
  })

  const { data: issues, isLoading } = useQuery({
    queryKey: ['issues', repo?.id, filter],
    queryFn: () => getIssues({ data: { repoId: repo!.id, status: filter } }),
    enabled: !!repo,
  })

  const createMutation = useMutation({
    mutationFn: createIssue,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issues'] })
      setIsCreateOpen(false)
      setNewIssue({ title: '', body: '' })
    },
  })

  const handleCreateIssue = () => {
    if (!newIssue.title.trim() || !repo) return
    createMutation.mutate({
      data: {
        repoId: repo.id,
        title: newIssue.title,
        body: newIssue.body,
      }
    })
  }

  const openIssuesCount = issues?.filter((i) => i.status === 'open').length || 0
  const closedIssuesCount = issues?.filter((i) => i.status === 'closed').length || 0

  return (
    <div className="container py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[var(--sea-ink)]">Issues</h1>
          <p className="text-[var(--sea-ink-soft)] mt-1">
            Track bugs, feature requests, and discussions
          </p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button>New Issue</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Issue</DialogTitle>
              <DialogDescription>
                Report a bug, request a feature, or start a discussion
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={newIssue.title}
                  onChange={(e) =>
                    setNewIssue((prev) => ({ ...prev, title: e.target.value }))
                  }
                  placeholder="Issue title"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="body">Description</Label>
                <Textarea
                  id="body"
                  value={newIssue.body}
                  onChange={(e) =>
                    setNewIssue((prev) => ({ ...prev, body: e.target.value }))
                  }
                  placeholder="Describe the issue in detail..."
                  rows={6}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateIssue}
                disabled={!newIssue.title.trim() || createMutation.isPending}
              >
                {createMutation.isPending ? 'Creating...' : 'Create Issue'}
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
          Open ({openIssuesCount})
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            filter === 'closed'
              ? 'border-[var(--accent)] text-[var(--accent)]'
              : 'border-transparent text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]'
          }`}
          onClick={() => setFilter('closed')}
        >
          Closed ({closedIssuesCount})
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            filter === 'all'
              ? 'border-[var(--accent)] text-[var(--accent)]'
              : 'border-transparent text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]'
          }`}
          onClick={() => setFilter('all')}
        >
          All ({(issues?.length || 0)})
        </button>
      </div>

      {/* Issues List */}
      {isLoading ? (
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <Card key={i} className="p-4 animate-pulse">
              <div className="h-6 bg-[var(--card-bg)] rounded w-3/4 mb-2" />
              <div className="h-4 bg-[var(--card-bg)] rounded w-1/2" />
            </Card>
          ))}
        </div>
      ) : issues?.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-[var(--sea-ink-soft)] mb-4">
            No {filter !== 'all' ? filter : ''} issues found
          </p>
          <Button onClick={() => setIsCreateOpen(true)}>Create First Issue</Button>
        </Card>
      ) : (
        <div className="space-y-2">
          {issues?.map((issue) => (
            <Card
              key={issue.id}
              className="p-4 hover:border-[var(--accent)] transition-colors cursor-pointer"
              onClick={() =>
                navigate({
                  to: '/repo/$owner/$name/issues/$id',
                  params: { owner, name, id: issue.id.toString() },
                })
              }
            >
              <div className="flex items-start gap-4">
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-medium text-[var(--sea-ink)] hover:text-[var(--accent)]">
                      {issue.title}
                    </h3>
                    <Badge
                      variant={issue.status === 'open' ? 'success' : 'default'}
                    >
                      {issue.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-[var(--sea-ink-soft)]">
                    #{issue.id} opened{' '}
                    {formatDistanceToNow(new Date(issue.createdAt), {
                      addSuffix: true,
                    })}{' '}
                    by {issue.author?.name || 'Unknown'}
                  </p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
