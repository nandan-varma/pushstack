# PushStack

PushStack is a code-hosting platform: git repository hosting over the smart HTTP
protocol (so `git clone`/`fetch`/`push` work with a normal client), plus issue
tracking, pull requests, and a code and diff browser.

It runs on serverless functions with no native `git` binary and no local disk.
Every git object lives in Cloudflare R2, everything else in Postgres, which is
what makes horizontal scaling possible: no repository data sits on any one
machine. The live instance is [git.nandan.fyi](https://git.nandan.fyi).

## What it does

- **Git hosting** — the full smart HTTP protocol, implemented in-process with
  isomorphic-git rather than shelling out to a binary. Clone, fetch, push,
  branches, tags, merges and repacks all work against object storage.
- **Repositories** — public or private, with collaborators at `read`, `write` or
  `admin`, and a web UI for uploading, deleting, branching and browsing files.
- **Issues and pull requests** — one shared `#N` sequence per repository,
  comments, closing keywords (`Closes #4`), and merges that are fast-forward or
  a real three-way merge.
- **Reading code** — file tree, per-file history, commit history, diffs, syntax
  highlighting, media previews, and submodules as pinned pointers.
- **Access control** — one `RepositoryAccess` computation for every read, write
  and moderation check, used by the web UI and the git endpoint alike.
- **Auth** — Better Auth sessions for the browser; personal access tokens
  (scoped, revocable, hashed at rest) for git over HTTPS.

## Run it locally

### Prerequisites

- **Node 24** — what CI runs.
- **pnpm 9** — pinned in `packageManager`; use `corepack enable` or install it
  directly, so you get the same version the lockfile was written for.
- **Postgres** — a local one, or a [Neon](https://neon.tech) branch. Nothing
  connects until a query runs, but the app refuses to start without a URL.

### Set up

```bash
pnpm install
cp .env.example .env.local
pnpm dlx @better-auth/cli secret     # generate BETTER_AUTH_SECRET
# fill in DATABASE_URL, BETTER_AUTH_SECRET and BETTER_AUTH_URL in .env.local
pnpm db:push                         # create the schema
pnpm dev                             # http://localhost:3000
```

`.env.example` lists every variable. `DATABASE_URL`, `BETTER_AUTH_SECRET` and
`BETTER_AUTH_URL` are the ones you must set; email (Resend) and Sentry are
optional, and the app runs without them.

**R2 is optional locally.** Without the four `R2_*` variables, git data is kept
in memory for the life of the dev server, so repositories vanish when it
restarts — fine for trying things out. With `NODE_ENV=production` the app
refuses to start that way rather than silently losing pushes. Point `R2_ENDPOINT`
at any S3-compatible endpoint (R2, MinIO, localstack) to keep repositories
between restarts.

See [deployment.md](./docs/deployment.md) for the full environment reference and
the Vercel-specific details.

## Commands

```bash
pnpm dev              # development server on :3000
pnpm build            # production build
pnpm preview          # preview the production build
pnpm typecheck        # tsc --noEmit
pnpm test             # unit and behavior tests (Vitest)
pnpm test:watch       # Vitest in watch mode
pnpm test:coverage    # Vitest with coverage
pnpm test:e2e         # end-to-end tests (Playwright)
pnpm smoke:git        # the real git CLI against a live dev server
pnpm check            # Biome lint + format check
pnpm lint             # Biome lint only
pnpm format           # Biome format (writes)
pnpm db:push          # apply the schema to the database (the only migration path)
pnpm db:studio        # Drizzle Studio
```

Run one test file with `pnpm test src/server/__tests__/repo-access.test.ts`.

## Testing

Unit and behavior tests live beside the code they cover, mostly in
`src/server/__tests__/`. They run the real server functions against an in-memory
Postgres (pglite, with the real schema) and the same git storage stack
production uses, faking only the session — so a test failure means the code is
wrong, not that a mock drifted.

End-to-end tests live in `e2e/` (Playwright) and drive a real dev server;
`pnpm smoke:git` drives the real `git` binary against it. Both need a dev
database and refuse to run against a remote one unless you ask them to. See
[testing.md](./docs/testing.md).

## Deploying

```bash
pnpm build
```

The target is Vercel via Nitro's `vercel` preset (see `vite.config.ts`) — not
Cloudflare, which is used only for R2 object storage. Deploying the build output
is handled by the Vercel integration. Schema changes reach the database only
through `pnpm db:push`, and a deploy that adds a table needs that run against
the target database first.

## Tech stack

| Concern | Choice |
| --- | --- |
| Framework | TanStack Start (file-based SSR router, server functions) |
| Database | Postgres (Neon serverless) via Drizzle |
| Auth | Better Auth |
| Git | isomorphic-git, with the R2-backed storage layer extracted into `git-fs-s3` and the object-level merge into `git-edge` |
| Object storage | Cloudflare R2 |
| Email | Resend |
| UI | React 19, Tailwind CSS, shadcn/ui |
| Testing | Vitest, Playwright |
| Lint / format | Biome |

## Documentation

- **[docs/README.md](./docs/README.md)** — the map: what to read for
  understanding the system, what to read before changing it.
- **[Using PushStack](./docs/using-pushstack.md)** — for people using the hosted
  app: accounts, repositories, cloning, tokens, issues and pull requests, roles
  and limits.
- **[Architecture](./docs/architecture.md)** — start here for the codebase.
- **[Security](./docs/security.md)** and
  **[security history](./docs/security-history.md)** — the rules that must hold,
  and how they were arrived at.

`CLAUDE.md` is a terser, task-oriented reference (commands, constraints, gotchas)
aimed at coding agents working in this repository.
