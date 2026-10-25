# CLAUDE.md

PushStack is a code forge that is **as close to GitHub as possible**: features, semantics, permissions, URLs and especially the REST and GraphQL APIs, so repos and the tooling around them (scripts, stock `gh`, integrations) migrate unchanged. When unsure, do what GitHub does (names, status codes, JSON shapes, permission model); never invent. No users or data exist yet: replace, don't layer; no shims, fallbacks or legacy code. Bare essentials first; hard features go to the backlog with a design note.

State lives in GitHub, not in files: backlog = issues (`gh issue list`), work = PRs, durable how-tos = `apps/docs/content/docs/internals/*` and skills. Do not add status, progress or per-session notes here. `apps/cli` is being sunset for stock `gh` once compatibility is done: take no CLI tickets.

## Layout

pnpm + Turborepo monorepo. App paths below are relative to `apps/web` unless prefixed.

- `apps/web` — the product: TanStack Start app, `/api/v3` REST, `/api/graphql`, git smart-HTTP. Vercel (Node runtime, nitro `vercel` preset, root `apps/web`, see `vercel.json`). Env in `apps/web/.env.local`.
- `apps/docs` — Fumadocs site, sources in `content/docs`; its test checks links, navigation and code samples. Internals guides live in `content/docs/internals/` (database, git-storage, security, performance, releasing, testing, submodules, server-functions).
- `apps/cli` — `@pstk/cli`, being sunset (see above).
- `packages/api-contract` — private `/api/v3` contract keyed by GitHub operation id (`routes.ts` zod-free, `endpoints.ts`, `resources.ts`). New endpoint = route + schemas + handler in `src/server/api/index.ts`'s operation map. `api-contract.test.ts` validates real responses (`KNOWN_DRIFT` lists accepted mismatches).
- `packages/git-fs-s3`, `packages/git-edge` — our git libraries, published to npm; the app imports their built `dist/` (turbo builds them first). Fix bugs at the source, rebuild before app tests.
- `packages/tsconfig` — shared compiler options. Root: `turbo.json` (build-time env vars must be listed there), one `biome.json`, husky + lint-staged, `scripts/workspace.test.mjs` (enforces workspace scripts, versions, workflow SHA-pinning).

## Commands (from the root)

```bash
pnpm dev            # web on :3000 (build packages first)
pnpm dev:local      # pglite + on-disk git, emails print to the terminal; no accounts needed
pnpm build | typecheck | test | check | lint | format
pnpm smoke:git      # native git + stock gh against a local server, scratch HOME
pnpm db:push        # the only migration path; orchestrator only, never from a worker
pnpm --filter @pushstack/web test src/server/__tests__/x.test.ts   # one file
pnpm --filter @pushstack/web graphql:codegen   # regenerate resolvers/generated.ts (committed, test-checked)
```

Verify before a PR: `pnpm test && pnpm typecheck` plus `pnpm exec biome check <paths>`. Add a dependency: edit `package.json`, then `echo "Y" | pnpm install` (pnpm 12: `autoInstallPeers: false`, `allowBuilds`/`permissions` in `pnpm-workspace.yaml`; decide there, never blanket-approve; no overrides — fix vulnerable transitive deps by upgrading). After a new route, regenerate `src/routeTree.gen.ts` (`pnpm build`). Tests import built `dist/` of `api-contract` and the libraries: `pnpm exec turbo run build --filter=<pkg>` after a fresh checkout or library edit.

Release a package: bump version + CHANGELOG, commit, `git tag -m "<name> vX.Y.Z" <name>@vX.Y.Z`, push the tag (`release-packages.yml`, npm OIDC). Never delete or move a pushed tag. See `internals/releasing.md`.

## Architecture (src/server unless noted; `ls` it for the rest)

