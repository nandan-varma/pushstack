import { createFileRoute } from '@tanstack/react-router'
import { listFiles, getBranches } from '@/server/files'
import { getRepositoryByName } from '@/server/repositories'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/repo/$owner/$name/')({
  component: RepositoryIndexPage,
})

function RepositoryIndexPage() {
  const { owner, name } = Route.useParams()
  const [selectedBranch, setSelectedBranch] = useState('main')
  
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

  if (!repo) {
    return <div>Loading...</div>
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
            {branches?.map((branch) => (
              <option key={branch.id} value={branch.name}>
                {branch.name} {branch.isDefault && '(default)'}
              </option>
            ))}
          </select>
          <span className="text-sm text-[var(--sea-ink-soft)]">
            {files?.length || 0} files
          </span>
        </div>
        
        <Link to={`/repo/${owner}/${name}/upload`}>
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
              {files.map((file) => (
                <tr key={file.id} className="border-b border-[var(--line)] last:border-b-0">
                  <td className="p-4">
                    <Link
                      to={`/repo/${owner}/${name}/blob/${selectedBranch}/${file.path}`}
                      className="font-medium text-[var(--lagoon-deep)] hover:underline"
                    >
                      {file.path}
                    </Link>
                  </td>
                  <td className="p-4 text-sm text-[var(--sea-ink-soft)]">
                    {file.lastCommit?.message || 'No commit message'}
                  </td>
                  <td className="p-4 text-sm text-[var(--sea-ink-soft)]">
                    {file.lastCommit && new Date(file.lastCommit.createdAt).toLocaleDateString()}
                  </td>
                  <td className="p-4 text-right text-sm text-[var(--sea-ink-soft)]">
                    {(file.size / 1024).toFixed(2)} KB
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
          <Link to={`/repo/${owner}/${name}/upload`}>
            <Button className="mt-4">+ Add file</Button>
          </Link>
        </div>
      )}
    </div>
  )
}
