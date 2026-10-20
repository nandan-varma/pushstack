---
title: "Architecture"
description: "Tech stack, request flow, directory map and the two storage systems."
---

PushStack is a code hosting platform: Git repository hosting (full smart HTTP protocol),
issue tracking, pull requests, and a code/diff viewer. This document covers the
system's overall shape — how a request flows through the app, and how the major
pieces fit together. For deep dives on any one piece, use the other pages in this section.

## Tech stack

| Concern | Choice |
| --- | --- |
| Framework | [TanStack Start](https://tanstack.com/start) — file-based SSR router with server functions |
| Database | Neon (serverless Postgres) via `@neondatabase/serverless` |
| ORM | Drizzle |
| Auth | Better Auth |
| Git | [isomorphic-git](https://isomorphic-git.org/) — no native `git` binary dependency |
| Object storage | Cloudflare R2 (S3-compatible) |
| Email | Resend |
| Styling / UI | Tailwind CSS, shadcn/ui |
| Testing | Vitest (unit), Playwright (e2e) |
| Lint/format | Biome |
| Deployment | Vercel Functions (Node runtime, Fluid compute), via Nitro's `vercel` preset |

Why isomorphic-git instead of shelling out to a real `git` binary: the deployment
target is Vercel serverless functions, where a bundled native binary isn't a
realistic option and the filesystem is ephemeral. isomorphic-git's `fs` plugin
interface is also what makes it possible to read *and write* git objects
directly in R2 without ever touching local disk (see
[git-storage.md](/docs/internals/git-storage)). Server code uses only Web APIs plus
`node:async_hooks`, so it isn't tied to Node's filesystem, `Buffer`, or
`node:crypto`; Vercel's Edge runtime isn't an option with this stack (Nitro v3
dropped its `vercel-edge` preset in favor of Fluid compute), but nothing in
the app's own code would stop a Workers-style runtime.

## Two extracted packages, not just app code

Most of the actual git-on-R2 machinery doesn't live in this repo. It's been
extracted into two published, independently-versioned npm packages that this
app depends on and that carry their own documentation — **this repo's docs
describe how pushstack *integrates* them, not how they work internally**:

- **[`git-fs-s3`](/docs/libraries/git-fs-s3/)** — the
  R2-backed isomorphic-git `fs` plugin, the git smart-HTTP protocol
  implementation (`git-fs-s3/http`), and a higher-level "git-hosting
  operations" layer (`git-fs-s3/ops`: commits, branches, trees, diffs,
  fast-forward merges) built on top. `git-fs.ts`, `git-http.ts`, `git-read.ts`
  and `git-write.ts` in `apps/web/src/server/` are thin wrappers around this.
- **[`git-edge`](/docs/libraries/git-edge/)** — an
  object-level three-way merge (`threeWayMerge`) that never needs a worktree,
  plus a parsed-object cache. `git-write.ts`'s non-fast-forward merge
  uses this instead of isomorphic-git's own `git.merge` (which needs a real
  checked-out working directory) — see [git-storage.md](/docs/internals/git-storage).

When you
need the deep "why" behind a caching decision, a retry policy, or the merge
algorithm's edge cases, check the linked package docs first; only the
integration-specific glue (which object store backs `gitFs`, how
pushstack wires its own caches/locks around library calls) belongs in this
repo's docs. If something looks wrong in the *library's* behavior rather than
in how pushstack calls it, the fix belongs in that package's own workspace
(`packages/git-fs-s3` or `packages/git-edge`), managed in this repository and
released from it — see [releasing.md](/docs/internals/releasing).

## Request flow

There are three distinct kinds of requests this app serves:

1. **Page requests** (`/repo/:owner/:name/...`, `/dashboard`, etc.) — handled by
   TanStack Start's file-based router (`apps/web/src/routes/`). Each route can define a
   `loader` that runs server-side during SSR and populates the TanStack Query
   cache before the page ever reaches the client, so pages arrive with data
   already rendered instead of showing loading skeletons on first paint.
2. **Server function calls** (`createServerFn`) — typed RPC-style functions
   defined in `apps/web/src/server/*.ts`, called directly from route loaders/components
   like normal async functions. TanStack Start's Vite plugin transforms these
   into real HTTP calls under the hood; the calling code never sees a fetch.
