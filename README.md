# PushStack

PushStack is a code-hosting platform: git repository hosting over the smart HTTP
protocol (so `git clone`/`fetch`/`push` work with a normal client), plus issue
tracking, pull requests, and a code and diff browser.

It runs on serverless functions with no native `git` binary and no local disk.
Every git object lives in Cloudflare R2, everything else in Postgres, which is
what makes horizontal scaling possible: no repository data sits on any one
machine. The live instance is [git.nandan.fyi](https://git.nandan.fyi).

## Repository layout

- `apps/web` — the hosted product, REST API and git smart HTTP server.
- `apps/docs` — this documentation site, built with Fumadocs and TanStack Start.
- `packages/git-fs-s3` and `packages/git-edge` — published git libraries.

Run workspace commands from the root with pnpm and Turborepo. Preview documentation
with `pnpm --filter @pushstack/docs dev` on port 3001.

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

### Quick start — no accounts needed

```bash
pnpm install
pnpm dev:local                       # http://localhost:3000
```

`dev:local` keeps everything under `apps/web/.pushstack-local/`: an on-disk pglite
database (schema pushed on every start) and the git objects, so repositories
survive restarts. Verification and password-reset emails print their links in
the terminal. It blanks any R2, Resend and Sentry settings from `apps/web/.env.local`,
so it never reaches a real service. Delete `.pushstack-local/` to start over.

To run against real services instead, set up as below.

### Prerequisites

- **Node 24** — what CI runs.
- **pnpm 12** — pinned in `packageManager`; use `corepack enable` or install it
  directly, so you get the same version the lockfile was written for.
- **Postgres** — a local one, or a [Neon](https://neon.tech) branch. Nothing
  connects until a query runs, but the app refuses to start without a URL.

### Set up

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local
pnpm dlx @better-auth/cli secret     # generate BETTER_AUTH_SECRET
# fill in DATABASE_URL, BETTER_AUTH_SECRET and BETTER_AUTH_URL in .env.local
pnpm db:push                         # create the schema
pnpm dev                             # http://localhost:3000
```

`apps/web/.env.example` lists every variable. `DATABASE_URL`, `BETTER_AUTH_SECRET` and
`BETTER_AUTH_URL` are the ones you must set; email (Resend) and Sentry are
optional, and the app runs without them.

**R2 is optional locally.** Without the four `R2_*` variables, git data is kept
in memory for the life of the dev server, so repositories vanish when it
restarts — fine for trying things out. With `NODE_ENV=production` the app
refuses to start that way rather than silently losing pushes. Point `R2_ENDPOINT`
at any S3-compatible endpoint (R2, MinIO, localstack) to keep repositories
between restarts.

See [deployment.md](https://docs.git.nandan.fyi/docs/internals/deployment) for the full environment reference and
the Vercel-specific details.

## Commands

```bash
pnpm dev              # development server on :3000 (uses .env.local)
pnpm dev:local        # same, fully local: pglite + on-disk git, no accounts
pnpm build            # production build
pnpm typecheck        # tsc --noEmit
pnpm test             # unit and behavior tests (Vitest)
pnpm smoke:git        # the real git CLI against a live dev server
pnpm check            # Biome lint + format check
pnpm format           # Biome format (writes)
pnpm db:push          # apply the schema to the database (the only migration path)
pnpm db:studio        # Drizzle Studio
```

Run one web test file with `pnpm --filter @pushstack/web test src/server/__tests__/repo-access.test.ts`.

## Testing

Unit and behavior tests live beside the code they cover, mostly in
`apps/web/src/server/__tests__/`. They run the real server functions against an in-memory
Postgres (pglite, with the real schema) and the same git storage stack
production uses, faking only the session — so a test failure means the code is
wrong, not that a mock drifted.

End-to-end tests live in `apps/web/e2e/` (Playwright) and drive a real dev server;
`pnpm smoke:git` drives the real `git` binary against it. Both need a dev
database and refuse to run against a remote one unless you ask them to. See
[testing.md](https://docs.git.nandan.fyi/docs/internals/testing).

## Deploying

```bash
pnpm build
```

The target is Vercel via Nitro's `vercel` preset (see `apps/web/vite.config.ts`) — not
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

- **[Documentation](https://docs.git.nandan.fyi/docs)** — the map: what to read for
  understanding the system, what to read before changing it.
- **[Using PushStack](https://docs.git.nandan.fyi/docs/guide)** — for people using the hosted
  app: accounts, repositories, cloning, tokens, issues and pull requests, roles
  and limits.
- **[Architecture](https://docs.git.nandan.fyi/docs/internals)** — start here for the codebase.
- **[Security](https://docs.git.nandan.fyi/docs/internals/security)** and
  **[security history](https://docs.git.nandan.fyi/docs/internals/security-history)** — the rules that must hold,
  and how they were arrived at.

`CLAUDE.md` is a terser, task-oriented reference (commands, constraints, gotchas)
aimed at coding agents working in this repository.

## License

Copyright (C) 2026 Nandan Varma.

PushStack is free software: you can redistribute it and/or modify it under the
terms of the GNU Affero General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version.

It is distributed in the hope that it will be useful, but **without any
warranty**; without even the implied warranty of merchantability or fitness for
a particular purpose. See the [GNU Affero General Public License](./LICENSE) for
the full terms.

The Affero GPL is the network-use variant of the GPL: running a modified version
as a network service obliges you (section 13) to offer that service's users the
corresponding source. That is deliberate here — the hosted instance is the
product.
