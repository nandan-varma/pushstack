# PushStack

A GitHub-compatible code forge: Git over HTTPS, repositories, issues, pull
requests, code browsing, and a REST API at `/api/v3`.

The hosted app is [git.nandan.fyi](https://git.nandan.fyi). Git objects live in
Cloudflare R2; application data lives in Neon Postgres. The server runs on
Vercel's Node runtime without native Git or persistent disk.

## Workspace

| Path | Package | Purpose |
| --- | --- | --- |
| `apps/web` | `@pushstack/web` | Product UI, REST API and Git smart HTTP |
| `apps/docs` | `@pushstack/docs` | Product, API, architecture and library documentation |
| `apps/cli` | `pstk` | `pushstack` / `pst`: auth, repositories and API requests |
| `packages/git-fs-s3` | `git-fs-s3` | Git filesystem, operations and smart HTTP over object storage |
| `packages/git-edge` | `git-edge` | Object-level three-way merging and repository caches |
| `packages/tsconfig` | `@pushstack/tsconfig` | Shared TypeScript configuration |

pnpm links internal packages explicitly with `workspace:*`. Turborepo builds
libraries before their consumers and caches each workspace's tasks. Biome is
configured once at the root. Workspace tests enforce shared dependency versions,
TypeScript configuration and validation commands.

## Run locally

Use Node 24 (`.node-version`) and pnpm 12.14.0 (`packageManager`).

```bash
npm install --global pnpm@12.14.0
pnpm install
pnpm dev:local                         # http://localhost:3000
pnpm --filter @pushstack/docs dev       # http://localhost:3001
```

Local development uses PGlite and on-disk Git under
`apps/web/.pushstack-local/`. It needs no cloud accounts, survives restarts,
and prints verification/reset email links in the terminal. The launcher blanks
R2, Resend and Sentry credentials so it does not contact those services.

To use real services, copy `apps/web/.env.example` to `apps/web/.env.local`,
set the database and auth variables, run `pnpm db:push`, then `pnpm dev`.
See the [deployment guide](https://docs.git.nandan.fyi/docs/internals/deployment)
for configuration and storage requirements.

## Commands

Run from the repository root:

```bash
pnpm build              # build every application and library
pnpm typecheck          # check every runtime workspace
pnpm test               # workspace integrity + unit and behavior tests
pnpm smoke:git          # real Git client against the smart HTTP endpoint
pnpm check              # repository-wide Biome lint and format check
pnpm lint               # workspace lint tasks
pnpm format             # format with Biome
pnpm db:push            # apply the web schema to the configured database
pnpm db:studio          # inspect the configured database
```

Target a workspace for development or a specific test:

```bash
pnpm --filter @pushstack/web test src/server/__tests__/repo-access.test.ts
pnpm --filter git-fs-s3 test
pnpm --filter @pushstack/web test:e2e
pnpm --filter pstk build
node apps/cli/dist/bin.js --help
```

The CLI is usable from this checkout. Its npm publication and trusted-publisher
setup are separate release steps; see [the CLI README](apps/cli/README.md).

## Validation and dependency policy

Behavior tests run real server functions and API handlers against PGlite with
the real schema and in-memory object storage. CLI contract tests use the same
REST dispatcher with real personal access tokens. Native Git smoke tests use a
scratch HOME and never modify the developer's global Git configuration.

CI runs typecheck, tests, production builds, Biome, the full dependency audit,
secret scanning and native Git smoke tests. Dependencies have no overrides or
ignored advisories. pnpm build scripts are explicitly allowed, bundled agent
skills are denied, and optional peers are installed only when needed.

## Documentation and releases

Documentation is authored in `apps/docs/content/docs` and served by Fumadocs.
Start with the [user guide](https://docs.git.nandan.fyi/docs/guide),
[REST compatibility matrix](https://docs.git.nandan.fyi/docs/api), or
[architecture](https://docs.git.nandan.fyi/docs/internals).
`CLAUDE.md` contains repository-specific engineering instructions.

Production deploys from `main`. Database changes use `pnpm db:push`; there are
no migration files. Library releases use annotated tags such as
`git-fs-s3@v0.15.3`, with matching package versions and changelogs, and npm trusted
publishing through `.github/workflows/release-packages.yml`. Pushed tags are
immutable: corrections get a new patch release.

## License

Copyright (C) 2026 Nandan Varma. Licensed under the
[GNU Affero General Public License v3 or later](LICENSE). Running a modified
version as a network service requires offering its corresponding source to
that service's users.
