import { createFileRoute, Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import DiffViewer from '@/components/DiffViewer'
import { formatDistanceToNow, format } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { getCommit } from '@/server/files'

export const Route = createFileRoute('/repo/$owner/$name/commit/$sha')({
  component: CommitDetailPage,
})

function CommitDetailPage() {
  const { owner, name, sha } = Route.useParams()

  const { data: commit, isLoading } = useQuery({
    queryKey: ['commit', sha],
    queryFn: () => getCommit({ data: { sha } }),
  })

  // Diff viewer is complex, skip for now
  const diff = []

  const getInitials = (name: string) =>
    name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)

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

  if (!commit) {
    return (
      <div className="container py-8">
        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-2">Commit Not Found</h2>
          <p className="text-[var(--sea-ink-soft)] mb-4">
            The commit with SHA "{sha}" does not exist.
          </p>
          <Link
            to="/repo/$owner/$name/commits"
            params={{ owner, name }}
            className="inline-block"
          >
            <Button variant="outline">Back to Commits</Button>
          </Link>
        </Card>
      </div>
    )
  }

  return (
    <div className="container py-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h1 className="text-3xl font-bold text-[var(--sea-ink)] mb-2">
            {commit.message}
          </h1>
          <div className="flex items-center gap-3 text-[var(--sea-ink-soft)]">
            <code className="px-2 py-1 rounded bg-[var(--chip-bg)] text-[var(--sea-ink)] border border-[var(--chip-line)] text-sm font-mono">
              {commit.sha}
            </code>
          </div>
        </div>
        <Link
          to="/repo/$owner/$name/commits"
          params={{ owner, name }}
          search={{ branch: commit.branch }}
        >
          <Button variant="outline" size="sm">
            Back to Commits
          </Button>
        </Link>
      </div>

      {/* Commit Info */}
      <Card className="p-6">
        <div className="flex items-start gap-4">
          <Avatar className="h-12 w-12">
            <AvatarImage src={commit.author?.image || undefined} />
            <AvatarFallback>
              {getInitials(commit.author?.name || commit.authorName || 'U')}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span className="font-medium text-[var(--sea-ink)]">
                {commit.author?.name || commit.authorName || 'Unknown'}
              </span>
              <span className="text-sm text-[var(--sea-ink-soft)]">
                committed{' '}
                {formatDistanceToNow(new Date(commit.createdAt), {
                  addSuffix: true,
                })}
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mt-4">
              <div>
                <p className="text-[var(--sea-ink-soft)]">Branch</p>
                <p className="font-medium text-[var(--sea-ink)]">
                  {commit.branch}
                </p>
              </div>
              <div>
                <p className="text-[var(--sea-ink-soft)]">Commit SHA</p>
                <code className="text-xs font-mono text-[var(--sea-ink)]">
                  {commit.sha.substring(0, 7)}
                </code>
              </div>
              <div>
                <p className="text-[var(--sea-ink-soft)]">Timestamp</p>
                <p className="font-medium text-[var(--sea-ink)]">
                  {format(new Date(commit.createdAt), 'PPp')}
                </p>
              </div>
              <div>
                <p className="text-[var(--sea-ink-soft)]">Changes</p>
                <p className="font-medium text-[var(--sea-ink)]">
                  {diff?.length || 0} file{diff?.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Commit Message */}
      {commit.message && (
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-[var(--sea-ink)] mb-3">
            Commit Message
          </h2>
          <pre className="whitespace-pre-wrap text-sm text-[var(--sea-ink)] font-mono bg-[var(--chip-bg)] p-4 rounded border border-[var(--chip-line)]">
            {commit.message}
          </pre>
        </Card>
      )}

      {/* File Changes */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-[var(--sea-ink)]">
          File Changes {diff && `(${diff.length})`}
        </h2>
        {diff && diff.length > 0 ? (
          diff.map((fileDiff, index) => (
            <DiffViewer
              key={index}
              oldValue={fileDiff.oldContent || ''}
              newValue={fileDiff.newContent || ''}
              oldTitle="Before"
              newTitle="After"
              fileName={fileDiff.path}
              language={fileDiff.language}
            />
          ))
        ) : (
          <Card className="p-12 text-center">
            <p className="text-[var(--sea-ink-soft)]">
              No file changes to display
            </p>
          </Card>
        )}
      </div>
    </div>
  )
}
