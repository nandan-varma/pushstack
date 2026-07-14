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

## isomorphic-git, not a native binary

There's no native `git` binary dependency anywhere in the main request paths —
all git operations go through isomorphic-git, with a custom `fs` plugin
(`git-r2-backend.ts`) that reads/writes objects directly to/from R2. See
[git-storage.md](./git-storage.md) for the full read/write model. The one
exception: `withRepositoryWorktree` (`git-repo-storage.ts`) shells out to a
real `git` CLI against a temporary local checkout, for operations that
specifically need a real working directory. This matters for deployment
because it means the Vercel function environment needs a `git` binary
available on `PATH` for whatever code paths still call
`withRepositoryWorktree` — everything else has no such requirement.

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
