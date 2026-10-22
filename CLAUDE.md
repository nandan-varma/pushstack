# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Read `CONTEXT.md` (gitignored, local) first: goal, constraints, how work is organized (including the `git-fs-s3`/`git-edge` libraries, which are managed in the same loop) and the self-improvement rule: when a workflow step is slow or fails, fix the process (docs, tests, scripts) right away. The main agent orchestrates; persistent subagents implement in isolated worktrees from GitHub issues and open PRs, and an independent reviewer gates every PR. The main agent implements when explicitly requested or when delegation overhead exceeds the task's effort; its PRs still need independent review. Reuse agents to preserve context, and keep available slots full within the active budget limits, prioritizing blockers and reviews. Use the current runtime's agent tools (Claude Code, Codex or pi) and `helpers limits`; do not assume a particular tool, model, provider or concurrency limit. **The product's goal is GitHub compatibility** — match GitHub's behavior, names and API.

## Layout

A pnpm + Turborepo monorepo:

- `apps/web` — the product: TanStack Start app, `/api/v3` REST API, git smart-HTTP. Deployed to Vercel (project root `apps/web`, build `turbo run build --filter=@pushstack/web`, see `apps/web/vercel.json`). **Every app path in this file (`src/…`, `scripts/…`, `e2e/…`) is relative to `apps/web`.** Its env file is `apps/web/.env.local`.
- `apps/docs` — Fumadocs documentation on TanStack Start, deployed separately to `docs.git.nandan.fyi`. All documentation source lives in `apps/docs/content/docs`; the site test checks internal links, navigation and code examples.
- `apps/cli` — `@pstk/cli`, bins `pushstack` and `pst`; auth, repository and API commands. Its unit tests mock fetch; web contract tests run it through the real REST dispatcher. Published to npm from this repo like the libraries (`@pstk/cli@v*`).
- `packages/tsconfig` — private shared compiler options. Runtime workspaces extend its base or Node config and declare it as a workspace dev dependency. `scripts/workspace.test.mjs` enforces scripts, links, shared versions and dependency policy, plus that every workflow pins each external action to a commit SHA, installs Node from `.node-version`, and installs dependencies through the shared setup action.
- `packages/api-contract` — private `@pushstack/api-contract`, the `/api/v3` contract keyed by GitHub operation id: `routes.ts` (method, path template, docs link; zod-free, exported as `/client`), `endpoints.ts` (path/query/body/response zod schemas), `resources.ts` (strict GitHub resource shapes). The CLI bundles the `/client` entry (`client.call("issues/get", {…})`, `client.pages(…)`); `api-contract.test.ts` in the web app validates real dispatcher responses against it (`KNOWN_DRIFT` lists accepted mismatches). Add an endpoint = a route plus its schemas.
- `packages/git-fs-s3`, `packages/git-edge` — our git libraries (imported with full history; published to npm under those names). The app depends on them as `workspace:*` and imports their built `dist/`; turbo builds them first (`dependsOn: ["^build"]`).
- Root: tooling only — `turbo.json` (task graph; build-time env vars must be listed there, turbo's strict env mode hides the rest), one `biome.json` for every workspace, `.yamllint.yml` (YAML conventions for editors and agents), husky + lint-staged. Workflows share one setup composite action (`.github/actions/setup`) and CI runs actionlint over them.

## Commands

Run from the root; turbo runs the task in every workspace that has it, dependencies first, with caching.

```bash
pnpm dev           # web dev server on :3000 (after building the packages)
pnpm dev:local     # fully local dev server: pglite + on-disk git under apps/web/.pushstack-local/, emails print to the terminal
pnpm build         # all builds; the web app's is the Vercel build (nitro's "vercel" preset)
pnpm typecheck     # tsc --noEmit everywhere
pnpm test          # vitest everywhere (web: unit + behavior, jsdom/node)
pnpm smoke:git     # native git CLI against the app's smart-HTTP route (scratch HOME; never touches your git config)
pnpm check         # biome lint + format check, whole repo
pnpm lint          # cached workspace Biome checks; shared config invalidates the cache
pnpm format        # biome format (write)
pnpm db:push       # push the schema to Neon — the only migration path (no migration files)
pnpm db:studio     # drizzle studio UI
```

One workspace: `pnpm --filter @pushstack/web test src/server/__tests__/repo-access.test.ts`, `pnpm --filter git-fs-s3 test`, `pnpm --filter @pushstack/web test:e2e`. After editing a library while `pnpm dev` runs, rebuild it (`pnpm exec turbo run build --filter=git-fs-s3`) and restart the dev server.

**Releasing a package**: bump the workspace's `package.json` version and its CHANGELOG, commit, then `git tag -m "git-fs-s3 vX.Y.Z" git-fs-s3@vX.Y.Z` and push the tag — `.github/workflows/release-packages.yml` resolves the workspace from the package name (`scripts/workspace-directory.mjs`), checks the tag against the version, then runs its typecheck/test/build, packs and publishes with npm trusted publishing (OIDC). The CLI (`@pstk/cli@vX.Y.Z`) releases the same way. Never delete or move a pushed tag; release a new patch instead. Full process in `apps/docs/content/docs/internals/releasing.md`.

**Adding a dependency**: edit the workspace's `package.json`, then `echo "Y" | pnpm install`.

**pnpm settings** live in `pnpm-workspace.yaml` (pnpm 12): `autoInstallPeers: false` (peers are declared explicitly — auto-installing optional peers once pulled all of Prisma in through better-auth/drizzle), `allowBuilds` (only listed packages may run install scripts), `permissions` (agent skills shipped in dependencies stay denied). There are no `overrides` and no audit exceptions: a vulnerable transitive dependency is fixed by upgrading or replacing what pulls it in.

## Architecture

**Framework**: TanStack Start (file-based SSR router, server functions via `createServerFn`). Routes in `src/routes/`; API routes under `src/routes/api/` are thin — git smart HTTP is served at GitHub's clone URL by `$owner.$name.info.refs.ts`, `$owner.$name.git-upload-pack.ts` and `$owner.$name.git-receive-pack.ts` (calling `git-http.ts`'s `serveGitRequest`), raw files at `$owner.$name.raw.$branch.$.ts` (calling `raw.ts`'s `serveRawFile`), and `api/v3.$.ts` calls `server/api/index.ts`'s `handleApiRequest`.

**Git**: isomorphic-git on R2, through our workspace packages `git-fs-s3` (fs + ops + smart-HTTP; `packages/git-fs-s3`) and `git-edge` (three-way merge; `packages/git-edge`). No native git, no local disk: every read and write goes straight to R2. Writes go through `git-fs-s3`'s packed writes (each write lands as one pack, before any ref moves), so nothing ever writes loose objects.

**Server modules** (`src/server/`, imported only by server functions and API handlers):
- `config.ts` — env tuning knobs (`GIT_CACHE_MAX_BYTES`, `GIT_CACHE_TTL_MS`, `GIT_HTTP_MAX_BODY_BYTES`), parsed once.
- `git-storage-naming.ts` — the only place R2 keys are built: `repos/{username}/{repoName}/git/…`. `ownerKeyOf(repo)` is the owner's username (required, immutable — `auth.ts` refuses changes). Every segment is checked against `STORAGE_NAME_RE` and fails closed. Use `parseRepoGitStorageKey` to classify keys; don't pattern-match key strings.
- `git-fs.ts` — the R2-backed isomorphic-git `fs`: R2 store (`git-fs-s3/fetch-s3`'s `createFetchS3Store`, wired from env in `src/lib/r2.ts`) → retry/circuit breaker → `perfR2` → LRU cache → git-aware fs. In tests (no R2 env) it's an in-memory store. `registerRepoGitdir` makes isomorphic-git's gitdir/`packed-refs`/`shallow` probes free. Also: `listRepoStorage`, `putStorageObject`, `deleteRepoStorage`/`moveRepoStorage` (the library's `deletePrefix`/`movePrefix` plus perf and cache invalidation). Retry classification is the library's `isRetryableError`; `pnpm dev:local` uses `git-fs-s3/node`'s `FileObjectStore`.
- `git-repo.ts` — `repoFor(ownerKey, repoName)` (the `Repo` handle every git call takes; carries the shared per-repo isomorphic-git `cache` — without it each object read re-parses every pack index), `initBareRepo`, `afterRepositoryPush` (drops result caches under `resultKeyPrefixes(gitdir)` plus the repo's git cache), storage rename/delete, and threshold repacks (`repackIfNeededUnlocked`, `repackRepositoryNow`).
- `git-repo-lock.ts` — `withRepositoryLock`: a Postgres lease row (`repo_locks`) with a heartbeat, since serverless instances share no memory. Every write runs under it. **Not reentrant** — a locked function must never take the same repo's lock again (it times out after ~65s).
- `git-read.ts` — every read: file content/view, commit, log/history, tree, branches, last commits, file history, commit and branch diffs (three-dot), merge analysis. All go through `git-fs-s3/ops` with `git-cache.ts`'s `opsHooksFor`; don't call `git.log`/`git.readTree` directly.
- `git-write.ts` — every web-UI write: `createCommit`, `deleteFile`, `createBranch`, `deleteBranch`, `setDefaultBranch`, `mergeBranches` (fast-forward or `git-edge`'s `threeWayMerge`, one lock span; returns `MergeOutcome`). Each validates branch names and repacks after the write when needed. A commit must target an existing branch or be an empty repo's first commit.
- `git-http.ts` — the git smart-HTTP endpoint: `parseGitUrl` (`/{owner}/{repo}[.git]/info/refs?service=…` or `/<service>`), a streamed body cap, repo lookup, `authorizeGitRequest`, then `git-fs-s3/http`'s info-refs/upload-pack, or receive-pack under the repo lock. The library validates every pushed ref name.
- `git-auth.ts` — git over HTTPS is **personal access tokens only** (`pst_…`, in either Basic-auth slot); no passwords, no cookies. Bad credentials → 401; a missing scope or role → 403. Anonymous reads of public repos are allowed.
- `submodules` — tree entries with `type: "commit"`/mode `160000` are external pointers. `git-fs-s3/ops` parses root `.gitmodules` at the viewed revision, includes pointer changes in diffs and tracks pointer history. `src/lib/submodule.ts` resolves safe navigation URLs; never fetch URLs from repository config. See `apps/docs/content/docs/internals/submodules.md`.
- `git-ref-name.ts` — zod schemas over `git-fs-s3`'s validators: `safeBranchNameSchema` (write paths), `safeRefNameSchema` (read paths: a branch or a full commit SHA, for permalinks), `safeCommitShaSchema`, `safeRepoPathSchema`.
- `git-cache.ts` — the parsed-result cache shared by all ops calls (`resultCache`, `invalidateResultCache`, `opsHooksFor`).
- Not-found mapping: the library's `isNotFoundError` (missing repo/ref/path/object → 404).
- `repo-access.ts` — the only place computing `RepositoryAccess` (role anonymous/read/write/admin/owner → flags, from one `PERMISSIONS` table). Handler helpers: `readWithAccess(label, repoId, fn)`, `writeWithAccess(repoId, fn(repo, user))`, `requireWriteAccess`, `requireOwner`. Use these rather than hand-rolling fetch-then-check. Already holding the repo row? Use `getAccessForRepository`.
- `files.ts` — file/branch/commit server functions over `git-read.ts`/`git-write.ts`. `getFile` returns a `FileView` (`src/lib/file-view.ts`): inline content only for small text; binary/large blobs come from `/{owner}/{repo}/raw/{ref}/{path}` (streamed — Vercel caps buffered responses at 4.5 MB). Submodules return `{ kind: "submodule", oid, url }` and render a pinned-repository card (never raw/download links). Diffs carry patches or pointer metadata, never full blob payloads.
- `repositories.ts` — repo CRUD, stars, collaborators (server functions only). Create inserts the row, then inits storage under the lock (rolling the row back on failure); rename moves storage and updates the row in one lock span. `claimNextIssueOrPrNumber` hands out the shared issue/PR `#N` sequence.
- `repository-lookup.ts` — plain server-only helpers shared by server functions and API routes: `findRepositoryByName` (cached), `readRepoByName`, `publicUserFields`, `claimNextIssueOrPrNumber`. **Server-function files export only `createServerFn`s and types** — any other runtime export drags the database into the browser bundle and breaks dev hydration (`server-fn-exports.test.ts` enforces it); put shared helpers here or, if pure, in `src/lib/`.
- `pnpm dev:local` (`PUSHSTACK_LOCAL_DIR`) stores git in the library's `FileObjectStore` instead of R2; `src/db/index.ts` switches to pglite on the same variable.
- `issues.ts`, `pull-requests.ts`, `comments.ts` — one per resource. Routes address issues/PRs by `number` (`getIssueByNumber`/`getPullRequestByNumber`), not DB id. Merging a PR closes the issues its body names (`getClosingIssueNumbers`, "Closes #4"). Permissions are GitHub's: any signed-in reader may open issues and comment (`canParticipate`); labels, PRs and merges need write.
- `timeline.ts` / `timeline-store.ts` — GitHub-style issue/PR timeline events (`closed` with its `closer`, `reopened`, `merged`, `cross-referenced`, `head_ref_deleted`; `src/lib/timeline-types.ts`). Every write that changes a thread's status or text records through the store; mentions come from `src/lib/issue-references.ts`. **The product targets GitHub compatibility** (easy migration, a future `gh`-style CLI): match GitHub's names, semantics and permissions rather than inventing new ones.
- `labels.ts` / `label-store.ts` — repo labels (`labels` + `thread_labels`, keyed by issue id with a cascading FK — a pull request is an issue (`issues.is_pull_request`; PR-only fields in `pull_requests`, 1:1 by `issue_id`), and `thread-store.ts`'s `listThreads` serves every issue/PR list; name unique ignoring case, color 6-hex without `#`). New repos get GitHub's default set (`src/lib/labels.ts`). Write access manages them; `setLabels` records `labeled`/`unlabeled` timeline events; list server functions take `labels` (AND filter) and return each row's `labels`.
- `activity.ts` — `recordActivity(userId, repoId, event)` with the typed `ActivityEvent` (`src/lib/activity-types.ts`); `describeActivity` (`src/lib/activity.ts`) renders it.
- `search.ts`, `users.ts` — repo/user search and activity feeds, profiles. Anonymous-readable; only public fields of users (never email) leave the server — use `repository-lookup.ts`'s `publicUserFields`.
- `tokens.ts` — PATs (`pst_` + random bytes, shown once; only the SHA-256 is stored). Scopes `repo:read` | `repo:write` (write implies read).
- `raw.ts` — GitHub's raw URL, `/{owner}/{repo}/raw/{ref}/{path}`: file bytes, ref and path validated, streamed.
- `api/` — the GitHub-compatible REST API at `/api/v3` (see `apps/docs/content/docs/api/index.md`, the compatibility matrix). `index.ts` dispatches through an exhaustive operation-to-handler map; `routing.ts` compiles its paths from `@pushstack/api-contract/client` (add an endpoint in the contract plus its handler in the map); `auth.ts` (`token`/`Bearer` PATs via `git-auth.ts`'s `authenticateToken`), `http.ts` (GitHub-shaped errors, `Link` pagination, URL builders), `serializers.ts` (GitHub JSON shapes), `repo-lookup.ts` (`readableRepository`: unreadable = 404), one module per resource (`users`, `repos`, `branches`, `tags`). Handlers call plain server modules, never `createServerFn`s.
- `repository-create.ts` — `createRepositoryForUser`, shared by the `createRepository` server function and the API.
- `perf-log.ts` — request-scoped timing: wrap a read handler in `perfContext`, awaited sub-calls in `perfStep`; prints one tree per request when enabled (always in dev; `PUSHSTACK_PERF_LOG=1` in prod; `localStorage["pushstack:perf-log"] = "1"` in a browser). `logError`/`logWarn` always log and feed Sentry — use them, not `console.error`.
- `session.ts` — `getCurrentUser()` (throws) / `getCurrentUserOptional()`; `SessionUser.username` is always set.
- `ttl-cache.ts` — bounded TTL cache with in-flight coalescing (access cache, repo-by-name cache).

**Database**: Drizzle ORM + Kit 1.0 RC (kept on the same version). `src/db/relations.ts` uses `defineRelations`; relational queries use v2 object filters, and local schema pushes import `drizzle-kit/api-postgres`. A relational `where` must never carry an empty `AND`/`OR` array — 1.0 throws ("Unexpected empty array in filters' 'AND' section") where earlier RCs ignored it — so omit the key when no condition applies. Better Auth receives its schema explicitly. Neon via `@neondatabase/serverless`, Drizzle ORM. `src/db/schema.ts` (Better Auth tables, hand-maintained) and `src/db/app-schema.ts` (app tables, typed `$type` columns). `pnpm db:push` is the only migration path. Each schema PR must specify safe schema/code deployment ordering: apply compatible additive schema changes before code that requires them; coordinate incompatible changes so automatic deployment cannot run against an unusable schema. The orchestrator verifies the production schema and deployed commit and records evidence on the PR. Before bumping `better-auth`, diff its core schema (`node_modules/@better-auth/core/dist/db/get-tables.mjs`) against `schema.ts`: a mismatch breaks sign-in at request time while build/typecheck/tests stay green (see `apps/docs/content/docs/internals/database.md`).

**Auth**: Better Auth (`src/lib/auth.ts`) with the username plugin; usernames must match `STORAGE_NAME_RE` and can't change (they key storage). Emails (Resend, `src/lib/email.ts`) escape user content.

**Client data fetching**: all TanStack Query keys and `queryOptions` factories live in `src/lib/query-options.ts` — source keys from `queryKeys` there. Server rendering shares one `QueryClient` per request with the loaders through `@tanstack/react-router-ssr-query` (`src/router.tsx`); only fetched or in-flight queries are sent to the browser (`shouldDehydrateQuery`). A loader query the page doesn't await is either `contentQuery` (shown content: awaited on the server, non-blocking in the browser) or `backgroundQuery` (expensive/secondary: browser only) from `src/lib/prefetch.ts` — a bare fire-and-forget prefetch settles after the HTML and causes hydration mismatches. Relative times render through `RelativeTime`. After a UI change, a full reload must log no hydration errors.

**UI structure**: the Björk UI design system (`.claude/skills/bjork-ui-design`; tokens `--bjork-*` in `styles.css`). The app shell (`components/shell`) is a left sidebar (global nav, the open repository's nav with live open counts, clone URL, account) — marketing pages (`/`, `/about`) and the sign-in pages (`/login`, `/signup`, `/password_reset`) render without it. Pages compose `components/layout` blocks: `Page`/`SplitLayout` (container-query aside)/`Toolbar`/`AsideSection`, `Panel`/`PanelHeader`/`PanelBody`/`PanelFooter`/`PanelList`/`PanelRow`, `SettingsLayout`. The code view is a workbench (`components/repo/code`: persistent file tree beside tree/blob routes, mounted by the repo layout); issues and pull requests are a split view (`ThreadSplitView`) on wide screens. Animated icons come from `@animateicons/react/lucide`, driven from the whole control by `useIconAnimation`. Highlighted code with line numbers is the only code view; its height is reserved while the worker highlights.

**Client bundle**: `vite.config.ts` marks `src/db/` and `src/server/` side-effect free, because server-function files keep their top-level imports in the client build — don't add import-time side effects there; keep server-only SDKs behind server-only dynamic imports (apps/docs/content/docs/internals/performance.md#client-bundle-size). Heavy client deps (`react-markdown` stack in `MarkdownRenderer`, Shiki in `CodeViewer`) are `React.lazy`-loaded at every call site; do the same for any new one.

**Error tracking (Sentry)**: gated on `VITE_SENTRY_DSN`. `instrument.server.mjs` + `src/server.ts` (`wrapFetchWithSentry`; Vercel functions can't preload with `--import`), `src/start.ts` (global request/function middlewares), `src/router.tsx` (client init), and `__root.tsx`'s `RootErrorComponent` for render errors — any new top-level error boundary must capture too. Source maps upload only when `SENTRY_AUTH_TOKEN` is set.

**Path aliases**: `#/*` and `@/*` both resolve to `src/*`.

## Testing

Behavior tests run the real server functions against pglite (`src/test/pglite-db.ts`, the real schema) and the in-memory git store; only the session is faked (`src/test/app-harness.ts`'s `signIn`/`signOut`). Prefer that over mocking modules. `vi.mock` factories must import test helpers by relative path. Smoke tests use native git with a scratch `HOME`, `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_NOSYSTEM=1` — never the user's git config.

## Environment Variables

```bash
DATABASE_URL=postgresql://...
BETTER_AUTH_SECRET=...
BETTER_AUTH_URL=http://localhost:3000
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=...
R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
GIT_HTTP_MAX_BODY_BYTES=52428800   # optional, default 50MB
GIT_CACHE_MAX_SIZE=1073741824      # optional, default 1GB (object cache; the result cache gets a quarter)
GIT_CACHE_TTL=3600                 # optional, default 1 hour (seconds)
RESEND_API_KEY=...
RESEND_EMAIL_FROM=...              # optional
PUSHSTACK_PERF_LOG=1               # optional, perf logs in production
VITE_SENTRY_DSN=...                # optional
SENTRY_AUTH_TOKEN=... SENTRY_ORG=... SENTRY_PROJECT=...   # optional, build-time source maps
```

## Key Constraints

- Deployment is Vercel's Node runtime (`nitro({ preset: "vercel" })`, `ssr.target: "node"`); nitro v3 has no Vercel Edge preset. Cloudflare provides only R2.
- `nitro` is pinned to an exact beta version on purpose — don't loosen it.
- Biome (not ESLint/Prettier). Add shadcn components with `pnpm dlx shadcn@latest add <component>`; don't hand-write one that already exists upstream. The handful of app-specific primitives with no shadcn equivalent (`back-link`, `error-alert`, `field-error`, `form-field`, `loading-button`, `spinner`, `visibility-badge`) live in `src/components/ui/*` too.
- The Content-Security-Policy is built per request in `src/server/csp.ts` (nonce plus the theme script's hash), *not* in `vite.config.ts`'s `routeRules` — that is why only the static headers are there. `style-src` keeps `'unsafe-inline'` for Shiki's inline style attributes; adding a nonce to it would disable them.
- Every persisted, caller-controlled string has an explicit maximum in `src/lib/limits.ts` (issue/PR/comment bodies, commit messages, web uploads), and list endpoints bound `skip`. Put new persisted text there instead of relying on the platform's request-body cap.
- `username`, `displayUsername` and `email` are immutable (`src/lib/auth.ts`); repository storage keys derive from the username.
- Repository names and usernames match `STORAGE_NAME_RE` (`/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/`). That rule is what keeps `..` or `/` out of storage keys — don't loosen it.
- Every branch-name field is validated with `safeBranchNameSchema` (writes) or `safeRefNameSchema` (reads); never a bare `z.string()`. `git.commit`/`git.deleteBranch` don't validate ref names, and the fs derives the repo from the path, so an unvalidated name is a cross-tenant path traversal. Route handlers reading refs/paths off the URL (`raw.ts`) validate explicitly.
- `MarkdownRenderer` renders attacker-controlled content: links and images must go through `isSafeHref`/`isSafeImageSrc`.

## Verify
- `pnpm test && pnpm typecheck` — workspace tests plus turbo typecheck across all packages.

## PR workflow
- Pick tickets whose files no open PR touches (`gh pr list --json number,files`); hotspots — contract files, `api/index.ts`, `api-contract.test.ts`, `limits.ts`, `query-options.ts`, schema, API docs — take one PR at a time.
- In shared files, add entries beside their domain, never at the end of the file (end-of-file appends are what collide).
- Merge only after the gate review approves the PR's *current head* (a push after review needs a new review): `gh pr merge N --squash --auto` (a `main` ruleset requires CI, so GitHub merges when green; if checks already passed, drop `--auto`). Never `--delete-branch` — it removes local worktrees; GitHub deletes merged branches.
