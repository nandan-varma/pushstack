# Deployment

## Target: Vercel, not Cloudflare

The deployment target is **Vercel**, via Nitro's `vercel` preset
(`nitro({ preset: "vercel" })` in `vite.config.ts`) — despite Cloudflare R2
being used for object storage, this is **not** a Cloudflare Pages/Workers
deployment. `@cloudflare/vite-plugin` is a dependency, but it's not wired into
the Vite config — Cloudflare's role here is exclusively R2 object storage via
its S3-compatible API, nothing else.

This is also why `/tmp` matters so much throughout the codebase: it's the only
writable directory available at runtime on Vercel, which is why
`GIT_REPOS_PATH` (used for local git hydration during writes — see
[git-storage.md](./git-storage.md)) defaults to `os.tmpdir()/pushstack-repos`.

```bash
pnpm build    # production build
pnpm deploy   # currently just runs the build — actual deployment is via the Vercel CLI/integration
```

## `vite.config.ts` specifics worth knowing

- `ssr.target: "node"` — git operations need real Node.js APIs (`node:fs`,
  `node:path`), so the SSR target can't be `webworker`. Don't change this
  without accounting for every `node:*` import in `src/server/`.
- `nitro` is pinned to an **exact** beta version (no `^`/`~` range) in
  `package.json` — deliberate, not a typo. Don't loosen it.
- `nitro({ traceDeps: ["react*"] })` — required, not decorative. Vite/Nitro's
  Rolldown-based SSR bundler wraps CJS-only transitive deps (e.g.
  `use-sync-external-store`'s shim, pulled in by `@tanstack/react-store`) in
  a CJS-interop shim, and that shim's own internal `require("react")` call
  can't always be statically rewritten to point at the already-bundled
  `react` module — it falls back to a real runtime `require()` via
  `createRequire`. Without `traceDeps`, the deployed Vercel function ships
  only the explicitly-traced files, not a full `node_modules/react`, so that
  runtime require 404s with `Cannot find module 'react'` on **every single
  request** — this took the entire production site down (every route hits
  SSR) until traced back to this one line. `traceDeps` forces Nitro to
  physically copy `react`'s package files into the function
  bundle so the fallback require actually resolves, without needing to fix
  the bundler's interop decision itself. If a future dependency upgrade
  removes the CJS shim that trips this (or you see a similar
  `Cannot find module '<pkg>'` from a `rolldown-runtime-*.mjs` stack trace,
  routes `/__server`), the fix is the same shape: add the package to
  `traceDeps` (or narrow it once the actual offending package is identified;
  check the deployed function's `_ssr/ssr.mjs` for `__require("<pkg>")` call
  sites the way this one was found).

## isomorphic-git, not a native binary

There's no native `git` binary dependency anywhere — all git operations go
through isomorphic-git, with a custom `fs` plugin (`git-fs.ts`, built on the
published `git-fs-s3` package) that reads/writes objects
directly to/from R2. See [git-storage.md](./git-storage.md)
for the full read/write model. `withRepositoryWorktree` (`git-repo-storage.ts`)
materializes a temporary local checkout for operations that need a real
working directory, but does so with isomorphic-git's own `git.checkout`/
`git.commit`/`git.merge`, not a shelled-out CLI. The Vercel function
environment does not need a `git` binary on `PATH`.

## Environment variables

```bash
DATABASE_URL=postgresql://...                    # Neon connection string
BETTER_AUTH_SECRET=...                           # generate via: pnpm dlx @better-auth/cli secret
BETTER_AUTH_URL=http://localhost:3000            # your app's base URL

# Cloudflare R2 (S3-compatible object storage for all git data)
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=...
R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com

# Optional tuning knobs
GIT_HTTP_MAX_BODY_BYTES=52428800   # default 50MB — request body cap for git push
GIT_CACHE_MAX_SIZE=1073741824      # default 1GB — shared budget for both in-process LRU caches
GIT_CACHE_TTL=3600                 # default 1 hour (seconds)
GIT_REPOS_PATH=/path/to/dir        # default os.tmpdir()/pushstack-repos — local git hydration dir

# Transactional email (password reset, email verification) via Resend
RESEND_API_KEY=...
RESEND_EMAIL_FROM=you@yourdomain.com   # optional, falls back to a hardcoded address in src/lib/email.ts
```

If any of the four `R2_*` variables above are unset, `isR2Configured()`
(`src/lib/r2.ts`) returns `false` and the app falls back to storing git data
directly on local disk (`GIT_REPOS_PATH`) instead of R2 — useful for local
development without an R2 bucket, not recommended for a real deployment (local
disk on Vercel doesn't persist between invocations).

Local setup:

```bash
cp .env.example .env.local
pnpm dlx @better-auth/cli secret   # generate BETTER_AUTH_SECRET
# fill in .env.local
pnpm db:push                       # apply schema to your database
pnpm install
pnpm dev
```

## Database

Migrations against the real database only happen via `pnpm db:push` (fast,
no migration files — the normal day-to-day flow) or `pnpm db:generate &&
pnpm db:migrate` (produces committed migration files under `drizzle/`). See
[database.md](./database.md).