- **Git**: isomorphic-git on R2 via `git-fs-s3`; no native git, no local disk, writes land as one pack before any ref moves. R2 keys are built only in `git-storage-naming.ts` (`repos/{username}/{repo}/git/…`; use `parseRepoGitStorageKey`). Reads go through `git-read.ts` (`git-fs-s3/ops` + `git-cache.ts`'s `opsHooksFor`; never call `git.log`/`git.readTree` directly); writes through `git-write.ts` under `withRepositoryLock` (Postgres lease, **not reentrant**: never re-take the same repo's lock inside it). `git-http.ts` serves smart-HTTP; `git-auth.ts`: PATs only (`pst_…`, SHA-256 stored), 401 bad credentials, 403 missing scope/role, anonymous reads of public repos. Not-found: the library's `isNotFoundError`.
- **Access**: `repo-access.ts` is the only place computing `RepositoryAccess`; use `readWithAccess`, `writeWithAccess`, `requireWriteAccess`, `requireOwner`, `getAccessForRepository`. Never hand-roll fetch-then-check.
- **Server functions** (`createServerFn`) live in per-resource files (`issues.ts`, `pull-requests.ts`, `repositories.ts`, …). They export only server functions and types (`server-fn-exports.test.ts` enforces it); shared helpers go in `*-store.ts`, `repository-lookup.ts`, or `src/lib/`. REST (`api/`) and GraphQL (`graphql/`) handlers call plain server modules, never server functions.
- **REST** `/api/v3`: dispatcher in `api/index.ts`, GitHub-shaped errors/`Link` pagination in `api/http.ts`, serializers in `api/serializers.ts`; unreadable repo = 404. **GraphQL** `/api/graphql` (PAT required, what `gh` calls): GitHub's own SDL vendored per domain (`graphql/schema/<domain>.subset.json` → generated `.graphql`, never edit; resolvers in `graphql/resolvers/<domain>.ts`), `limits.ts` bounds depth/nodes/cost, unreadable = `null` + `NOT_FOUND`; `__fixtures__/gh/` holds documents real `gh` sends.
- **Database**: Drizzle ORM + Kit 1.0 RC (same version for both), `defineRelations`, v2 object filters; **a relational `where` must never contain an empty `AND`/`OR` array**. Schemas: `src/db/schema.ts` (Better Auth, hand-kept; diff against `@better-auth/core`'s `get-tables.mjs` before bumping `better-auth`), `src/db/app-schema.ts`. Every schema PR states a safe deploy order (additive changes first; incompatible changes need coordination); the orchestrator pushes and verifies production. A READY deployment does not prove a schema rollout: probe affected endpoints and run `db:push --explain`.
- **Auth**: Better Auth with the username plugin. `username`, `displayUsername`, `email` are immutable (storage keys derive from the username).
- **Client**: queries only via `src/lib/query-options.ts`; loader queries the page doesn't await must be `contentQuery` or `backgroundQuery` (`src/lib/prefetch.ts`), never bare prefetch (hydration mismatch). Relative times via `RelativeTime`. After UI changes, a full reload must log no hydration errors. Heavy deps (markdown, Shiki) are `React.lazy`; `src/db/` and `src/server/` are marked side-effect free in `vite.config.ts`, so add no import-time side effects there. UI follows the Björk design system (`.claude/skills/bjork-ui-design`, tokens `--bjork-*`); compose `components/layout` blocks.
- **Observability**: `perfContext`/`perfStep` (`perf-log.ts`); `logError`/`logWarn` (feed Sentry), never `console.error`; new top-level error boundaries must capture to Sentry.

## Invariants (security and robustness; reviewers block on these)

- Repo names and usernames match `STORAGE_NAME_RE` (`/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/`); never loosen it (keeps `..` and `/` out of storage keys).
- Every branch/ref field is validated with `safeBranchNameSchema` (writes) or `safeRefNameSchema` (reads), paths with `safeRepoPathSchema`; never a bare `z.string()` (unvalidated names are cross-tenant path traversal). Handlers reading refs/paths off the URL validate explicitly.
- Every persisted caller-controlled string has a maximum in `src/lib/limits.ts`; list endpoints bound `skip`; bodies are capped; buffered responses stay under Vercel's 4.5 MB (stream big bodies).
- `MarkdownRenderer` renders attacker content: links/images go through `isSafeHref`/`isSafeImageSrc`. No `dangerouslySetInnerHTML` with user data. The CSP is built per request in `csp.ts`, not in `vite.config.ts`.
- Never fetch URLs from repository config (submodule URLs resolve via `src/lib/submodule.ts`).
- Failures must be distinguishable from empty results: no function returns `[]`/`null`/`0` when it failed. A response-size cap does not bound work already done: budget before decoding.
- Env parsing changes can fail every request at module load: confirm production values parse.
- `nitro` stays pinned to an exact beta version. Vercel Node runtime only (no queues, cron, background workers or SSH); Cloudflare provides only R2: keep R2 round trips and DB queries low.
- Biome only (no ESLint/Prettier). Add shadcn components with `pnpm dlx shadcn@latest add <name>`.

## Testing

Behavior tests run the real server functions against pglite and the in-memory git store; only the session is faked (`src/test/app-harness.ts` `signIn`/`signOut`). Prefer that to mocking; `vi.mock` factories import helpers by relative path. Dispatcher-level tests skip the file route: probe a running `pnpm dev:local` with curl for any new HTTP method, status or header. Resource-query changes must run `thread-query-count.test.ts`. A hand-written parser replacing a reference one must be differential-tested against it. Git clients in tests use a scratch `HOME`/`GIT_CONFIG_GLOBAL` with `GIT_CONFIG_NOSYSTEM=1`: **never touch the user's git config**.

## Working method

The main agent orchestrates (plans from issues, dispatches, runs gates, merges, pushes schema, releases) and implements only when asked or when delegation costs more than the task. Nobody gates their own PR.

- **Implementers**: agent, model, effort and provider are the owner's current choice (they change often): use what the user last specified, else the runtime default; never hardcode them in docs or scripts. Start them **through Orca** so the owner can supervise, not as bare background processes. Use the `orca-cli` and `orchestration` skills (`orca skills get orchestration`): `orca orchestration run-create`, then `worker-start --spec "<task>" --worktree … --agent <agent> [--model … --effort …]`, then `orca orchestration check --wait --types worker_done,escalation,question` to be told when a worker finishes (plain `agent launch`/`worktree create --agent` sends no completion message: you must poll the PR/branch). Spec = target, change, constraints, files owned, observable acceptance; tell it: issue number, `echo Y | pnpm install` first, never touch global git config, no `pnpm db:push`, write tests, commit at every milestone, open the PR with `Closes #N` via `--body-file` (backticks in `--body` run as shell), do not merge, report real test counts and what it did not verify. Reuse a worker for follow-ups on its own PR; start a fresh one when its session is gone or context is large. Workers can die mid-task: recover with `git status` in its worktree, then a bounded "finish and ship, don't restart".
- **Reviewers**: Model per the owner's current choice; a **fresh agent per PR head, never reused** (reviewer context cost grows). Read-only: no edit/push/merge. One designated gate per PR (security/performance/correctness for auth, storage, git, API, schema, hot paths; quality/tests for refactors and UI); every finding has file:line or a measured number, is marked blocking/non-blocking, and is posted with `gh pr review N --comment --body-file`, ending `Verdict: APPROVE` or `Verdict: CHANGES REQUESTED`. Reviewers run the tests themselves (workers skip live/browser checks). Point them at the new head after any fix push. Out-of-scope findings become labelled issues after a duplicate check.
- **Pacing**: reviews and blockers come before new implementation. Pick issues whose files no open PR touches (script over `gh pr list --json number,files`; ad-hoc `comm` pipelines lie). Hotspots take one PR at a time: contract files, `api/index.ts`, `api-contract.test.ts`, `limits.ts`, `query-options.ts`, schema, API docs, `graphql-codegen.ts`, `generated.ts`. Add shared-file entries beside their domain, never at the end of the file.
- **Budget**: `helpers limits`; dispatch new work only below the owner's current thresholds; at the limit stop gracefully with state recorded on each issue.
- **Blocker watch**: on the owner's chosen cadence check stalled workers, silent reviewers, red CI, unreviewed heads, conflicts.
- **Merge**: only after the gate approves the PR's current head: `gh pr merge N --squash --auto` (a `main` ruleset requires CI; drop `--auto` if already green). Merge in a separate step from reading checks (`gh pr checks N --json name,state`) (CodeQL is a required gate). Never `--delete-branch`. Rebase on conflict: rebuild appended-block conflicts from `origin/main`'s version; regenerate `generated.ts`, never hand-merge it. After merge, record follow-ups and deploy/schema status on the issue/PR.
- **Git hygiene**: `git fetch` before judging a base; the main checkout may hold the owner's edits, so make small changes in a scratch worktree (`git worktree add .claude/worktrees/<n> -b <branch> origin/main`) with explicit `git add` paths; biome ignores `.claude/worktrees/*` in `pnpm check`, use `pnpm exec biome check <paths>`; worktrees lack gitignored files (`.env.local`). Commits and PRs carry no AI attribution. Tags need `git tag -m`.
- **Self-improvement**: when a step is slow or fails, fix the process now (this file, a test, a script, docs) and prefer a mechanical guard to prose. Keep this file minimal and true: remove what you cannot verify.
