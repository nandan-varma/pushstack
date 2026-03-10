import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import MarkdownRenderer from '@/components/MarkdownRenderer'
import { formatDistanceToNow } from 'date-fns'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getIssue, updateIssue, createComment, getComments } from '@/server/issues'

export const Route = createFileRoute('/repo/$owner/$name/issues/$id')({
  component: IssueDetailPage,
})

function IssueDetailPage() {
  const { owner, name, id } = Route.useParams()
  const queryClient = useQueryClient()
  const [newComment, setNewComment] = useState('')

  const { data: issue, isLoading } = useQuery({
    queryKey: ['issue', Number(id)],
    queryFn: () => getIssue({ data: { issueId: Number(id) } }),
  })

  const { data: comments } = useQuery({
    queryKey: ['comments', Number(id)],
    queryFn: () => getComments({ data: { issueId: Number(id) } }),
  })

  const updateMutation = useMutation({
    mutationFn: updateIssue,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue', Number(id)] })
    },
  })

  const commentMutation = useMutation({
    mutationFn: createComment,
    onSuccess: () => {
      setNewComment('')
      queryClient.invalidateQueries({ queryKey: ['comments', Number(id)] })
    },
  })

  const handleToggleStatus = () => {
    if (!issue) return
    updateMutation.mutate({
      data: {
        issueId: Number(id),
        status: issue.status === 'open' ? 'closed' : 'open',
      }
    })
  }

  const handleAddComment = () => {
    if (!newComment.trim() || !issue) return
    commentMutation.mutate({
      data: {
        issueId: Number(id),
        body: newComment,
      }
    })
  }

  if (isLoading) {
    return (
      <div className="container py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-[var(--card-bg)] rounded w-1/2" />
          <div className="h-64 bg-[var(--card-bg)] rounded" />
        </div>
      </div>
    )
  }

  if (!issue) {
    return (
      <div className="container py-8">
        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-2">Issue Not Found</h2>
          <Link
            to="/repo/$owner/$name/issues"
            params={{ owner, name }}
            className="mt-4 inline-block"
          >
            <Button variant="outline">Back to Issues</Button>
          </Link>
        </Card>
      </div>
    )
  }

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
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-bold text-[var(--sea-ink)]">
              {issue.title}
            </h1>
            <Badge variant={issue.status === 'open' ? 'success' : 'default'}>
              {issue.status}
            </Badge>
          </div>
          <p className="text-[var(--sea-ink-soft)]">
            #{issue.id} opened{' '}
            {formatDistanceToNow(new Date(issue.createdAt), { addSuffix: true })}{' '}
            by {issue.author?.name || 'Unknown'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/repo/$owner/$name/issues" params={{ owner, name }}>
            <Button variant="outline" size="sm">
              Back
            </Button>
          </Link>
          <Button
            variant={issue.status === 'open' ? 'outline' : 'default'}
            size="sm"
            onClick={handleToggleStatus}
            disabled={updateMutation.isPending}
          >
            {issue.status === 'open' ? 'Close Issue' : 'Reopen Issue'}
          </Button>
        </div>
      </div>

      {/* Issue Body */}
      <Card className="p-6">
        <div className="flex items-start gap-4">
          <Avatar>
            <AvatarImage src={issue.author?.image || undefined} />
            <AvatarFallback>
              {getInitials(issue.author?.name || 'U')}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-4">
              <span className="font-medium text-[var(--sea-ink)]">
                {issue.author?.name || 'Unknown'}
              </span>
              <span className="text-sm text-[var(--sea-ink-soft)]">
                {formatDistanceToNow(new Date(issue.createdAt), {
                  addSuffix: true,
                })}
              </span>
            </div>
            {issue.body ? (
              <MarkdownRenderer content={issue.body} />
            ) : (
              <p className="text-[var(--sea-ink-soft)] italic">
                No description provided
              </p>
            )}
          </div>
        </div>
      </Card>

      {/* Comments */}
      {comments && comments.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-[var(--sea-ink)]">
            Comments ({comments.length})
          </h2>
          {comments.map((comment) => (
            <Card key={comment.id} className="p-6">
              <div className="flex items-start gap-4">
                <Avatar>
                  <AvatarImage src={comment.author?.image || undefined} />
                  <AvatarFallback>
                    {getInitials(comment.author?.name || 'U')}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="font-medium text-[var(--sea-ink)]">
                      {comment.author?.name || 'Unknown'}
                    </span>
                    <span className="text-sm text-[var(--sea-ink-soft)]">
                      {formatDistanceToNow(new Date(comment.createdAt), {
                        addSuffix: true,
                      })}
                    </span>
                  </div>
                  <MarkdownRenderer content={comment.body} />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Add Comment */}
      {issue.status === 'open' && (
        <Card className="p-6">
          <h3 className="text-lg font-semibold text-[var(--sea-ink)] mb-4">
            Add a Comment
          </h3>
          <div className="space-y-4">
            <Textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Write your comment here... (Markdown supported)"
              rows={6}
            />
            <div className="flex justify-end">
              <Button
                onClick={handleAddComment}
                disabled={!newComment.trim() || commentMutation.isPending}
              >
                {commentMutation.isPending ? 'Posting...' : 'Post Comment'}
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
