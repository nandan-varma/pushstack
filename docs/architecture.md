# Architecture

PushStack is a code hosting platform: Git repository hosting (full smart HTTP protocol),
issue tracking, pull requests, and a code/diff viewer. This document covers the
system's overall shape — how a request flows through the app, and how the major
pieces fit together. For deep dives on any one piece, see the other files in `docs/`.

## Tech stack

| Concern | Choice |
|---|---|
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
| Deployment | Vercel, via Nitro's `vercel` preset |

Why isomorphic-git instead of shelling out to a real `git` binary: the deployment
target is Vercel serverless functions, where a bundled native binary isn't a
realistic option and the filesystem is ephemeral. isomorphic-git's `fs` plugin
interface is also what makes it possible to read git objects directly from R2
without ever touching local disk (see [git-storage.md](./git-storage.md)).

## Request flow

There are three distinct kinds of requests this app serves:

1. **Page requests** (`/repo/:owner/:name/...`, `/dashboard`, etc.) — handled by
   TanStack Start's file-based router (`src/routes/`). Each route can define a
   `loader` that runs server-side during SSR and populates the TanStack Query
   cache before the page ever reaches the client, so pages arrive with data
   already rendered instead of showing loading skeletons on first paint.
2. **Server function calls** (`createServerFn`) — typed RPC-style functions
   defined in `src/server/*.ts`, called directly from route loaders/components
   like normal async functions. TanStack Start's Vite plugin transforms these
   into real HTTP calls under the hood; the calling code never sees a fetch.
3. **Git smart HTTP protocol** (`/api/git/:owner/:repo.git/...` via the
   catch-all `src/routes/api/git.$.ts`) — this is what `git clone`, `git
   fetch`, and `git push` actually talk to. It's a from-scratch implementation
   of the [Git HTTP smart protocol](https://git-scm.com/docs/http-protocol)
   using isomorphic-git, not a native git server. See
   [git-storage.md](./git-storage.md) for the protocol handler details.

## Directory map

```
src/
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

`src/server/` is the one directory with a hard boundary: nothing in it is safe
to import from client code (it touches R2 credentials, the DB connection, and
Node-only APIs like `node:fs`). Everything in it is reached exclusively through
`createServerFn` handlers or the git HTTP route handler.

## The three storage systems

PushStack deliberately keeps three separate persistence layers, each doing the
job it's actually good at:

- **Postgres (Neon)** — structured metadata: users, repositories (name, owner,
  visibility), issues, pull requests, comments, stars, collaborators, activity
  feed, PATs. Never git object data. See [database.md](./database.md).
- **Cloudflare R2** — the actual git object data (commits, trees, blobs, packs,
  refs) for every repository, addressed by a canonical key scheme (see
  [git-storage.md](./git-storage.md)). This is what makes horizontal
  scaling/serverless deployment possible — no repository data lives on any
  one machine's disk.
- **Local `/tmp`** — a scratch layer. Write operations (push, in-browser file
  edits, merges) can't be done purely against R2 object-by-object the way
  isomorphic-git expects a real filesystem to behave, so they hydrate the
  relevant repository down to local disk first, perform the write with a real
  `fs`, then sync the result back up to R2. This is transient by design: `/tmp`
  is the only writable directory on Vercel, and nothing durable is assumed to
  survive there between requests.

## Access control

Every repository has a `visibility` (`public`/`private`) and an owner, plus
optional per-user collaborator roles (`read`/`write`/`admin`). All of that
collapses into one `RepositoryAccess` computation
(`src/server/repo-access.ts`) — this is the single place in the codebase that
decides whether a given user can read/write/moderate a given repo, and every
server function and the git HTTP handler both call through it rather than
re-deriving the answer. See [authentication.md](./authentication.md) for the
full role/permission model.

## Where to go next

- [git-storage.md](./git-storage.md) — the R2-backed git storage layer, smart HTTP protocol, caching
- [database.md](./database.md) — schema, relations, indices, migrations
- [authentication.md](./authentication.md) — Better Auth, PATs, access control roles
- [server-functions.md](./server-functions.md) — server function modules by resource
- [performance.md](./performance.md) — caching layers and the perf-log instrumentation convention
- [security.md](./security.md) — the security model and invariants that must not be violated
- [testing.md](./testing.md) — test layout and conventions
- [deployment.md](./deployment.md) — Vercel/Nitro/R2 deployment and environment variables
