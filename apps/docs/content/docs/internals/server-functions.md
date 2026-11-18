---
title: "Server functions"
description: "The conventions every createServerFn module in apps/web/src/server follows."
---

Almost every module in `apps/web/src/server` exposes its public surface as
`createServerFn` calls — TanStack Start's way of defining a function that runs
server-side but is called from route/component code like an async function.

## Conventions

- **Export only server functions and types.** The client loads the file too,
  with each `createServerFn` replaced by an RPC stub, but any other runtime
  export drags the file's top-level imports (the DB client,
  `AsyncLocalStorage`) into the browser and breaks hydration in dev. Shared
  helpers go in a server-only module such as `repository-lookup.ts`, or in
  `apps/web/src/lib/` if pure. `server-fn-exports.test.ts` enforces this.
- **Validate**: every server function has a `.validator(...)` with a Zod
  schema; never assume `data` is the right shape. Ref, path and commit-sha
  fields use the `safe*Schema` validators, never a bare `z.string()`.
- **Access** only through `repo-access.ts`'s helpers: reads
  `readWithAccess(label, repoId, fn)`, writes `writeWithAccess(repoId, fn)`,
  owner-only actions `requireOwner`; a handler that already loaded the repo
  through a relation calls `getAccessForRepository`. See
  [authentication.md](/docs/internals/authentication).
- **Public fields only**: a user row leaving the server goes through
  `publicUserFields` (id, username, name, image) — never email.
- **Missing is `notFound()`**, including a private row the caller cannot read.
  Never a 500, and never a 403 that confirms existence.
- **Feed mutations** call `recordActivity(userId, repoId, event)` with a typed
  `ActivityEvent`.
- **Read paths are instrumented**: `readWithAccess` opens the perf context;
  wrap meaningfully-awaited sub-steps in `perfStep`
  ([performance.md](/docs/internals/performance)).

## Client side

Every reading server function has a matching `xQueryOptions(...)` factory in
`src/lib/query-options.ts`, and every key comes from its `queryKeys` object —
never inline a key string, or invalidation silently stops matching. Loaders
`ensureQueryData` during SSR; components then read the same cache. Stale times
are tiered by how often the data actually changes
([performance.md](/docs/internals/performance)).
