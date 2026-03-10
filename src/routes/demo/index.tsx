import { createFileRoute, Link } from '@tanstack/react-router'
import { authClient } from '#/lib/auth-client'

export const Route = createFileRoute('/demo/')({
  component: DemoIndex,
})

const demos = [
  {
    title: '🎯 Full Stack Integration',
    description:
      'Complete example using Auth, Drizzle, Query, Form, and Store together',
    path: '/demo/integrated',
    features: ['All packages', 'Authentication required', 'Real-world example'],
    icon: '✨',
    featured: true,
  },
  {
    title: 'Better Auth',
    description:
      'Authentication with email/password, integrated with Drizzle database',
    path: '/demo/better-auth',
    features: ['Email/Password Auth', 'Session Management', 'Database-backed'],
    icon: '🔐',
  },
  {
    title: 'Drizzle ORM',
    description: 'Type-safe SQL queries with Drizzle and Neon serverless',
    path: '/demo/drizzle',
    features: ['Type-safe queries', 'PostgreSQL', 'Server functions'],
    icon: '🗄️',
  },
  {
    title: 'TanStack Query',
    description: 'Async state management with automatic caching and refetching',
    path: '/demo/tanstack-query',
    features: ['Data fetching', 'Caching', 'Optimistic updates'],
    icon: '🔄',
  },
  {
    title: 'TanStack Store',
    description: 'Reactive state management with fine-grained reactivity',
    path: '/demo/store',
    features: ['Global state', 'Reactive updates', 'Devtools'],
    icon: '📦',
  },
  {
    title: 'TanStack Form',
    description: 'Type-safe forms with validation and async handling',
    path: '/demo/form.simple',
    features: ['Form validation', 'Type safety', 'Field-level errors'],
    icon: '📝',
  },
  {
    title: 'Form with Address',
    description: 'Complex nested form with dynamic fields',
    path: '/demo/form.address',
    features: ['Nested forms', 'Dynamic fields', 'Complex validation'],
    icon: '🏠',
  },
  {
    title: 'TanStack DB Chat',
    description: 'Real-time chat with TanStack DB collections and streaming',
    path: '/demo/db-chat',
    features: ['Real-time updates', 'Collections', 'Streaming API'],
    icon: '💬',
  },
  {
    title: 'Neon Database',
    description: 'Direct Neon serverless database integration',
    path: '/demo/neon',
    features: ['Serverless', 'Instant provisioning', 'Auto-scaling'],
    icon: '⚡',
  },
]

