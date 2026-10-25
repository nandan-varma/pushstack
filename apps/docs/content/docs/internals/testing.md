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
  Postgres holding the real schema, loaded from the template `globalSetup`
  (`apps/web/src/test/test-db-template.ts`) builds once per run, so every
  query, constraint and the repo lock's lease SQL are real. A new schema file
  must be added to that module's `SCHEMA_SOURCE_FILES`, or the cached template
  isn't rebuilt when it changes.
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

When a mock is unavoidable, spread `importOriginal()` and override only the
single export under test. A replacement that answers every call (as the
`object-size.js` mock once did) can make a test variant bypass the path it
names, so it passes without exercising that path.

`git-user-lifecycle.test.ts` goes one layer further: git-fs-s3's real fetch
store talks to a fake S3 endpoint (`helpers/fake-s3-fetch.ts`), so request
signing, ListObjectsV2 parsing and server-side copy run too; it clones and
pushes with isomorphic-git over a loopback server running `serveGitRequest`.

**Native git (`pnpm smoke:git`)** — `apps/web/scripts/smoke/git-cli.smoke.test.ts`
drives the real `git` CLI against the real smart-HTTP routes at the clone URL on a loopback
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

Run every workspace suite with `pnpm test`; run one web file with
`pnpm --filter @pushstack/web test src/server/__tests__/repo-access.test.ts`.
Use `pnpm --filter @pushstack/web test:watch` or `test:coverage` for web watch/coverage runs.
Documentation integrity tests run with `pnpm --filter @pushstack/docs test`;
they check page links, navigation targets, reference examples and searchable metadata.

Config: `apps/web/vitest.config.ts` — `jsdom` by default (server suites opt into
`@vitest-environment node`), typecheck-on-test, `v8` coverage.

### What's not covered yet

Few component render tests: coverage is server logic plus pure client
helpers (e.g. `MarkdownRenderer`'s `isSafeHref`/`isSafeImageSrc`). The
high-churn routes (PR pages, tree/blob/commit viewers, upload, comment forms)
are covered only by e2e.

### Running real gh against `pnpm dev:local`

`gh` is the compatibility bar, so check it by hand against the local server.
Everything stays in a scratch directory; never use `~/.config/gh` or any git
config.

1. Start the server: `pnpm dev:local` (port 3000, data in `.pushstack-local/`).
2. Make an account: `POST /api/auth/sign-up/email`, then open the
   `verify-email` link printed in the dev:local log. Sign in with
   `POST /api/auth/sign-in/email`.
3. Mint a token. The `createToken` server function is not reachable over plain
   HTTP, so insert the row directly while the server is stopped: `tokens` with
   `token_hash` = SHA-256 hex of a `pst_…` value, and `scopes` a JSON array
   (`["repo:read","repo:write"]`).
4. gh only speaks HTTPS, so front the server with a loopback TLS proxy using a
   self-signed certificate for `localhost` (`node:https` piping to
   `localhost:3000`).
5. Run gh through a wrapper that sets, per call:
   `GH_CONFIG_DIR=<scratch dir>`, `GH_HOST=localhost:3443`,
   `GH_ENTERPRISE_TOKEN=<pst_…>` (the variable for non-github.com hosts, not
   `GH_TOKEN`), `SSL_CERT_FILE=<cert>`, `GH_DEBUG=api`, `GH_PROMPT_DISABLED=1`.
   `GH_DEBUG=api` prints each GraphQL document and its variables on stderr,
   which is how fixtures are captured.
6. Git operations (`repo create`, `pr create` with a pushed head) use a
   scratch `HOME`, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1` and
   `GIT_SSL_CAINFO=<cert>`.

Known harness limit: with gh 2.103.1, `gh pr checkout` reports that no git
remote corresponds to `GH_HOST` when the host has a port (`localhost:3443`),
even with a matching `origin`. Its GraphQL request is the same as `pr view`'s,
which the fixtures cover.

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

Race tests: a check-then-insert race needs a deliberate delay to interleave.
Hold one request between its check and its insert (a short delay in a mocked
store call, as `api-pulls.test.ts` does for the `race` head, lines 13-25) so the
unlocked version fails deterministically.

## Troubleshooting: every turbo task fails with "Exec format error"

`package.json` pins pnpm through `packageManager`, so pnpm downloads that
version into `~/.local/share/pnpm/.tools/pnpm/<version>/`. When that download
runs without lifecycle scripts, its `bin/pnpm` stays a shebang-less
placeholder script. A shell runs it fine, so `pnpm …` works, but turbo
executes it directly and the kernel answers `ENOEXEC`: every task reports
`unable to spawn child process: Exec format error (os error 8)`. Install the
native binary by running the package's own setup script once:

```bash
node ~/.local/share/pnpm/.tools/pnpm/<version>/node_modules/pnpm/install.js
```

The first four bytes of `bin/pnpm` are then `\x7fELF`.

Tests that are heavy by nature (pglite boots, thousands of git objects) set
an explicit per-test timeout with a comment saying why. Expensive setup that
is not under test, such as the first pglite boot, belongs at module load or
in a hook, not in the first test that happens to touch it.
