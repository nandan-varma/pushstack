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
config. Work from a scratch directory outside the repository for the cert,
the token file and the gh config, and run the server from the repository root.

1. Start the server with its log in a scratch file:
   `mkdir -p /tmp/gh && pnpm dev:local > /tmp/gh/dev-local.log 2>&1 &`
   (port 3000, data in `.pushstack-local/`). The log prints each verification
   email, including the `verify-email` link.

2. Make an account. Sign-up requires `name`, `email`, `password` and
   `username`; the address must be verified before sign-in succeeds:

   ```sh
   curl -s -c jar -H 'content-type: application/json' -H 'origin: http://localhost:3000' \
     localhost:3000/api/auth/sign-up/email \
     -d '{"name":"Octo","email":"octo@example.test","password":"correct-horse-battery-9","username":"octo"}'
   # the dev:local log prints the verify-email link; take the last one and GET it with the cookie jar
   VERIFY_URL=$(grep -o 'http://localhost:3000/api/auth/verify-email[^ ]*' /tmp/gh/dev-local.log | tail -1)
   curl -s -o /dev/null -b jar -c jar "$VERIFY_URL"
   curl -s -c jar -b jar -H 'content-type: application/json' -H 'origin: http://localhost:3000' \
     localhost:3000/api/auth/sign-in/email -d '{"email":"octo@example.test","password":"correct-horse-battery-9"}'
   ```

3. Mint a token by inserting its row while the server is stopped (the
   `createToken` server function is not reachable over plain HTTP). Stop the
   server, then run a script outside the repository that resolves
   `@electric-sql/pglite` from the web app and writes to the same on-disk
   database:

   ```js
   // /tmp/mint.mjs — node /tmp/mint.mjs <absolute path to apps/web>
   import { createRequire } from "node:module";
   import { createHash, randomBytes } from "node:crypto";
   const web = process.argv[2];
   const require = createRequire(`${web}/package.json`);
   const { PGlite } = require("@electric-sql/pglite");
   const client = new PGlite(`${web}/.pushstack-local/db`);
   const token = `pst_${randomBytes(30).toString("base64url")}`;
   const hash = createHash("sha256").update(token).digest("hex");
   const { rows } = await client.query(`select id from "user" where username = 'octo'`);
   await client.query(
     `insert into tokens (user_id, name, token_hash, scopes) values ($1, 'gh', $2, '["repo:read","repo:write"]'::jsonb)`,
     [rows[0].id, hash],
   );
   await client.close();
   console.log(token);
   ```

   Save the printed value to a file (`/tmp/gh-token`) and restart the server.
   Note: `"user"` is the Better Auth table; the `username` column holds the
   account name.

4. gh only speaks HTTPS, so front the server with a TLS proxy on port 3443.
   Generate a self-signed certificate for `localhost` and run the proxy:

   ```sh
   mkdir -p /tmp/gh
   openssl req -x509 -newkey rsa:2048 -nodes -keyout /tmp/gh/key.pem -out /tmp/gh/cert.pem \
     -days 2 -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost"
   ```

   ```js
   // /tmp/gh/tls-proxy.mjs — node /tmp/gh/tls-proxy.mjs
   import { createServer } from "node:https";
   import { request } from "node:http";
   import { readFileSync } from "node:fs";
   createServer(
     { key: readFileSync("/tmp/gh/key.pem"), cert: readFileSync("/tmp/gh/cert.pem") },
     (req, res) => {
       const up = request(
         { host: "localhost", port: 3000, path: req.url, method: req.method, headers: req.headers },
         (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); },
       );
       up.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
       req.pipe(up);
     },
   ).listen(3443);
   ```

5. Run gh through a wrapper that sets, per call:
   `GH_CONFIG_DIR=/tmp/gh/config`, `GH_HOST=localhost:3443`,
   `GH_ENTERPRISE_TOKEN=$(cat /tmp/gh-token)` (the variable for non-github.com
   hosts, not `GH_TOKEN`), `SSL_CERT_FILE=/tmp/gh/cert.pem`, `GH_DEBUG=api`,
   `GH_PROMPT_DISABLED=1`. Example: `gh pr diff 1 -R octo/hello`.
   `GH_DEBUG=api` prints each GraphQL document and its variables on stderr,
   which is how fixtures are captured.

6. Git operations (`repo create`, `pr create` with a pushed head) use a
   scratch `HOME`, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1` and
   `GIT_SSL_CAINFO=/tmp/gh/cert.pem`. Push with
   `https://octo:$(cat /tmp/gh-token)@localhost:3443/octo/hello.git`.

`gh pr checkout` from a clone whose remote is on `localhost:3443` was observed
once to report that no remote matches `GH_HOST`. This is not reproduced or
verified with a fix; the GraphQL request it sends is the one `pr view` sends.

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
