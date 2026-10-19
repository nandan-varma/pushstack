---
title: "Testing"
description: "Vitest and Playwright layout, conventions, dogfooding and known gaps."
---

## Unit and behavior tests (Vitest)

Live in `__tests__/` directories beside the code they cover; most are in
`apps/web/src/server/__tests__/`.

**Behavior tests use real infrastructure, not module mocks.** The server
functions run for real against:

- **pglite** (`apps/web/src/test/pglite-db.ts`'s `createTestDb`) — an in-memory
  Postgres with the real schema pushed into it, so every query, constraint
  and the repo lock's lease SQL are real.
- **the in-memory git store** — R2 isn't configured in tests, so `git-fs.ts`
  backs the same storage stack production uses with an in-memory object
  store.
- **a faked session** — `apps/web/src/test/app-harness.ts`'s `sessionModule`, with
  `signIn(user)` / `signOut()` choosing the caller, `createUsers(...)` for
  fixtures and `rejectsNotFound(promise)` for 404 assertions.

The setup at the top of such a file:

```ts
vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));
vi.mock("@tanstack/react-start", () => import("../../test/server-test-utils"));
vi.mock("#/server/session", async () => (await import("../../test/app-harness")).sessionModule);
```

`vi.mock` factories run before aliases resolve, so they import helpers by
relative path. Write new server tests this way rather than mocking modules:
a mock silently drifts from the code it replaces.

`git-user-lifecycle.test.ts` goes one layer further: git-fs-s3's real fetch
store talks to a fake S3 endpoint (`helpers/fake-s3-fetch.ts`), so request
signing, ListObjectsV2 parsing and server-side copy run too; it clones and
pushes with isomorphic-git over a loopback server running `serveGitRequest`.

**Native git (`pnpm smoke:git`)** — `apps/web/scripts/smoke/git-cli.smoke.test.ts`
drives the real `git` CLI against the real `/api/git/$` route on a loopback
server: clone, push, incremental fetch, repack, web commits, force-push,
branch/tag create and delete, default-branch protection, merges, bad tokens,
and "no loose objects ever written". Every `git` call runs with a scratch
`HOME`/`GIT_CONFIG_GLOBAL` and `GIT_CONFIG_NOSYSTEM=1` — it never reads or
writes your own git configuration. Kept out of `pnpm test`.

Notable files:

- `repositories.test.ts`, `collaboration.test.ts` — the server functions end
  to end: access rules, privacy (no emails leave the server), unsafe names
  and paths, stars, collaborators, rename/delete, issues/PRs/comments, the
  shared `#N` sequence, merging, search, profiles, PAT auth.
- `git-http.test.ts` — URL routing, the streamed body cap, auth challenges.
- `git-integration.test.ts`, `git-repack.test.ts` — git reads and writes
  through `git-read.ts`/`git-write.ts`, and pack consolidation.
- `git-repo-storage-ops.test.ts` — `withRepositoryLock` (serialization,
  expiry takeover, timeout, heartbeat renewal), `afterRepositoryPush`'s cache
  invalidation, storage rename/delete.
- `git-ref-name.test.ts`, `git-storage-naming.test.ts` — the validators and
  key construction that stop path traversal (see [security.md](/docs/internals/security)).
- `repo-access.test.ts` — `RepositoryAccess` and its handler helpers.
- `rate-limit.test.ts` — the shared rate-limit counters against real SQL
  (the atomic upsert's allowance, per-key isolation, window rollover), plus an
  assertion that the auth config uses that storage rather than the in-memory
  default.
- `csp.test.ts` — the Content-Security-Policy's directives, the theme script's
  hash being the hash of the constant the document renders, and the nonce being
  unguessable and distinct per call.
- `repo-path.test.ts` — resolving a relative markdown target against its
  containing file, including refusal to climb above the repository root.

Run everything with `pnpm test` (`pnpm test:watch`, `pnpm test:coverage`);
one file with `pnpm test apps/web/src/server/__tests__/repo-access.test.ts`.

Config: `apps/web/vitest.config.ts` — `jsdom` by default (server suites opt into
`@vitest-environment node`), typecheck-on-test, `v8` coverage.

### What's not covered yet

Few component render tests: coverage is server logic plus pure client
helpers (e.g. `MarkdownRenderer`'s `isSafeHref`/`isSafeImageSrc`). The
high-churn routes (PR pages, tree/blob/commit viewers, upload, comment forms)
are covered only by e2e.

## End-to-end tests (Playwright)

Live in `apps/web/e2e/`: `auth.spec.ts`, `navigation.spec.ts`, `repositories.spec.ts`,
and `git-cli.spec.ts` (that same smart-HTTP path, driven by the real `git`
binary rather than isomorphic-git).

```bash
pnpm test:e2e         # headless
pnpm test:e2e:ui      # Playwright's UI mode
pnpm test:e2e:headed  # headed browser
```

Config: `apps/web/playwright.config.ts`. Two things worth knowing before touching this
suite:

- It **loads `.env.local`** directly (via `dotenv`) so both the dev server it
  spins up and the test files themselves (which need direct DB access to
  verify things like test-user email state) see the same environment `pnpm
  dev` would. It creates and deletes users, so point `.env.local` at a dev
  database before running it — never production. The helpers refuse to run
  against a non-local `DATABASE_URL` unless `E2E_ALLOW_REMOTE_DB=1` is set,
  because `.env.local` is the file most likely to be pointed at a real one.
- It runs **serially, one worker** (`fullyParallel: false, workers: 1`) —
  deliberately, not for lack of trying parallelism elsewhere in this
  codebase. All specs share one dev server, one real database, and one auth
  rate limiter (20 requests/60s, configured in `apps/web/src/lib/auth.ts`). Running
  workers in parallel caused cross-file request contention that looked like
  flaky rate-limit false positives, and let client hydration lag behind test
  input under load. If you're adding e2e coverage and tempted to speed things
  up with more workers, this is why that's currently off.

## Dogfooding the issue and pull-request flow

The unit and e2e suites cover the pieces; this is the manual pass that walks the
flow the way a person does, on a real deployment:

1. Open an issue, comment on it, close it, reopen it.
2. Open a pull request, comment on it, close it, reopen it, merge it.
3. Put `Closes #3` in a pull request body and confirm merging it closes issue 3
   in the same repository.

Step 3 is the one worth doing by hand: closing keywords, the shared `#N`
sequence and the merge all have to agree, and a passing unit test for each of
them does not prove they agree with each other.

## Lint / format / typecheck

```bash
pnpm check      # Biome lint + format check (CI gate)
pnpm format     # Biome format, writes changes
pnpm typecheck  # tsc --noEmit
```

Biome (not ESLint/Prettier) — config in `biome.json`.
