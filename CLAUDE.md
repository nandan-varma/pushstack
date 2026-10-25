# CLAUDE.md

PushStack is a code forge that is **as close to GitHub as possible**: features, semantics, permissions, URLs, and above all the REST and GraphQL APIs, so repos and tooling (scripts, stock `gh`) migrate unchanged. When unsure, do what GitHub does; never invent. There are no users or data yet: replace, don't layer; no shims, fallbacks or legacy code. Bare essentials first; hard features go to the backlog with a design note.

**Stateless by design.** Nothing here is status. Rediscover as needed: backlog = `gh issue list`, work = `gh pr list`, code = `ls`/grep, durable how-tos = `apps/docs/content/docs/` (esp. `internals/`: security, git-storage, database, server-functions, testing, performance, releasing). If you learn something durable, fix the doc that should have said it, in the same PR as the change; when code changes behavior, update its markdown. Keep this file short and true; delete what you cannot verify.

## Mental model

pnpm + Turborepo monorepo.
- `apps/web`: the product, TanStack Start on Vercel's Node runtime (no queues, cron, workers or SSH; Cloudflare only provides R2). `src/server` has per-resource server functions (`createServerFn`, exporting only server functions and types) plus `*-store.ts` helpers; `src/server/api` is the REST `/api/v3` dispatcher; `src/server/graphql` is `/api/graphql` (GitHub's own SDL, vendored per domain; never edit generated files). Git is isomorphic-git on R2 through `packages/git-fs-s3` (and `git-edge` for merges), imported from built `dist/`. Data is Postgres via Drizzle; `pnpm db:push` is the only migration path. Auth is Better Auth; git over HTTPS uses PATs only.
- `packages/api-contract`: the `/api/v3` contract keyed by GitHub operation id; a new endpoint = route + schemas + handler in the operation map.
- `apps/docs`: Fumadocs site, tested for links and code samples. `apps/cli` is being sunset for stock `gh`: take no CLI tickets.
- Root commands: `pnpm dev:local` (pglite + disk git, no accounts), `pnpm test`, `pnpm typecheck`, `pnpm check`, `pnpm smoke:git`. Verify with `pnpm test && pnpm typecheck` and `pnpm exec biome check <paths>`. Add a dependency with `echo "Y" | pnpm install`. Tests import built `dist/` of packages: rebuild with `pnpm exec turbo run build --filter=<pkg>` after an edit or fresh checkout.

## Invariants (reviewers block on these)

- Access only via `repo-access.ts` helpers; git reads via `git-read.ts` + `opsHooksFor`, writes via `git-write.ts` under `withRepositoryLock` (not reentrant). R2 keys only from `git-storage-naming.ts`.
- Names: `STORAGE_NAME_RE` for repos and usernames (never loosen); `safeBranchNameSchema` / `safeRefNameSchema` / `safeRepoPathSchema` on every ref and path, never a bare `z.string()`. Usernames and emails are immutable.
- Every persisted caller-controlled string has a cap in `src/lib/limits.ts`; bound `skip`; stay under Vercel's 4.5 MB buffered response (stream big bodies).
- Attacker content: `isSafeHref`/`isSafeImageSrc` for links and images, never `dangerouslySetInnerHTML` with user data, never fetch URLs from repo config.
- Failure must differ from empty: never return `[]`/`null`/`0` on error. A Drizzle relational `where` must never hold an empty `AND`/`OR`.
- Client: query keys/options only in `src/lib/query-options.ts`; loader queries a page doesn't await use `contentQuery`/`backgroundQuery` (`src/lib/prefetch.ts`); heavy deps `React.lazy`; a reload must log no hydration errors. Use `logError`/`logWarn`, not `console.error`.
- Schema PRs state a safe deploy order; only the orchestrator runs `db:push`, then verifies production. Never touch the user's git config (tests use a scratch HOME). Commits and PRs carry no AI attribution. `git tag -m`; never move a pushed tag. `nitro` stays pinned.

## Working method

- **Autonomous.** Run the loop without asking; batch questions to the owner only for product decisions with no GitHub precedent, accounts/payments, or destructive production steps, each with a recommended default. Owner priority for now: **v1 ASAP** = stock `gh` works end to end (milestone `v1: gh-compatible`); webhooks, forks, branch protection, orgs, import and anything needing new infra or db redesign wait in `Later: needs new infra`; easy features on current infra sit in `Next: on existing infra`. Pick work in milestone order; the owner states requirements and asks for v1 status, so keep the v1 milestone current.
- **Who codes.** Implement it myself when handoff overhead exceeds the work; delegate otherwise. Agent, model, effort and provider are the owner's current choice and change often: use what they last said, never hardcode it. Start workers **through Orca** so the owner can supervise (skills `orca-cli`, `orchestration`; `orca orchestration run-create`, `worker-start --spec …`, `check --wait` for `worker_done`; plain launches send no completion message). Worker brief: issue number, `echo Y | pnpm install`, tests, commit each milestone, PR via `--body-file` with `Closes #N`, no merge, honest test counts. Recover stalled workers with a bounded "finish and ship, don't restart".
- **Review.** Nobody gates their own PR. One fresh reviewer per PR head, never reused, read-only; findings carry file:line or a measured number, marked blocking/non-blocking, posted via `gh pr review --body-file`, ending `Verdict: APPROVE` or `Verdict: CHANGES REQUESTED`; reviewers run the tests themselves.
- **Merge.** Only after approval of the current head and green CI (CodeQL is required): `gh pr merge N --squash --auto`, never `--delete-branch`. Rebase conflicts by regenerating generated files, never hand-merging. Afterward record follow-ups and deploy status on the issue/PR.
- **Parallelism.** Pick issues whose files no open PR touches (script over `gh pr list --json number,files`); hotspots (contract, `api/index.ts`, `limits.ts`, `query-options.ts`, schema, API docs, GraphQL codegen) take one PR at a time; add entries beside their domain, not at end of file. Check `helpers limits` before dispatching.
- **Hygiene.** `git fetch` before judging a base; make small changes in a scratch worktree (`.claude/worktrees/<n>`); biome ignores that directory in `pnpm check`, run it on paths. When a step was slow or failed, fix the process (doc, test, script) now.

## Backlog conventions

Milestones carry scope (`v1: gh-compatible`, `Next: on existing infra`, `Later: needs new infra`). Labels are flat: `area:*` (git, repos, issues, pulls, api, auth, ui, infra), `size:s|m|l`, `bug`, `feature`, `docs`, `needs-design` (large: write a design note and split into small issues before implementing). An issue states the gh command or feature, files likely touched, hotspot files, and an acceptance test, so a worker starts without rediscovery. Brief workers with those fields; the issue is the source of truth, not the chat.
