import { createFileRoute, redirect, Link } from '@tanstack/react-router'
import { auth } from '../lib/auth'
import { getUserRepositories } from '../server/repositories'
import { getUserActivity } from '../server/search'
import { useQuery } from '@tanstack/react-query'
import { Button } from '../components/ui/button'

export const Route = createFileRoute('/dashboard')({
  component: DashboardPage,
  beforeLoad: async () => {
    const session = await auth.api.getSession({
      headers: new Headers(),
    })
    
    if (!session?.user) {
      throw redirect({ to: '/auth/login' })
    }
    
    return { user: session.user }
  },
})

function DashboardPage() {
  const { user } = Route.useRouteContext()
  
  const { data: repositories, isLoading: reposLoading } = useQuery({
    queryKey: ['user-repositories'],
    queryFn: () => getUserRepositories({ data: {} }),
  })
  
  const { data: activities, isLoading: activitiesLoading } = useQuery({
    queryKey: ['user-activity'],
    queryFn: () => getUserActivity({ data: { limit: 20 } }),
  })

  return (
    <div className="page-wrap py-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[var(--sea-ink)]">
            Welcome back, {user.name}!
          </h1>
          <p className="mt-2 text-[var(--sea-ink-soft)]">
            {user.email}
          </p>
        </div>
        <Link to="/repositories/new">
          <Button>+ New Repository</Button>
        </Link>
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Repositories List */}
        <div className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-2xl font-semibold text-[var(--sea-ink)]">
              Your Repositories
            </h2>
            <Link 
              to="/repositories"
              className="text-sm text-[var(--lagoon-deep)] hover:underline"
            >
              View all →
            </Link>
          </div>

          {reposLoading ? (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <div
                  key={i}
                  className="h-32 animate-pulse rounded-xl border border-[var(--line)] bg-[var(--card-bg)]"
                />
              ))}
            </div>
          ) : repositories && repositories.length > 0 ? (
            <div className="space-y-4">
              {repositories.map((repo) => (
                <Link
                  key={repo.id}
                  to={`/repo/${repo.owner?.name || 'user'}/${repo.name}`}
                  className="block rounded-xl border border-[var(--line)] bg-[var(--card-bg)] p-6 transition hover:border-[var(--lagoon-deep)] hover:shadow-lg"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-xl font-semibold text-[var(--lagoon-deep)]">
                        {repo.name}
                      </h3>
                      {repo.description && (
                        <p className="mt-2 text-sm text-[var(--sea-ink-soft)]">
                          {repo.description}
                        </p>
                      )}
                      <div className="mt-3 flex items-center gap-4 text-xs text-[var(--sea-ink-soft)]">
                        <span className="flex items-center gap-1">
                          <span className={`h-3 w-3 rounded-full ${repo.visibility === 'public' ? 'bg-green-500' : 'bg-yellow-500'}`} />
                          {repo.visibility}
                        </span>
                        <span>
                          Updated {new Date(repo.updatedAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-[var(--line)] bg-[var(--card-bg)] p-12 text-center">
              <p className="text-[var(--sea-ink-soft)]">
                You don't have any repositories yet.
              </p>
              <Link to="/repositories/new">
                <Button className="mt-4">Create your first repository</Button>
              </Link>
            </div>
          )}
        </div>

        {/* Activity Feed */}
        <div>
          <h2 className="mb-4 text-xl font-semibold text-[var(--sea-ink)]">
            Recent Activity
          </h2>

          {activitiesLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div
                  key={i}
                  className="h-20 animate-pulse rounded-lg border border-[var(--line)] bg-[var(--card-bg)]"
                />
              ))}
            </div>
          ) : activities && activities.length > 0 ? (
            <div className="space-y-3">
              {activities.map((activity) => (
                <div
                  key={activity.id}
                  className="rounded-lg border border-[var(--line)] bg-[var(--card-bg)] p-4"
                >
                  <div className="text-sm">
                    <span className="font-medium text-[var(--sea-ink)]">
                      {activity.type}
                    </span>
                    {activity.repository && (
                      <span className="ml-1 text-[var(--sea-ink-soft)]">
                        in {activity.repository.name}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-[var(--sea-ink-soft)]">
                    {new Date(activity.createdAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-[var(--line)] bg-[var(--card-bg)] p-6 text-center">
              <p className="text-sm text-[var(--sea-ink-soft)]">
                No recent activity
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
