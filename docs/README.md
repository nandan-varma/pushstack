# PushStack Documentation

In-depth documentation for contributors working in this codebase. Start with
[architecture.md](./architecture.md) for the big picture, then go deeper on
whichever area you're touching.

- **[Architecture](./architecture.md)** — tech stack, request flow, directory
  map, the three storage systems (Postgres/R2/local `/tmp`), and where to go
  next.
- **[Git Storage](./git-storage.md)** — how git repository data is stored in
  Cloudflare R2 and served without a native `git` binary: the R2-backed `fs`
  plugin, storage key scheme, the hydrate → mutate → sync write path, per-repo
  locking, and the smart HTTP protocol implementation.
- **[Database](./database.md)** — schema tables, relations, indices, and the
  `db:push` vs. `db:generate`/`db:migrate` migration workflows.
- **[Authentication & Access Control](./authentication.md)** — Better Auth
  session auth, git-over-HTTPS auth (PATs, Basic Auth), and the single
  `RepositoryAccess` computation everything else checks against.
- **[Server Functions](./server-functions.md)** — a catalog of `src/server/`'s
  modules by resource (repositories, issues, PRs, comments, search, files) and
  the conventions they all follow.
- **[Performance](./performance.md)** — the caching layers front to back, the
  `perf-log` instrumentation convention used to diagnose slow requests, and
  the biggest fixes made (with the reasoning behind them, as case studies).
- **[Security](./security.md)** — the access-control model, the stored-XSS and
  path-traversal vulnerabilities found and fixed (and why the fixes are
  shaped the way they are), PAT hashing, and secret handling.
- **[Testing](./testing.md)** — unit test (Vitest) and e2e test (Playwright)
  layout, conventions, and known gaps.
- **[Deployment](./deployment.md)** — Vercel/Nitro deployment specifics and
  the full environment variable reference.

For a terser, task-oriented reference (common commands, key constraints,
gotchas), see [`../CLAUDE.md`](../CLAUDE.md) at the repo root — that file is
optimized for quick lookup while working in the code; these docs are for
understanding *why* the codebase is shaped the way it is.
