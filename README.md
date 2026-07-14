# PushStack

A modern code repository platform for hosting, managing, and collaborating on your Git repositories.

## Quick Start

```bash
pnpm install
pnpm dev
```

Visit [http://localhost:3000](http://localhost:3000) to get started.

## Features

- **Git Repository Hosting**: Full Git smart HTTP protocol (clone/fetch/push) with no native git binary — object storage lives in Cloudflare R2
- **Authentication**: Secure user authentication using Better Auth, plus Personal Access Tokens for git-over-HTTPS
- **Issue Tracking**: Track bugs, features, and tasks
- **Pull Requests**: Collaborate on code with pull requests, merges, and review comments
- **Code Viewer**: Browse code with syntax highlighting
- **Diff Viewer**: View changes with side-by-side or unified diff views
- **Database**: PostgreSQL database with Drizzle ORM
- **Storage**: Cloudflare R2 for repository storage

## Environment Setup

1. Copy `.env.example` to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```

2. Generate a Better Auth secret:
   ```bash
   pnpm dlx @better-auth/cli secret
   ```

3. Fill in `.env.local`:
   ```env
   DATABASE_URL=postgresql://...
   BETTER_AUTH_SECRET=your_secret_key
   BETTER_AUTH_URL=http://localhost:3000
   R2_ACCESS_KEY_ID=your_r2_access_key
   R2_SECRET_ACCESS_KEY=your_r2_secret
   R2_BUCKET_NAME=your_bucket_name
   R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
   GIT_REPOS_PATH=/path/to/local/hydration/dir   # optional, defaults to os.tmpdir()/pushstack-repos
   RESEND_API_KEY=your_resend_api_key            # transactional email: password reset, email verification
   RESEND_EMAIL_FROM=you@yourdomain.com          # optional, has a built-in fallback
   ```

4. Push the database schema:
   ```bash
   pnpm db:push
   ```

See `CLAUDE.md` for the full list of environment variables, including optional git-cache and request-size tuning knobs.

## Project Structure

```
src/
├── components/        # Reusable UI components (including shadcn/ui in components/ui)
├── db/                # Drizzle schema (Better Auth tables + app tables) and client
├── hooks/             # Custom React hooks
├── integrations/      # Better Auth client and TanStack Query wiring
├── lib/               # Client + shared utilities (query-options, email, git URL parsing, ...)
├── routes/            # File-based routing (TanStack Start); API routes under routes/api/
└── server/            # Server-only modules — git operations, access control, DB-backed CRUD
```

## Available Commands

```bash
pnpm dev              # Start development server on :3000
pnpm build            # Build for production
pnpm preview          # Preview production build
pnpm typecheck        # tsc --noEmit
pnpm test             # Run unit tests (Vitest)
pnpm test:watch       # Run unit tests in watch mode
pnpm test:coverage    # Run unit tests with coverage
pnpm test:e2e         # Run E2E tests (Playwright)
pnpm check            # Biome lint + format check
pnpm lint             # Biome lint only
pnpm format           # Biome format (write)
pnpm db:generate      # Generate Drizzle migration files
pnpm db:push          # Push schema to the database directly (no migration files)
pnpm db:migrate       # Run generated migrations
pnpm db:studio        # Open Drizzle Studio
```

## Testing

Unit tests (Vitest, jsdom) live alongside their modules in `__tests__/` directories — most coverage is in `src/server/__tests__/`, covering the git protocol implementation, access control, and CRUD server functions. End-to-end tests (Playwright) live in `e2e/`.

Run a single unit test file: `pnpm test src/server/__tests__/repo-access.test.ts`

## Deployment

```bash
pnpm build
```

The deployment target is Vercel, via Nitro's `vercel` preset (see `vite.config.ts`) — not Cloudflare, which is used only for R2 object storage. `pnpm deploy` runs the production build; deploying the build output is handled by the Vercel CLI/integration.

## Tech Stack

- **Framework**: TanStack Start (file-based SSR router, server functions)
- **Database**: PostgreSQL (Neon serverless)
- **ORM**: Drizzle
- **Authentication**: Better Auth
- **Git**: isomorphic-git (no native git binary), Cloudflare R2 for object storage
- **Email**: Resend
- **Styling**: Tailwind CSS
- **UI Components**: shadcn/ui
- **Testing**: Vitest, Playwright
- **Lint/Format**: Biome

## Documentation

The codebase has grown large enough that in-depth docs live under [`docs/`](./docs/README.md):

- [Architecture](./docs/architecture.md) — tech stack, request flow, directory map, storage systems
- [Git Storage](./docs/git-storage.md) — the R2-backed git storage layer and smart HTTP protocol
- [Database](./docs/database.md) — schema, indices, migrations
- [Authentication & Access Control](./docs/authentication.md) — Better Auth, PATs, the `RepositoryAccess` model
- [Server Functions](./docs/server-functions.md) — `src/server/` modules by resource
- [Performance](./docs/performance.md) — caching layers and the `perf-log` instrumentation convention
- [Security](./docs/security.md) — the security model and fixed vulnerabilities' reasoning
- [Testing](./docs/testing.md) — unit/e2e test layout and conventions
- [Deployment](./docs/deployment.md) — Vercel/Nitro specifics and the full environment variable reference

See `CLAUDE.md` for a terser, task-oriented reference (commands, key constraints, gotchas) aimed at AI coding agents working in this codebase.
