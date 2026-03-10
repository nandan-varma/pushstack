import { createFileRoute, Link } from '@tanstack/react-router'
import { Button } from '../components/ui/button'

export const Route = createFileRoute('/')({ component: App })

function App() {
  return (
    <main className="page-wrap px-4 pb-8 pt-14">
      <section className="island-shell rise-in relative overflow-hidden rounded-[2rem] px-6 py-10 sm:px-10 sm:py-14">
        <div className="pointer-events-none absolute -left-20 -top-24 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(79,184,178,0.32),transparent_66%)]" />
        <div className="pointer-events-none absolute -bottom-20 -right-20 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(47,106,74,0.18),transparent_66%)]" />
        <p className="island-kicker mb-3">PushStack - Code Repository Platform</p>
        <h1 className="display-title mb-5 max-w-3xl text-4xl leading-[1.02] font-bold tracking-tight text-[var(--sea-ink)] sm:text-6xl">
          Build, collaborate, and ship together.
        </h1>
        <p className="mb-8 max-w-2xl text-base text-[var(--sea-ink-soft)] sm:text-lg">
          A modern code hosting platform built with TanStack Start. Manage repositories,
          track issues, collaborate with pull requests, and deploy with confidence.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link to="/auth/register">
            <Button size="lg">
              Get Started →
            </Button>
          </Link>
          <Link to="/auth/login">
            <Button variant="outline" size="lg">
              Sign In
            </Button>
          </Link>
          <Link to="/dashboard">
            <Button variant="outline" size="lg">
              Dashboard
            </Button>
          </Link>
        </div>
      </section>

      <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          [
            'Git-Like Repositories',
            'Create public or private repositories with full version control.',
          ],
          [
            'Issue Tracking',
            'Track bugs, features, and tasks with a powerful issue system.',
          ],
          [
            'Pull Requests',
            'Collaborate with team members through code reviews and merges.',
          ],
          [
            'Cloudflare R2 Storage',
            'Secure, scalable file storage powered by Cloudflare R2.',
          ],
        ].map(([title, desc], index) => (
          <article
            key={title}
            className="island-shell feature-card rise-in rounded-2xl p-5"
            style={{ animationDelay: `${index * 90 + 80}ms` }}
          >
            <h2 className="mb-2 text-base font-semibold text-[var(--sea-ink)]">
              {title}
            </h2>
            <p className="m-0 text-sm text-[var(--sea-ink-soft)]">{desc}</p>
          </article>
        ))}
      </section>

      <section className="island-shell mt-8 rounded-2xl p-6">
        <p className="island-kicker mb-2">Features</p>
        <ul className="m-0 list-disc space-y-2 pl-5 text-sm text-[var(--sea-ink-soft)]">
          <li>
            <strong>Branches & Commits:</strong> Full branching support with commit history tracking.
          </li>
          <li>
            <strong>Collaboration:</strong> Add collaborators with different permission levels.
          </li>
          <li>
            <strong>Star & Follow:</strong> Star repositories and track activity across your organization.
          </li>
          <li>
            <strong>Powerful Search:</strong> Find repositories, issues, and code quickly.
          </li>
        </ul>
      </section>
    </main>
  )
}
