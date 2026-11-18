---
title: "Testing"
description: "Vitest and Playwright layout, conventions and known gaps."
---

## Vitest

Tests live in `__tests__/` beside the code they cover.

**Behavior tests run the real stack, not module mocks**: the server functions
execute against an in-memory pglite holding the real schema (a template built
once per run, so a new schema file must be added to `SCHEMA_SOURCE_FILES` or
the cached template goes stale), the in-memory git store (`git-fs.ts` without
R2 env vars), and a faked session from `app-harness.ts`
(`signIn`/`signOut`, `createUsers`, `rejectsNotFound`). A mock silently drifts
from the code it replaces. Where one is unavoidable, spread
`importOriginal()` and override the single export under test: a replacement
that answers every call can make a variant bypass the path it names and pass
without exercising it.

`vi.mock` factories run before aliases resolve, so the setup block imports its
helpers by relative path:

```ts
vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));
vi.mock("@tanstack/react-start", () => import("../../test/server-test-utils"));
vi.mock("#/server/session", async () => (await import("../../test/app-harness")).sessionModule);
```

`git-user-lifecycle.test.ts` adds git-fs-s3's real fetch store against a fake
S3 endpoint, so signing, listing and server-side copy run too, and clones and
pushes with isomorphic-git over a loopback `serveGitRequest`. `pnpm smoke:git`
drives the real `git` CLI against the real smart-HTTP routes; it is kept out of
`pnpm test` and always runs with a scratch `HOME`/`GIT_CONFIG_GLOBAL` and
`GIT_CONFIG_NOSYSTEM=1`, so it can never read or write your git config.

```bash
pnpm test                                          # every workspace suite
pnpm --filter @pushstack/web test src/server/__tests__/repo-access.test.ts
pnpm --filter @pushstack/web test:watch            # or test:coverage
pnpm --filter @pushstack/docs test                 # links, nav targets, examples
```

A check-then-insert race needs a deliberate delay to interleave: hold one
request between its check and its insert, so the unlocked version fails
deterministically. Tests that are heavy by nature set an explicit per-test
timeout with a comment saying why, and expensive setup not under test belongs
at module load or in a hook.

Known gap: few component render tests. Coverage is server logic plus pure
client helpers; the high-churn routes (pull request pages, tree/blob/commit
viewers, upload, comment forms) are covered only by e2e.

## Playwright

`apps/web/e2e/` covers auth, navigation, repositories and the git CLI path.
Config is `apps/web/playwright.config.ts`; `pnpm test:e2e` (`:ui`, `:headed`)
runs it. Two rules before touching it:

- It loads `.env.local` directly, into both the dev server and the test files,
  and creates and deletes users — point it at a dev database, never production.
  The helpers refuse a non-local `DATABASE_URL` unless `E2E_ALLOW_REMOTE_DB=1`
  because `.env.local` is the file most likely to point at a real one.
- It runs with one worker on purpose: all specs share one dev server, one
  database and one auth rate limiter, and parallel workers produced contention
  that looked like flaky rate-limit failures and let hydration lag behind input.

## Checking compatibility with real gh

`gh` is the compatibility bar, so check it by hand against `pnpm dev:local`
(port 3000, data in `.pushstack-local/`, verification links printed to the log),
working from a scratch directory and never `~/.config/gh`:

1. Sign up with `name`, `email`, `password`, `username`, then `GET` the last
   `verify-email` link from the log with a cookie jar before signing in.
2. Mint a token by inserting its row into `tokens` (SHA-256 of a `pst_` value)
   with the server stopped: `createToken` has no plain-HTTP path. `"user"` is
   the Better Auth table and `username` holds the account name.
3. `gh` only speaks HTTPS, so front the server with a TLS proxy on 3443 and a
   self-signed certificate for `localhost`.
4. Per call set `GH_CONFIG_DIR`, `GH_HOST=localhost:3443`,
   `GH_ENTERPRISE_TOKEN` (not `GH_TOKEN` — that is for github.com),
   `SSL_CERT_FILE` and `GH_DEBUG=api`, which prints each GraphQL document and
   its variables; that is how fixtures are captured. Git operations need a
   scratch `HOME`, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1` and
   `GIT_SSL_CAINFO`, and push over the token URL.

Also worth a manual pass on a real deployment: open, comment on, close and
reopen an issue and a pull request, then merge a pull request whose body has
`Closes #N`. Closing keywords, the shared `#N` sequence and the merge only
prove themselves together.

## Lint, format, typecheck

```bash
pnpm check      # Biome lint + format check (CI gate)
pnpm format     # Biome format, writes changes
pnpm typecheck  # tsc --noEmit
```

## CI

`.github/workflows/ci.yml` runs one job per turbo task, so a failure names the
task and the jobs proceed in parallel. Only the `build` job on a push to `main`
writes the turbo cache; every other job restores it. That asymmetry is
deliberate: GitHub scopes a cache written by a `pull_request` run to that PR's
merge ref, so it can only serve its own re-runs, while a cache written on
`main` is readable by every PR. The pnpm store is cached by `setup-node` and
installed with `--prefer-offline`, so an unchanged lockfile needs no registry
traffic. `pnpm audit` is the one task that skips the workspace install (the
setup action takes `install: false`), because it only reads the lockfile.

## Every turbo task fails with "Exec format error"

`package.json` pins pnpm through `packageManager`, so pnpm downloads that
version, and when the download ran without lifecycle scripts its `bin/pnpm`
stays a shebang-less placeholder: a shell runs it, but turbo executes it
directly and the kernel answers `ENOEXEC`. Run the package's own setup script
once — `node ~/.local/share/pnpm/.tools/pnpm/<version>/node_modules/pnpm/install.js`
— and the file becomes a real binary.
