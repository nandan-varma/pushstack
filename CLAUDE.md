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

**pnpm install quirk**: `pnpm-workspace.yaml` must have `packages: ['.']` or `pnpm add` / `pnpm install` will fail with "packages field missing or empty". To add a dependency, edit `package.json` directly then run `echo "Y" | pnpm install`.

**After schema changes**: run `pnpm db:push` (dev/fast) or `pnpm db:generate && pnpm db:migrate` (migration files) to apply to Neon.

## Architecture

**Framework**: TanStack Start (file-based SSR router, server functions via `createServerFn`).

**Routing**: `src/routes/` — file-based. API routes live under `src/routes/api/`. The catch-all git route is `src/routes/api/git.$.ts` (handles the full Git HTTP smart protocol).

**Server logic**: `src/server/` — pure server-side modules, imported only inside `createServerFn` or API handlers. Key modules:
- `git-r2-backend.ts` — isomorphic-git `fs` plugin that reads/writes git objects directly to/from Cloudflare R2; used for read-only operations (clone/fetch) without touching local disk
- `git-storage-naming.ts` — canonical R2 key derivation (`repos/{ownerKey}/{repoName}/git/…`); owns all storage key construction — never construct R2 keys manually
- `git-http-iso.ts` — Git smart HTTP protocol handler (upload-pack / receive-pack) using isomorphic-git; no native git binary
- `git-auth.ts` — per-request git auth; fallback chain: Better Auth session → PAT (password starting with `ghp_`) → username/password
- `git-cache.ts` — two-tier in-process LRU cache: raw `Buffer` cache for git objects (`getCache`/`setCache`) and a parsed-object cache (`getCachedObject`/`setCachedObject`) that stores JS values directly to avoid JSON.parse overhead on hot paths
- `git-diff-iso.ts`, `git-merge-iso.ts`, `git-operations-iso.ts` — isomorphic-git wrappers for diffs, merges, history, and tree operations
- `git-repo-storage.ts` — R2↔local sync and per-repo mutex locking (`withRepositoryLock`); wrap all write operations in this lock to prevent concurrent modification
- `git-transaction.ts` — two-phase commit coordinator for atomic SQL + R2 writes; used when a single operation must update both Postgres metadata and R2 objects together

**Storage**: All git data lives in Cloudflare R2. The virtual filesystem root for a repo is `repos/{ownerKey}/{repoName}/git/`. Read operations (clone/fetch) use `git-r2-backend.ts` directly against R2. Write operations (push, file edit) hydrate the repo to local `/tmp` via `ensureRepositoryHydrated`, perform the write, then sync back to R2 via `syncRepositoryToR2`.

**Database**: Neon (serverless Postgres) via `@neondatabase/serverless`. Schema split: `src/db/schema.ts` (Better Auth tables: user, session, account, verification) and `src/db/github-schema.ts` (app tables: repositories, issues, pullRequests, comments, stars, repositoryCollaborators, activities, tokens, gitTransactions). ORM: Drizzle.

**Auth**: Better Auth (`src/lib/auth.ts`), session accessed server-side via `src/lib/auth-session.ts` → `src/server/session.ts`. `getCurrentUser()` throws on unauthenticated requests; `getCurrentUserOptional()` returns null. Git auth (Basic over HTTPS + PATs) in `src/server/git-auth.ts`.

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
GIT_HTTP_MAX_BODY_BYTES=52428800   # optional, default 50MB
GIT_CACHE_MAX_SIZE=1073741824      # optional, default 1GB — controls both Buffer and object caches
GIT_CACHE_TTL=3600                 # optional, default 1 hour (seconds)
```

## Key Constraints

- `vite.config.ts` sets `ssr.target: "node"` — git operations require Node.js APIs (`node:fs`, `node:path`), so the SSR target is not `webworker`.
- isomorphic-git is used for all git operations — no native git binary dependency. The R2 backend (`git-r2-backend.ts`) plugs into its `fs` interface. The only place native `git` CLI is invoked is inside `withRepositoryWorktree` in `git-repo-storage.ts` (worktree clones require a real checkout).
- There is no backwards-compatible legacy storage path handling. `getRepoStorageCoordinates()` returns `{ ownerKey, repoKey }` only — no `legacyOwnerKeys`.
- Biome (not ESLint/Prettier) for lint and format. Config in `biome.json`.
