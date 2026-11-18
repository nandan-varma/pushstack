# AGENTS.md

PushStack is a code forge that is **as close to GitHub as possible**: features, semantics, permissions, URLs, and above all the REST and GraphQL APIs, so repos and tooling (scripts, stock `gh`) migrate unchanged. When unsure, do what GitHub does; never invent. There are no users or data yet: replace, don't layer; no shims, fallbacks or legacy code. Bare essentials first; hard features go to the backlog with a design note.

**Stateless by design.** Nothing here is status. Rediscover as needed: backlog = `gh issue list`, work = `gh pr list`, code = `ls`/grep, durable how-tos = `apps/docs/content/docs/` (esp. `internals/`: security, git-storage, database, server-functions, testing, performance, releasing). Keep docs minimal so they cannot drift: document a durable rule, invariant or non-obvious why once, never what the code or a generated file already says (the API matrix is generated; do not restate endpoints, counts, file lists or status). When a change makes a doc line false, delete or fix it in the same PR. Keep this file short and true; delete what you cannot verify.

**Code style.** Names and types carry the meaning; a comment explains only a non-obvious why (a constraint, an invariant, a GitHub quirk), never what the line does or what changed. No dead exports, commented-out code, TODOs without an issue, or flags and shims for old behavior. Prefer an existing library over hand-written parsing or protocol code. One way to do each thing: extend the shared module (`pull-create.ts`, `fork-objects.ts`) rather than copy its logic.

## Mental model

pnpm + Turborepo monorepo.
- `apps/web`: the product, TanStack Start on Vercel's Node runtime (no queues, cron, workers or SSH; Cloudflare only provides R2). `src/server` has per-resource server functions (`createServerFn`, exporting only server functions and types) plus `*-store.ts` helpers; `src/server/api` is the REST `/api/v3` dispatcher; `src/server/graphql` is `/api/graphql` (GitHub's own SDL, vendored per domain; never edit generated files). Git is isomorphic-git on R2 through `packages/git-fs-s3` (and `git-edge` for merges), imported from built `dist/`. Data is Postgres via Drizzle; `pnpm db:push` is the only migration path. Auth is Better Auth; git over HTTPS uses PATs only.
- `packages/api-contract`: the `/api/v3` contract keyed by GitHub operation id; a new endpoint = route + schemas + handler in the operation map.
- `apps/docs`: Fumadocs site, tested for links and code samples.
- Root commands: `pnpm dev:local` (pglite + disk git, no accounts), `pnpm test`, `pnpm typecheck`, `pnpm check`, `pnpm smoke:git`. Verify with `pnpm test && pnpm typecheck` and `pnpm exec biome check <paths>`. Add a dependency with `echo "Y" | pnpm install`. Tests import built `dist/` of packages: rebuild with `pnpm exec turbo run build --filter=<pkg>` after an edit or fresh checkout.

## Invariants (reviewers block on these)

- Access only via `repo-access.ts` helpers; git reads via `git-read.ts` + `opsHooksFor`, writes via `git-write.ts` under `withRepositoryLock` (not reentrant). R2 keys only from `git-storage-naming.ts`.
- Names: `STORAGE_NAME_RE` for repos and usernames (never loosen); `safeBranchNameSchema` / `safeRefNameSchema` / `safeRepoPathSchema` on every ref and path, never a bare `z.string()`. Usernames and emails are immutable.
- Every persisted caller-controlled string has a cap: API-facing ones in `packages/api-contract/src/limits.ts` (the single source, re-exported by `src/lib/limits.ts`), the rest in `src/lib/limits.ts`; bound `skip`; stay under Vercel's 4.5 MB buffered response (stream big bodies).
- Attacker content: `isSafeHref`/`isSafeImageSrc` for links and images, never `dangerouslySetInnerHTML` with user data, never fetch URLs from repo config.
- Failure must differ from empty: never return `[]`/`null`/`0` on error. A Drizzle relational `where` must never hold an empty `AND`/`OR`.
- Client: query keys/options only in `src/lib/query-options.ts`; loader queries a page doesn't await use `contentQuery`/`backgroundQuery` (`src/lib/prefetch.ts`); heavy deps `React.lazy`; a reload must log no hydration errors. Use `logError`/`logWarn`, not `console.error`.
- Schema PRs state a safe deploy order; only the orchestrator runs `db:push`, then verifies production. Never touch the user's git config (tests use a scratch HOME). Commits and PRs carry no tool or AI attribution. `git tag -m`; never move a pushed tag. `nitro` stays pinned.

## Working method

- **Autonomous.** Run the loop without asking; raise questions to the owner only for product decisions with no GitHub precedent, accounts/payments, or destructive production steps, each with a recommended default. Owner priority for now: **v1 ASAP** = stock `gh` works end to end (milestone `v1: gh-compatible`); easy features on current infra sit in `Next: on existing infra`; webhooks, branch protection, orgs, import and anything needing new infra or a db redesign wait in `Later: needs new infra`. Pick work in milestone order; keep the v1 milestone current.
- **Who codes.** Implement it yourself when handing off costs more than the work; otherwise delegate to a worker agent, in its own worktree (`.worktrees/<n>`, gitignored scratch that biome skips). The agent and model are the owner's current choice and change often: use what they last said, never hardcode it. A brief is the issue number, `echo Y | pnpm install`, the build of `packages/*`, the verify commands, "commit each milestone, open the PR with `--body-file` and `Closes #N`, do not merge, report honest test counts". Check the worker's result yourself: read the diff and run the tests on its branch before merging. Recover a stalled worker with a bounded "finish and ship, don't restart".
- **Review.** Read the diff and run the tests yourself, on the branch, before merging anyone's PR (a worker's or your own). Findings carry file:line or a measured number and are marked blocking/non-blocking. Prefer a fresh reader for anything touching storage, access or the schema.
- **Merge.** Squash (`gh pr merge N --squash`), never `--delete-branch`. CI should be green; the owner may authorize merging past a failing check, and an unrelated external failure (an advisory with no fix) must not block the queue. Rebase conflicts by regenerating generated files, never hand-merging. Afterward record follow-ups and deploy status on the issue/PR.
- **Parallelism.** Pick issues whose files no open PR touches (script over `gh pr list --json number,files`); hotspots (contract, `api/index.ts`, `limits.ts`, `query-options.ts`, schema, API docs, GraphQL codegen) take one PR at a time; add entries beside their domain, not at end of file.
- **Hygiene.** `git fetch` before judging a base. When a step was slow or failed, fix the process (doc, test, script) now.

## Backlog conventions

Milestones carry scope (`v1: gh-compatible`, `Next: on existing infra`, `Later: needs new infra`). Labels are flat: `area:*` (git, repos, issues, pulls, api, auth, ui, infra), `size:s|m|l`, `bug`, `feature`, `docs`, `needs-design` (large: write a design note and split into small issues before implementing). An issue states the gh command or feature, files likely touched, hotspot files, and an acceptance test, so a worker starts without rediscovery. Brief workers with those fields; the issue is the source of truth, not the chat.
