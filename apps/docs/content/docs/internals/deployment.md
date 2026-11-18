---
title: "Deployment"
description: "Vercel and Nitro constraints that are easy to break."
---

## Target: Vercel, not Cloudflare

Deployment is Vercel through Nitro's `vercel` preset, on the Node runtime
(Fluid compute). Cloudflare's only role is R2 object storage via its
S3-compatible API. The app never writes to the function filesystem — git reads
and writes go to R2 ([git-storage.md](/docs/internals/git-storage)) — but some
dependencies still need Node (Better Auth's scrypt, the Sentry Node SDK,
isomorphic-git's global `Buffer`), so Edge/Workers runtimes are not available.

`nitro` is pinned to an exact version in `package.json`; do not loosen it.

`nitro({ traceDeps: ["react*"] })` is load-bearing, not decorative. Rolldown's
SSR bundler wraps CJS-only transitive deps (e.g. `use-sync-external-store`'s
shim via `@tanstack/react-store`) in a shim whose internal `require("react")`
can't be statically rewritten and falls back to a runtime `createRequire`; the
traced bundle then has no `node_modules/react` and every SSR request fails with
`Cannot find module 'react'`. `traceDeps` copies the package into the bundle.
If the same failure appears for another package (stack trace in
`rolldown-runtime-*.mjs`, routes `/__server`), add that package the same way.

## Configuration

Environment variables are documented in `apps/web/.env.example`; copy it to
`apps/web/.env.local` for local work and run `pnpm db:push` before `pnpm dev`.

With the four `R2_*` variables unset, git data goes to an in-memory store, so it
disappears on restart. That fallback is for local runs only: under
`NODE_ENV=production` a missing configuration throws "R2 is not configured"
rather than silently losing pushes.

Schema changes reach the database only through `pnpm db:push`
([database.md](/docs/internals/database)). A deploy that adds a table the code
writes to must push the schema to the target database *first*; otherwise the
first request fails against a missing relation.

## Crawler traffic

Repo views (`blob`, `blame`, `raw`, `tree`, `commit`, `archive`) render in a
serverless function and their HTML is not CDN-cacheable (per-request CSP nonce,
session-dependent content), so a crawler walking blame pages can exhaust a
Hobby plan's Fluid Active CPU. `robots.txt` and an `X-Robots-Tag` header refuse
well-behaved crawlers; the rest is blocked in the Vercel Firewall project
settings (not in git): AI Bots denied, Bot Protection log-only — a challenge
would break `git` and `gh` — a crawler user-agent rule, and a 120/min per-IP
limit on those views. Generic HTTP-client agents are deliberately allowed:
scripts use them against the REST API. `raw` and `archive` set their own
`Cache-Control` (immutable for commit-pinned URLs, 60-second `s-maxage` for
branches).

## Monorepo hosting

Two Vercel projects build from `main`: `pushstack` (root `apps/web`) and
`pushstack-docs` (root `apps/docs`), both Node 24, both including source files
outside the project root and building through the filtered Turbo command in
their own `vercel.json`. The Vercel API accepts those two settings on the
project *update* endpoint, not on create.
