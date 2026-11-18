---
title: "Architecture"
description: "Request flow, the storage split and the boundaries a change must respect."
---

PushStack hosts Git repositories over the smart HTTP protocol, plus issues, pull
requests and a code viewer, as close to GitHub as possible. The git-on-R2
machinery lives in two independently versioned packages in `packages/`, each
with its own docs: [`git-fs-s3`](/docs/libraries/git-fs-s3/) (the R2 `fs`
plugin, smart HTTP, the git-hosting ops) and
[`git-edge`](/docs/libraries/git-edge/) (object-level three-way merge and the
parsed-object cache, used instead of isomorphic-git's `git.merge`, which needs a
checkout). This repo documents how PushStack *integrates* them, not how they
work inside; a library bug belongs in that package, released from here
([releasing.md](/docs/internals/releasing)).

## Request flow

Three kinds of request reach the app:

1. **Pages** — TanStack Start's file-based router; a route's `loader` runs
   during SSR and fills the TanStack Query cache so the first paint has data.
2. **Server functions** — `createServerFn` calls in `apps/web/src/server`,
   called like async functions; the Vite plugin turns them into RPC. See
   [server-functions.md](/docs/internals/server-functions).
3. **Git smart HTTP** — `/{owner}/{repo}.git/...`, implemented from scratch
   with isomorphic-git rather than a native git server. See
   [git-storage.md](/docs/internals/git-storage).

## Why isomorphic-git

The target is Vercel serverless functions: no bundled native binary and an
ephemeral filesystem, so shelling out to `git` is not an option. isomorphic-git's
`fs` plugin is what lets git objects be read *and written* straight in R2
without a working directory or local scratch copy. Server code uses Web APIs
plus `node:async_hooks` only.

## Two storage systems

- **Postgres** — structured metadata (users, repositories, issues, pull
  requests, comments, and the rest). Never git object data. See
  [database.md](/docs/internals/database).
- **Cloudflare R2** — git objects and refs, addressed by the canonical key
  scheme in `git-storage-naming.ts`. Nothing lives on one machine's disk, which
  is what makes serverless deployment possible; writes happen under a per-repo
  Postgres lease lock. Without R2 configured the same stack runs over an
  in-memory store. See [git-storage.md](/docs/internals/git-storage).

## Boundaries

- `apps/web/src/server/` is server-only (R2 credentials, DB connection,
  `node:async_hooks`). Nothing outside it may import it; reach it through
  server functions or the git HTTP route.
- Access decisions come only from `repo-access.ts`. Server functions and the
  git HTTP handler call through it instead of re-deriving the answer; see
  [authentication.md](/docs/internals/authentication) and
  [security.md](/docs/internals/security).
- Client query keys and options live only in `src/lib/query-options.ts`; a
  mutation invalidates a key every reader of that data must have used
  verbatim.
