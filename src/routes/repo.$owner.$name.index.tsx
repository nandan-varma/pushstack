import { createFileRoute, Link } from '@tanstack/react-router'
import { listFiles, getBranches } from '@/server/files'
import { getRepositoryByName } from '@/server/repositories'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { getCloneUrl, getSetupInstructions } from '@/lib/git-utils'

export const Route = createFileRoute('/repo/$owner/$name/')({
  component: RepositoryIndexPage,
})

function RepositoryIndexPage() {
  const { owner, name } = Route.useParams()
  const [selectedBranch, setSelectedBranch] = useState('main')
  const [copiedSection, setCopiedSection] = useState<string | null>(null)
  
  const { data: repo } = useQuery({
    queryKey: ['repository', owner, name],
    queryFn: () => getRepositoryByName({ data: { owner, name } }),
  })
  
  const { data: branches } = useQuery({
    queryKey: ['branches', repo?.id],
    queryFn: () => getBranches({ data: { repoId: repo!.id } }),
    enabled: !!repo,
  })
  
  const { data: files, isLoading } = useQuery({
    queryKey: ['files', repo?.id, selectedBranch],
    queryFn: () => listFiles({ data: { repoId: repo!.id, branchName: selectedBranch } }),
    enabled: !!repo,
  })
  
  const handleCopy = async (text: string, section: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedSection(section)
      setTimeout(() => setCopiedSection(null), 2000)
    } catch (error) {
      console.error('Failed to copy:', error)
    }
  }

  if (!repo) {
    return <div>Loading...</div>
  }
  
  // Check if repository is empty (no branches or no files)
  const isEmpty = !branches || branches.length === 0 || !files || files.length === 0
  
  // If repository is empty, show setup instructions
  if (isEmpty && !isLoading) {
    const cloneUrl = getCloneUrl(owner, name, 'https')
    const instructions = getSetupInstructions(owner, name, cloneUrl)
    
    return (
      <div className="space-y-6">
        {/* Quick Setup Header */}
        <div className="rounded-lg bg-blue-50 border border-blue-200 p-6">
          <h2 className="text-lg font-semibold text-blue-900 mb-2">
            Quick setup — if you've done this kind of thing before
          </h2>
          <p className="text-sm text-blue-700">
            Get started by creating a new file or pushing an existing repository
          </p>
        </div>
        
        {/* Clone URL */}
        <Card className="p-6">
          <label className="text-sm font-medium text-[var(--sea-ink)] mb-2 block">
            HTTPS Clone URL
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={cloneUrl}
              readOnly
              className="flex-1 rounded-md border border-[var(--line)] bg-white px-3 py-2 font-mono text-sm"
            />
            <Button
              onClick={() => handleCopy(cloneUrl, 'url')}
              variant="outline"
              size="sm"
            >
              {copiedSection === 'url' ? '✓' : 'Copy'}
            </Button>
          </div>
          
          {/* Warning */}
          <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 p-4">
            <div className="flex gap-2">
              <span className="text-amber-600">⚠️</span>
              <div className="text-sm text-amber-800">
                <p className="font-medium">Git HTTP protocol not fully implemented</p>
                <p className="mt-1 text-amber-700">
                  Use the web UI to upload files for now.
                </p>
              </div>
            </div>
          </div>
        </Card>
        
        {/* Command Line Instructions */}
        <div>
          <h3 className="text-base font-semibold text-[var(--sea-ink)] mb-3">
            …or create a new repository on the command line
          </h3>
          <Card className="p-4">
            <div className="flex items-start justify-between gap-4">
              <pre className="flex-1 overflow-x-auto text-xs text-[var(--sea-ink)]">
                <code>{instructions.newRepo}</code>
              </pre>
              <Button
                onClick={() => handleCopy(instructions.newRepo, 'new')}
                variant="outline"
                size="sm"
              >
                {copiedSection === 'new' ? '✓' : 'Copy'}
              </Button>
            </div>
          </Card>
        </div>
        
        <div>
          <h3 className="text-base font-semibold text-[var(--sea-ink)] mb-3">
            …or push an existing repository from the command line
          </h3>
          <Card className="p-4">
            <div className="flex items-start justify-between gap-4">
              <pre className="flex-1 overflow-x-auto text-xs text-[var(--sea-ink)]">
                <code>{instructions.existingRepo}</code>
              </pre>
              <Button
                onClick={() => handleCopy(instructions.existingRepo, 'existing')}
                variant="outline"
                size="sm"
              >
                {copiedSection === 'existing' ? '✓' : 'Copy'}
              </Button>
            </div>
          </Card>
        </div>
        
        <div>
          <h3 className="text-base font-semibold text-[var(--sea-ink)] mb-3">
            …or use the web interface
          </h3>
          <Card className="p-6">
            <p className="text-sm text-[var(--sea-ink-soft)] mb-4">
              You can create files directly in the web interface
            </p>
            <Link to="/repo/$owner/$name/upload" params={{ owner, name }}>
              <Button>+ Create new file</Button>
            </Link>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Branch Selector */}
      <div className="flex items-center justify-between rounded-lg border border-[var(--line)] bg-[var(--card-bg)] p-4">
        <div className="flex items-center gap-4">
          <select
            value={selectedBranch}
            onChange={(e) => setSelectedBranch(e.target.value)}
            className="rounded-md border border-[var(--line)] bg-white px-3 py-1.5 text-sm"
          >
            {branches?.map((branch, idx) => (
              <option key={idx} value={branch.name}>
                {branch.name} {branch.isDefault && '(default)'}
              </option>
            ))}
          </select>
          <span className="text-sm text-[var(--sea-ink-soft)]">
            {files?.length || 0} files
          </span>
        </div>
        
        <Link to="/repo/$owner/$name/upload" params={{ owner, name }} replace>
          <Button size="sm">+ Add file</Button>
        </Link>
      </div>

      {/* File Browser */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="h-12 animate-pulse rounded-lg border border-[var(--line)] bg-[var(--card-bg)]"
            />
          ))}
        </div>
      ) : files && files.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--card-bg)]">
          <table className="w-full">
            <tbody>
              {files.map((file, idx) => (
                <tr key={idx} className="border-b border-[var(--line)] last:border-b-0">
                  <td className="p-4">
                    <a
                      href={`/repo/${owner}/${name}/blob/${selectedBranch}/${file.path}`}
                      className="font-medium text-[var(--lagoon-deep)] hover:underline"
                    >
                      {file.type === 'tree' ? `📁 ${file.path}` : file.path}
                    </a>
                  </td>
                  <td className="p-4 text-sm text-[var(--sea-ink-soft)]">
                    {file.type}
                  </td>
                  <td className="p-4 text-sm text-[var(--sea-ink-soft)]">
                    {file.oid.substring(0, 7)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--line)] bg-[var(--card-bg)] p-12 text-center">
          <p className="text-[var(--sea-ink-soft)]">
            This repository is empty. Add your first file to get started!
          </p>
          <Link to="/repo/$owner/$name/upload" params={{ owner, name }}>
            <Button className="mt-4">+ Add file</Button>
          </Link>
        </div>
      )}
    </div>
  )
}
