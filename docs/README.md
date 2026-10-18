# PushStack documentation

In-depth documentation, for two audiences: people **using** the deployed app at
[git.nandan.fyi](https://git.nandan.fyi), and people **changing** the code.

## Using PushStack

- **[Using PushStack](./using-pushstack.md)** — create an account and a
  repository, clone it, push with a personal access token, work with issues and
  pull requests, and the roles, limits and error responses you will meet.

## Understanding the system

Start with architecture if you are new to the codebase; the rest assume you have
read it.

- **[Architecture](./architecture.md)** — tech stack, request flow, directory
  map, the two storage systems (Postgres/R2), the two extracted git-on-R2
  packages this app depends on, and where to go next.
- **[Git Storage](./git-storage.md)** — how git data lives in Cloudflare R2 and
  is served without a native `git` binary: the R2-backed `fs` plugin, the
  storage key scheme, the R2-direct write path, the distributed per-repo lock,
  and the smart HTTP protocol. This is pushstack's integration layer; for the
  library internals see the
  [git-fs-s3](https://nandan-varma.github.io/git-fs-s3/) and
  [git-edge](https://nandan-varma.github.io/git-edge/) docs sites.
- **[Authentication & Access Control](./authentication.md)** — Better Auth
  sessions, git-over-HTTPS tokens, and the single `RepositoryAccess`
  computation everything else checks against.
- **[Database](./database.md)** — tables, relations, indices, and `db:push`.

## Working in the code

- **[Server Functions](./server-functions.md)** — a catalog of `src/server/`'s
  modules by resource, and the conventions they all follow.
- **[Security](./security.md)** — the rules that must hold: access control,
  attacker-controlled content, names and refs, auth surfaces, limits, secrets
  and dependencies.
- **[Security history](./security-history.md)** — how those rules were arrived
  at, including the vulnerabilities that produced several of them.
- **[Performance](./performance.md)** — the caching layers front to back, the
  `perf-log` instrumentation convention, and the biggest fixes with their
  reasoning.
- **[Testing](./testing.md)** — Vitest and Playwright layout, conventions, the
  manual dogfooding pass, and known gaps.
- **[Submodules](./submodules.md)** — clone URLs, private and nested submodules,
  browsing, pointer diffs and merge behavior.
- **[Deployment](./deployment.md)** — Vercel/Nitro specifics and the full
  environment variable reference.

## Conventions and quick reference

- **[CLAUDE.md](../CLAUDE.md)** — a terser, task-oriented reference: commands,
  key constraints, and gotchas, aimed at coding agents working in this repo.
- **[README.md](../README.md)** — what the project is, how to run it locally,
  and the feature list.
