# PushStack Documentation

In-depth documentation for contributors working in this codebase. Start with
[architecture.md](./architecture.md) for the big picture, then go deeper on
whichever area you're touching.

- **[Architecture](./architecture.md)** — tech stack, request flow, directory
  map, the two storage systems (Postgres/R2), the two
  extracted git-on-R2 packages this app depends on, and where to go next.
- **[Git Storage](./git-storage.md)** — how git repository data is stored in
  Cloudflare R2 and served without a native `git` binary: the R2-backed `fs`
  plugin, storage key scheme, the R2-direct write path, the
  distributed per-repo lock, and the smart HTTP protocol implementation.
  Covers pushstack's own integration layer — for the underlying library
  internals, see the [git-fs-s3](https://nandan-varma.github.io/git-fs-s3/)
  and [git-edge](https://nandan-varma.github.io/git-edge/) docs sites
  (published packages this repo depends on).
- **[Database](./database.md)** — schema tables, relations, indices, and
  `db:push`.
- **[Authentication & Access Control](./authentication.md)** — Better Auth
  session auth, git-over-HTTPS auth (personal access tokens), and the single
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

- [Submodules](./submodules.md) — clone URLs, private/nested submodules,
  browsing, pointer diffs and merge behavior.
- [Dogfood workflow](./dogfood-workflow.md) — the change that exercises the
  issue and pull-request flow end to end.
