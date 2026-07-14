# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev           # dev server on :3000
pnpm build         # production build
pnpm typecheck     # tsc --noEmit
pnpm test          # vitest (unit, jsdom)
pnpm test:watch    # vitest watch mode
pnpm test:e2e      # playwright E2E
pnpm test:coverage # vitest with coverage report
pnpm check         # biome lint + format check
pnpm lint          # biome lint only
pnpm format        # biome format (write)
pnpm db:push       # push schema to Neon (no migration files)
pnpm db:generate   # generate drizzle migration files
pnpm db:migrate    # run generated migrations
pnpm db:studio     # drizzle studio UI
pnpm deploy        # build (deployment target is Vercel via the nitro "vercel" preset, not Cloudflare — R2 is used only for storage)
```

Run a single test file: `pnpm test src/server/__tests__/repo-access.test.ts`

**pnpm install quirk**: `pnpm-workspace.yaml` must have `packages: ['.']` or `pnpm add` / `pnpm install` will fail with "packages field missing or empty". To add a dependency, edit `package.json` directly then run `echo "Y" | pnpm install`.

**After schema changes**: run `pnpm db:push` (dev/fast) or `pnpm db:generate && pnpm db:migrate` (migration files) to apply to Neon.

## Architecture

**Framework**: TanStack Start (file-based SSR router, server functions via `createServerFn`).

**Routing**: `src/routes/` — file-based. API routes live under `src/routes/api/`. The catch-all git route is `src/routes/api/git.$.ts` (handles the full Git HTTP smart protocol).

**Server logic**: `src/server/` — pure server-side modules, imported only inside `createServerFn` or API handlers. Key modules:
- `git-r2-backend.ts` — isomorphic-git `fs` plugin that reads/writes git objects directly to/from Cloudflare R2; used for read-only operations (clone/fetch) without touching local disk. `detectLooseObjectsHint()` caches, per repo, whether any loose objects exist at all (one cheap bounded LIST) — most repos are fully packed, so without this every commit walked by `git.log` pays a doomed R2 round trip probing a loose-object path that's guaranteed to 404. Flipped back to "present" the instant `writeFile` actually writes a loose object, so it can never go stale mid-push.
- `git-storage-naming.ts` — canonical R2 key derivation (`repos/{ownerKey}/{repoName}/git/…`); owns all storage key construction — never construct R2 keys manually
- `git-http-iso.ts` — Git smart HTTP protocol handler (upload-pack / receive-pack) using isomorphic-git; no native git binary
- `git-auth.ts` — per-request git auth; fallback chain: Better Auth session → PAT (password starting with `ghp_`) → username/password
- `git-cache.ts` — two-tier in-process LRU cache: raw `Buffer` cache for git objects (`getCache`/`setCache`) and a parsed-object cache (`getCachedObject`/`setCachedObject`) that stores JS values directly to avoid JSON.parse overhead on hot paths
- `git-diff-iso.ts`, `git-merge-iso.ts` — isomorphic-git wrappers for diffs and merges
- `git-tree-ops.ts`, `git-commit-write.ts`, `git-branch-ops.ts`, `git-history-ops.ts` — split by responsibility from a single former `git-operations-iso.ts`: tree read/write primitives, commit writing (`createCommit`/`deleteFile`), branch CRUD, and blob/commit/tree reads + history, respectively. `getRepoOptions(ownerKey, repoName)` (hydrate-if-needed + resolve fs/gitdir options) is the shared entry point these all call, defined in `git-repo-storage.ts`. `getCommitLog()` in `git-history-ops.ts` caches the deepest commit-chain walk seen per resolved head SHA (via `git-cache.ts`'s object cache) and slices/reuses it for shallower or repeated requests — walking the commit chain is inherently sequential (each commit's oid is only known after reading its child) and network-RTT-bound against R2, so don't bypass this cache by calling `git.log` directly.
- `git-last-commit.ts` — `getLastCommitsForTree()` resolves, for each direct child of a directory, the most recent commit that touched it (the tree view's "last commit" column). It walks history in fixed-size batches (`PREFETCH_WINDOW`), prefetching each batch's tree reads in parallel before processing that batch sequentially for correctness (the "which entries are still unresolved" state must advance commit-by-commit) — walking one commit at a time here was previously the single largest contributor to slow repo page loads (measured: ~36s of a ~39s cold load). Preserve the two-phase (parallel prefetch, then sequential resolve) structure when touching this function.
- `git-repo-storage.ts` — R2↔local sync and per-repo mutex locking (`withRepositoryLock`); wrap all write operations in this lock to prevent concurrent modification. `withRepositoryLock` is **not reentrant** — a locked function must never call another locked function for the same repo, or it deadlocks. R2-direct writes should only take the lock inside the `isR2Configured()` branch; the non-R2 path already acquires it internally via `ensureRepositoryHydrated`/`syncRepositoryToR2`.
- `repo-access.ts` — the single place computing `RepositoryAccess`; also exports `getRepoOrThrow(repoId)` / `requireReadAccess(repoId, userId)` / `requireWriteAccess(repoId, userId)` request helpers — use these instead of hand-rolling a repo-fetch-then-check block in a new handler. Note these are broader-than-owner checks (any write collaborator passes `requireWriteAccess`); owner-only actions (delete repo, manage collaborators) still need an explicit `repo.ownerId !== user.id` check on top. If a handler already fetched the repository row via a relation (e.g. `db.query.issues.findFirst({ with: { repository: true } })`), call `getAccessForRepository(repo, userId)` instead of `canReadRepo(repoId, userId)` — the latter re-fetches the repo row from scratch.
- `issues.ts`, `pull-requests.ts`, `comments.ts` — split by resource (formerly one `issues.ts`); each owns its own schema validation, access checks, and activity logging for that resource.
- `git-manager-iso.ts` — foundation layer: bare-repo init/delete, resolves whether a repo lives in R2 or local disk (`isR2Configured()`) and picks the matching `fs` (`git-r2-backend.ts` vs Node's `fs`) accordingly.
- `git-file-history.ts` — per-file commit history (`getFileHistory()`), built on top of `getCommitLog()` (`git-history-ops.ts`) plus `findTreeEntry` (`git-tree-ops.ts`); results are cached via `git-cache.ts`'s object cache.
- `git-errors.ts` — `GitError` and subclasses carrying `statusCode`/`retryable`, used to map internal git-layer failures to HTTP responses in the smart-HTTP handler and server functions.
- `files.ts` — server functions for file/branch/commit operations exposed to routes (create/edit/delete file, branch create/delete), composing `git-commit-write.ts`, `git-branch-ops.ts`, and `git-diff-iso.ts`.
- `repositories.ts` — repo CRUD, stars, and collaborator-facing server functions; delegates access checks to `repo-access.ts` and storage deletion to `git-manager-iso.ts`/`git-repo-storage.ts`.
- `search.ts` — cross-entity search (repos, issues, users) gated per-result by `canReadRepo`.
- `perf-log.ts` — request-scoped timing instrumentation for diagnosing slow page loads. `perfContext(label, fn)` wraps a `createServerFn` handler (AsyncLocalStorage-based, so nested calls don't need the context threaded through every function signature); `perfStep(label, fn)` times an awaited sub-call and nests under the active context; `perfR2(label, fn)` (used inside `r2-operations.ts`) additionally tallies R2 call count/time onto the context, printed in the `perfContext` summary line. `src/lib/perf-log.ts` is the client/SSR-side counterpart (`perfTime`, `perfMark`) used in route loaders and `query-options.ts` queryFns — prefixes logs with `[perf:ssr]` or `[perf:client]` so the same request's client-perceived latency can be compared against the server-side breakdown. Follow this pattern (wrap the handler in `perfContext`, wrap each meaningfully-awaited sub-call in `perfStep`) when adding new server functions on a user-facing read path.

**Storage**: All git data lives in Cloudflare R2. The virtual filesystem root for a repo is `repos/{ownerKey}/{repoName}/git/`. Read operations (clone/fetch) use `git-r2-backend.ts` directly against R2. Write operations (push, file edit) hydrate the repo to local `/tmp` via `ensureRepositoryHydrated`, perform the write, then sync back to R2 via `syncRepositoryToR2`.

**Database**: Neon (serverless Postgres) via `@neondatabase/serverless`. Schema split: `src/db/schema.ts` (Better Auth tables: user, session, account, verification) and `src/db/github-schema.ts` (app tables: repositories, issues, pullRequests, comments, stars, repositoryCollaborators, activities, tokens, gitTransactions). ORM: Drizzle.

**Auth**: Better Auth (`src/lib/auth.ts`), session accessed server-side via `src/lib/auth-session.ts` → `src/server/session.ts`. `getCurrentUser()` throws on unauthenticated requests; `getCurrentUserOptional()` returns null. Git auth (Basic over HTTPS + PATs) in `src/server/git-auth.ts`. Password reset and email verification send through Resend (`src/lib/email.ts`), wired into Better Auth's `sendResetPassword`/`sendVerificationEmail` hooks.

**Client data fetching**: All TanStack Query keys and `queryOptions` factories live in `src/lib/query-options.ts` — always source keys from `queryKeys` there instead of inlining strings.

**Heavy client-only dependencies** (`react-markdown`+`remark-gfm`+`rehype-highlight` in `MarkdownRenderer`, Shiki in `CodeViewer`) are `React.lazy`-loaded at every call site, not just imported directly — these routes (tree/repo-home, blob, issue/PR/comment bodies) are hot paths, and eagerly bundling them adds hundreds of KB to a chunk that most visits don't need. Follow the same `lazy(() => import(...))` + `Suspense` pattern for any new heavy, conditionally-rendered client dependency.

**Access control**: `RepositoryAccess` (role: anonymous/read/write/admin/owner, canRead/canWrite/canModerate flags) is computed exclusively in `repo-access.ts` — see above. Call it server-side before any repo mutation.

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
GIT_REPOS_PATH=/path/to/dir        # optional, default os.tmpdir()/pushstack-repos — local hydration dir for write ops
RESEND_API_KEY=...                 # transactional email (password reset, email verification) — src/lib/email.ts
RESEND_EMAIL_FROM=...              # optional, falls back to a hardcoded address in src/lib/email.ts
```

