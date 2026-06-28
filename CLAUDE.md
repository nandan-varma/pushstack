# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev           # dev server on :3000
pnpm build         # production build
pnpm test          # vitest (unit, jsdom)
pnpm test:watch    # vitest watch mode
pnpm test:e2e      # playwright E2E
pnpm check         # biome lint + format check
pnpm lint          # biome lint only
pnpm format        # biome format (write)
pnpm db:push       # push schema to Neon (no migration files)
pnpm db:generate   # generate drizzle migration files
pnpm db:migrate    # run generated migrations
pnpm db:studio     # drizzle studio UI
pnpm deploy        # build + wrangler deploy to Cloudflare
```

Run a single test file: `pnpm test src/server/__tests__/git-auth.test.ts`

## Architecture

**Framework**: TanStack Start (file-based SSR router, server functions via `createServerFn`).

**Routing**: `src/routes/` — file-based. API routes live under `src/routes/api/`. The catch-all git route is `src/routes/api/git.$.ts` (handles the full Git HTTP smart protocol).

**Server logic**: `src/server/` — pure server-side modules, imported only inside `createServerFn` or API handlers. Key modules:
- `git-r2-backend.ts` — isomorphic-git fs plugin that reads/writes git objects to Cloudflare R2 instead of local disk
- `git-storage-naming.ts` — canonical R2 key derivation (`repos/{ownerKey}/{repoName}/git/…`) and legacy key migration
- `git-http-backend.ts` / `git-http-iso.ts` — Git smart HTTP protocol handler (upload-pack / receive-pack)
- `git-transaction.ts` — atomic multi-object R2 writes with ETag-based optimistic locking
- `git-auth.ts` — per-request git auth (Basic over HTTPS, ties into Better Auth sessions)
- `git-diff-iso.ts`, `git-merge-iso.ts`, `git-operations-iso.ts` — isomorphic-git wrappers for diffs, merges, history

**Storage**: All git data lives in Cloudflare R2. The virtual filesystem root for a repo is `repos/{ownerKey}/{repoName}/git/`. `git-cache.ts` provides an in-process LRU cache in front of R2 reads.

**Database**: Neon (serverless Postgres) via `@neondatabase/serverless`. Schema split: `src/db/schema.ts` (Better Auth tables: user, session, account, verification) and `src/db/github-schema.ts` (app tables: repositories, issues, pullRequests, comments, stars, repositoryCollaborators, activities, tokens, gitTransactions). ORM: Drizzle.

**Auth**: Better Auth (`src/lib/auth.ts`), session accessed server-side via `src/server/session.ts`. Route-level auth guard in `src/lib/route-auth.ts`. Git auth (Basic over HTTPS + PATs) in `src/server/git-auth.ts`.

**Client data fetching**: All TanStack Query keys and `queryOptions` factories live in `src/lib/query-options.ts` — always source keys from `queryKeys` there instead of inlining strings.

**Access control**: `src/server/repo-access.ts` is the single place for computing `RepositoryAccess` (role: anonymous/read/write/admin/owner, canRead/canWrite/canModerate flags). Call it server-side before any repo mutation.

**Path aliases**: `#/*` and `@/*` both resolve to `src/*`.

## Environment Variables

```
DATABASE_URL=postgresql://...
BETTER_AUTH_SECRET=...
BETTER_AUTH_URL=http://localhost:3000
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=...
R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
```

## Key Constraints

- `vite.config.ts` sets `ssr.target: "node"` — git operations require Node.js APIs (`node:fs`, `node:path`), so the SSR target is not `webworker`.
- isomorphic-git is used for all git operations (no native git binary dependency). The R2 backend plugs into its `fs` interface.
- `git-storage-naming.ts` owns the canonical storage key format; always use it — never construct R2 keys manually.
- Biome (not ESLint/Prettier) for lint and format. Config in `biome.json`.
