# Testing

## Unit tests (Vitest)

Live alongside the modules they cover, in `__tests__/` directories — almost
all coverage is in `src/server/__tests__/`, since that's where the
correctness-critical logic (git protocol implementation, access control,
storage-path safety, CRUD server functions) lives. Notable files:

- `git-http-iso.test.ts`, `git-integration.test.ts` — the smart HTTP protocol
  handlers and end-to-end git operations.
- `git-user-lifecycle.test.ts` — a full user/repo lifecycle test.
- `git-operations-locking.test.ts`, `git-operations-errors.test.ts` —
  `withRepositoryLock` behavior and error propagation.
- `repo-access.test.ts` — the `RepositoryAccess` resolution logic (see
  [authentication.md](./authentication.md)).
- `git-storage-naming.test.ts`, `git-manager-iso.test.ts` — storage key
  construction and path-traversal containment (`getRepoPath`'s
  refuse-to-escape-storage-root check — see [security.md](./security.md)).
- `repositories.integration.test.ts`, `issues.test.ts`, `pull-requests.test.ts`,
  `comments.test.ts`, `search.test.ts` — CRUD server function behavior,
  including access-check rejection paths.

Run everything: `pnpm test` (or `pnpm test:watch` for watch mode, `pnpm
test:coverage` for a coverage report). Run one file:

```bash
pnpm test src/server/__tests__/repo-access.test.ts
```

Config: `vitest.config.ts` — `jsdom` environment (so component-adjacent code
can run, even though there are currently no full component-render tests —
see below), typecheck-on-test enabled, coverage via `v8`.

### Mocking conventions

Server function tests mock `@tanstack/react-start`'s `createServerFn` itself
(so a handler's `.validator` and `.handler` chain can be invoked directly as a
plain function in tests, without pulling in the real framework machinery),
plus `../session`, `../../db`, and whatever git-layer modules the function
under test calls. See `repositories.integration.test.ts` for the reference
shape of this setup. One easy-to-miss gotcha: if a test file has a `vi.mock()`
for a module and that module later gains a new export other code starts
depending on, the mock needs the new export added too, or every test hitting
that code path fails with `"No exported member ... on the mock"` — this isn't
a real regression, just the mock needing to catch up.

### What's not covered yet

There are currently no component-level render tests (nothing using React
Testing Library's render + assertions on markup) — coverage is entirely
server-side logic plus a handful of pure-function unit tests for client
utilities (e.g. `src/components/__tests__/MarkdownRenderer.test.ts` tests the
exported `isSafeHref`/`isSafeImageSrc` guard functions directly, not by
rendering the component). If you add one, it'll be the first of its kind in
this codebase — there's no existing pattern to match yet, so the setup itself
(a render helper, if one doesn't already exist) is part of the work.

## End-to-end tests (Playwright)

Live in `e2e/`: `auth.spec.ts`, `navigation.spec.ts`, `repositories.spec.ts`.

```bash
pnpm test:e2e         # headless
pnpm test:e2e:ui      # Playwright's UI mode
pnpm test:e2e:headed  # headed browser
```

Config: `playwright.config.ts`. Two things worth knowing before touching this
suite:

- It **loads `.env.local`** directly (via `dotenv`) so both the dev server it
  spins up and the test files themselves (which need direct DB access to
  verify things like test-user email state) see the same environment `pnpm
  dev` would.
- It runs **serially, one worker** (`fullyParallel: false, workers: 1`) —
  deliberately, not for lack of trying parallelism elsewhere in this
  codebase. All specs share one dev server, one real database, and one auth
  rate limiter (20 requests/60s, configured in `src/lib/auth.ts`). Running
  workers in parallel caused cross-file request contention that looked like
  flaky rate-limit false positives, and let client hydration lag behind test
  input under load. If you're adding e2e coverage and tempted to speed things
  up with more workers, this is why that's currently off.

## Lint / format / typecheck

```bash
pnpm check      # Biome lint + format check (CI gate)
pnpm lint       # Biome lint only
pnpm format     # Biome format, writes changes
pnpm typecheck  # tsc --noEmit
```

Biome (not ESLint/Prettier) — config in `biome.json`.