## Key Constraints

- `vite.config.ts` sets `ssr.target: "node"` — git operations require Node.js APIs (`node:fs`, `node:path`), so the SSR target is not `webworker`.
- isomorphic-git is used for all git operations — no native git binary dependency. The R2 backend (`git-r2-backend.ts`) plugs into its `fs` interface. The only place native `git` CLI is invoked is inside `withRepositoryWorktree` in `git-repo-storage.ts` (worktree clones require a real checkout).
- There is no backwards-compatible legacy storage path handling. `getRepoStorageCoordinates()` returns `{ ownerKey, repoKey }` only — no `legacyOwnerKeys`.
- `nitro` is pinned to an exact beta version (no `^`/`~` range) in `package.json` — deliberate, not a typo; don't loosen it.
- Deployment target is Vercel (`nitro({ preset: "vercel" })` in `vite.config.ts`), not Cloudflare Pages/Workers — `@cloudflare/vite-plugin` is a dependency but not wired into the Vite config. Cloudflare is used only for R2 object storage. `/tmp` is the only writable directory at runtime, which is why `GIT_REPOS_PATH` defaults there.
- Biome (not ESLint/Prettier) for lint and format. Config in `biome.json`.
- Add shadcn components via `pnpm dlx shadcn@latest add <component>` — don't hand-write `src/components/ui/*`.
- The R2 `S3Client` (`src/lib/r2.ts`) is a lazily-created singleton configured with an explicit keep-alive `https.Agent` (`@smithy/node-http-handler`'s `NodeHttpHandler`) — a page load can fire hundreds of R2 object reads, so connection reuse matters. Don't construct a second `S3Client` elsewhere; go through `getR2Client()`.
- Repository names are restricted to `/^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/` (`repositories.ts`'s `repoNameSchema`) — this isn't cosmetic, it's the thing that stops a name of `..` or containing `/` from escaping the storage root via `getRepoPath`'s `path.join`. `getRepoPath` and `sanitizeStorageSegment` (`git-storage-naming.ts`) both re-sanitize/verify containment as defense in depth, but don't loosen the input-side regex on the assumption those alone are enough.
- `MarkdownRenderer`'s link/image renderer is one of the few places rendering fully attacker-controlled content (issue/PR/comment bodies, READMEs) as real `<a href>`/`<img src>` attributes — any change there must keep going through `isSafeHref`/`isSafeImageSrc` (scheme allowlist: relative paths, http(s), mailto; data: images only). Don't reintroduce a raw `<a href={href}>` fallback without that check.