function DemoIndex() {
  const { data: session, isPending } = authClient.useSession()

  return (
    <main className="page-wrap px-4 pb-8 pt-14">
      <section className="island-shell rise-in relative overflow-hidden rounded-[2rem] px-6 py-10 sm:px-10 sm:py-14">
        <div className="pointer-events-none absolute -left-20 -top-24 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(79,184,178,0.32),transparent_66%)]" />
        <div className="pointer-events-none absolute -bottom-20 -right-20 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(47,106,74,0.18),transparent_66%)]" />

        <div className="flex items-start justify-between mb-6">
          <div>
            <p className="island-kicker mb-3">Demo Examples</p>
            <h1 className="display-title mb-5 max-w-3xl text-4xl leading-[1.02] font-bold tracking-tight text-[var(--sea-ink)] sm:text-5xl">
              Integrated Stack Demos
            </h1>
            <p className="mb-8 max-w-2xl text-base text-[var(--sea-ink-soft)] sm:text-lg">
              Explore how all packages work together: Better Auth, Drizzle ORM,
              TanStack Query, Form, Store, DB, and more.
            </p>
          </div>

          {!isPending && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-white/50 border border-[rgba(23,58,64,0.1)]">
              {session?.user ? (
                <>
                  <div className="h-8 w-8 rounded-full bg-[rgba(79,184,178,0.2)] flex items-center justify-center">
                    <span className="text-sm font-semibold text-[var(--lagoon-deep)]">
                      {session.user.name?.charAt(0).toUpperCase() || 'U'}
                    </span>
                  </div>
                  <div className="text-left">
                    <p className="text-xs font-semibold text-[var(--sea-ink)]">
                      {session.user.name}
                    </p>
                    <p className="text-xs text-[var(--sea-ink-soft)]">
                      Signed in
                    </p>
                  </div>
                </>
              ) : (
                <Link
                  to="/demo/better-auth"
                  className="text-sm font-semibold text-[var(--lagoon-deep)] hover:text-[var(--sea-ink)]"
                >
                  Sign in →
                </Link>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Featured Demo */}
      {demos.filter((d) => d.featured).map((demo) => (
        <section key={demo.path} className="mt-8">
          <Link
            to={demo.path}
            className="island-shell rise-in group rounded-2xl p-8 transition-all hover:scale-[1.01] hover:shadow-2xl no-underline block bg-gradient-to-br from-[var(--chip-bg)] to-white dark:from-slate-900 dark:to-slate-800 border-2 border-[var(--lagoon-deep)]"
          >
            <div className="flex items-center gap-2 mb-4">
              <div className="text-4xl">{demo.icon}</div>
              <span className="px-3 py-1 rounded-full bg-[rgba(79,184,178,0.2)] text-xs font-bold text-[var(--lagoon-deep)] uppercase tracking-wide">
                Featured
              </span>
            </div>
            <h2 className="text-2xl font-bold text-[var(--sea-ink)] mb-3 group-hover:text-[var(--lagoon-deep)] transition-colors">
              {demo.title}
            </h2>
            <p className="text-base text-[var(--sea-ink-soft)] leading-relaxed mb-4">
              {demo.description}
            </p>
            <div className="flex flex-wrap gap-2">
              {demo.features.map((feature) => (
                <span
                  key={feature}
                  className="px-3 py-1.5 rounded-lg bg-[rgba(79,184,178,0.15)] text-sm font-medium text-[var(--lagoon-deep)]"
                >
                  {feature}
                </span>
              ))}
            </div>
          </Link>
        </section>
      ))}

      <section className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {demos
          .filter((d) => !d.featured)
          .map((demo, index) => (
            <Link
              key={demo.path}
              to={demo.path}
              className="island-shell rise-in group rounded-2xl p-6 transition-all hover:scale-[1.02] hover:shadow-lg no-underline"
              style={{ animationDelay: `${index * 60}ms` }}
            >
              <div className="flex items-start gap-4 mb-4">
                <div className="text-3xl">{demo.icon}</div>
                <div className="flex-1">
                  <h2 className="text-lg font-semibold text-[var(--sea-ink)] mb-2 group-hover:text-[var(--lagoon-deep)] transition-colors">
                    {demo.title}
                  </h2>
                  <p className="text-sm text-[var(--sea-ink-soft)] leading-relaxed">
                    {demo.description}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {demo.features.map((feature) => (
                  <span
                    key={feature}
                    className="px-2 py-1 rounded-md bg-[rgba(79,184,178,0.1)] text-xs font-medium text-[var(--lagoon-deep)]"
                  >
                    {feature}
                  </span>
                ))}
              </div>
            </Link>
          ))}
      </section>

      <section className="island-shell mt-8 rounded-2xl p-6">
        <h2 className="island-kicker mb-4">Package Integration</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <h3 className="text-sm font-semibold text-[var(--sea-ink)] mb-2">
              Authentication
            </h3>
            <p className="text-xs text-[var(--sea-ink-soft)]">
              Better Auth integrated with Drizzle adapter for persistent
              sessions stored in Neon PostgreSQL
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--sea-ink)] mb-2">
              Database
            </h3>
            <p className="text-xs text-[var(--sea-ink-soft)]">
              Drizzle ORM with Neon serverless driver for edge-ready database
              queries
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--sea-ink)] mb-2">
              Data Fetching
            </h3>
            <p className="text-xs text-[var(--sea-ink-soft)]">
              TanStack Query integrated with TanStack Router for SSR-aware
              data loading
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--sea-ink)] mb-2">
              State Management
            </h3>
            <p className="text-xs text-[var(--sea-ink-soft)]">
              TanStack Store for reactive global state with devtools integration
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--sea-ink)] mb-2">
              Forms
            </h3>
            <p className="text-xs text-[var(--sea-ink-soft)]">
              TanStack Form with Zod validation for type-safe form handling
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--sea-ink)] mb-2">
              Real-time
            </h3>
            <p className="text-xs text-[var(--sea-ink-soft)]">
              TanStack DB collections for real-time updates via streaming APIs
            </p>
          </div>
        </div>
      </section>

      <section className="mt-6 text-center">
        <Link
          to="/"
          className="inline-block rounded-full border border-[rgba(23,58,64,0.2)] bg-white/50 px-5 py-2.5 text-sm font-semibold text-[var(--sea-ink)] no-underline transition hover:-translate-y-0.5 hover:border-[rgba(23,58,64,0.35)]"
        >
          ← Back to Home
        </Link>
      </section>
    </main>
  )
}
