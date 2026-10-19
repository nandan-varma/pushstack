---
title: "Deployment"
description: "Vercel and Nitro specifics and the environment variable reference."
---

## Target: Vercel, not Cloudflare

The deployment target is **Vercel**, via Nitro's `vercel` preset
(`nitro({ preset: "vercel" })` in `apps/web/vite.config.ts`) — despite Cloudflare R2
being used for object storage, this is **not** a Cloudflare Pages/Workers
deployment. Cloudflare's role here is exclusively R2 object storage via its
S3-compatible API, nothing else — there's no `@cloudflare/vite-plugin` in the
dependency tree.

Functions run on Vercel's **Node runtime** (Fluid compute). The app never
writes to the function's filesystem — every git read and write goes straight
to R2 (see [git-storage.md](/docs/internals/git-storage)) — and server code relies on Web
APIs (`fetch`, WebCrypto, `TextEncoder`, `CompressionStream`) plus
`node:async_hooks` only. Vercel's Edge runtime isn't available through this
stack: Nitro v3 removed the `vercel-edge` preset ("use `vercel` with Fluid
compute"), and its per-route `functionRules` re-link the same Node bundle.
Dependencies still assume Node in places (Better Auth's scrypt password
hashing via `node:crypto`, the Sentry Node SDK, isomorphic-git's use of the
global `Buffer`).

```bash
pnpm build    # production build
pnpm deploy   # currently just runs the build — actual deployment is via the Vercel CLI/integration
```

## `apps/web/vite.config.ts` specifics worth knowing

- `ssr.target: "node"` — the functions run Node. The app's own server code
  would build for `webworker` (it imports no `node:*` module except
  `node:async_hooks`), but dependencies above still need Node.
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
directly to/from R2. See [git-storage.md](/docs/internals/git-storage)
for the full read/write model. No operation needs a working directory —
commits and merges are built on the object graph. The Vercel function
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

# Transactional email (password reset, email verification) via Resend
RESEND_API_KEY=...
RESEND_EMAIL_FROM=you@yourdomain.com   # optional, falls back to a hardcoded address in apps/web/src/lib/email.ts

# Sentry (error tracking) — optional, the SDK no-ops without a DSN
VITE_SENTRY_DSN=...                # public DSN, safe to expose client-side (see instrument.server.mjs / apps/web/src/router.tsx)
SENTRY_AUTH_TOKEN=...               # build-time only, uploads source maps — unset skips this in apps/web/vite.config.ts
SENTRY_ORG=...
SENTRY_PROJECT=...
```

If any of the four `R2_*` variables above are unset, `isR2Configured()`
(`apps/web/src/lib/r2.ts`) returns `false` and `git-fs.ts` keeps git data in an
in-memory object store instead — fine for a quick local run (repositories
vanish when the dev server restarts; use a dev R2 bucket or any
S3-compatible endpoint such as MinIO via `R2_ENDPOINT` to keep them). With
`NODE_ENV=production` it refuses instead: every git operation throws "R2 is
not configured" rather than silently losing pushes.

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

Schema changes reach the database only through `pnpm db:push` (no migration
files). See [database.md](/docs/internals/database). `rate_limits` — the shared auth
rate-limiter counters ([security.md](/docs/internals/security)) — is part of that schema,
so a deploy that introduces it must have `pnpm db:push` run against the target
database *before* the code that writes to it is live; otherwise the first
rate-limited request fails against a missing table.