3. **Git smart HTTP protocol** (`/api/git/:owner/:repo.git/...` via the
   catch-all `apps/web/src/routes/api/git.$.ts`) — this is what `git clone`, `git
   fetch`, and `git push` actually talk to. It's a from-scratch implementation
   of the [Git HTTP smart protocol](https://git-scm.com/docs/http-protocol)
   using isomorphic-git, not a native git server. See
   [git-storage.md](/docs/internals/git-storage) for the protocol handler details.

## Directory map

```text
apps/web/src/
├── routes/            # File-based routing (TanStack Start). API routes under routes/api/.
│   └── repo/           # Nested repo sub-routes (issues, pulls, blob, commit, settings, ...)
├── server/            # Server-only modules: git operations, access control, DB-backed CRUD.
│                       # Imported only inside createServerFn handlers or API route handlers.
├── db/                # Drizzle schema (Better Auth tables + app tables) and the db client.
├── lib/               # Shared utilities usable from client or server: query-options, email,
│                       # R2 client/operations, git URL parsing, perf logging, etc.
├── components/        # Reusable UI components, including shadcn/ui primitives in components/ui.
├── hooks/             # Custom React hooks.
└── integrations/      # Better Auth client wiring and TanStack Query provider setup.
```

`apps/web/src/server/` is the one directory with a hard boundary: nothing in it is safe
to import from client code (it touches R2 credentials and the DB connection,
and is the only place that reaches for a Node built-in — `node:async_hooks`, in
`perf-log.ts`). Everything in it is reached exclusively through
`createServerFn` handlers or the git HTTP route handler.

## The two storage systems

PushStack deliberately keeps two separate persistence layers, each doing the
job it's actually good at:

- **Postgres (Neon)** — structured metadata: users, repositories (name, owner,
  visibility), issues, pull requests, comments, stars, collaborators, activity
  feed, PATs. Never git object data. See [database.md](/docs/internals/database).
- **Cloudflare R2** — the actual git object data (commits, trees, blobs, packs,
  refs) for every repository, addressed by a canonical key scheme (see
  [git-storage.md](/docs/internals/git-storage)). This is what makes horizontal
  scaling/serverless deployment possible — no repository data lives on any
  one machine's disk. Writes (push, in-browser file edits, merges) go straight
  to R2 too, under a per-repo Postgres lease lock — there is no local scratch
  copy. Without R2 configured (tests, a quick local run) the same stack runs
  over an in-memory store.

## Access control

Every repository has a `visibility` (`public`/`private`) and an owner, plus
optional per-user collaborator roles (`read`/`write`/`admin`). All of that
collapses into one `RepositoryAccess` computation
(`apps/web/src/server/repo-access.ts`) — this is the single place in the codebase that
decides whether a given user can read/write/moderate a given repo, and every
server function and the git HTTP handler both call through it rather than
re-deriving the answer. See [authentication.md](/docs/internals/authentication) for the
full role/permission model.

## Where to go next

- [git-storage.md](/docs/internals/git-storage) — the R2-backed git storage layer, smart HTTP protocol, caching
- [git-fs-s3 docs](/docs/libraries/git-fs-s3/) / [git-edge docs](/docs/libraries/git-edge/) — the extracted packages' own internals (see above)
- [database.md](/docs/internals/database) — schema, relations, indices, migrations
- [authentication.md](/docs/internals/authentication) — Better Auth, PATs, access control roles
- [server-functions.md](/docs/internals/server-functions) — server function modules by resource
- [performance.md](/docs/internals/performance) — caching layers and the perf-log instrumentation convention
- [security.md](/docs/internals/security) — the security model and invariants that must not be violated
- [testing.md](/docs/internals/testing) — test layout and conventions
- [deployment.md](/docs/internals/deployment) — Vercel/Nitro/R2 deployment and environment variables
- [releasing.md](/docs/internals/releasing) — versioning, tagging and publishing the npm packages

## Workspace tooling

The repository contains `apps/web`, `apps/docs`, `apps/cli`, the two Git libraries,
and the private `packages/tsconfig` configuration package. Runtime workspaces
share compiler options and expose `build`, `typecheck`, `test` and `lint`.
Internal dependencies use `workspace:*`; Turbo builds dependencies before consumers.
Lint tasks include the root Biome configuration in their cache inputs.

Root `pnpm test` runs workspace integrity checks before the behavior suites.
Those guards reject dependency version drift, missing validation commands and
registry ranges for internal packages, and they check the workflow policy:
every action pinned to a commit SHA, Node installed from `.node-version`, and
dependencies installed through the shared `.github/actions/setup` action. Web
test concurrency is bounded because each behavior worker starts a Postgres WASM
instance.

Three workspaces are published to npm; [releasing.md](/docs/internals/releasing)
covers the tag formats, the trusted-publisher setup and the release workflow.
