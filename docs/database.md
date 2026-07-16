# Database

Neon (serverless Postgres) via `@neondatabase/serverless`, accessed through
Drizzle ORM. The schema is deliberately split into two files:

- **`src/db/schema.ts`** — Better Auth's own tables (`user`, `session`,
  `account`, `verification`), plus a re-export of everything in
  `github-schema.ts` so `import { ... } from "#/db/schema"` works as a single
  entry point.
- **`src/db/github-schema.ts`** — every app-specific table: repositories,
  issues, pull requests, comments, stars, collaborators, activity feed, PATs,
  git-write transaction tracking.

Git object data (commits, trees, blobs) is **not** stored here — that's
Cloudflare R2 (see [git-storage.md](./git-storage.md)). Postgres only ever
holds metadata: who owns what, what's public/private, issue/PR/comment
content, and bookkeeping.

## Tables

| Table | Purpose |
|---|---|
| `user`, `session`, `account`, `verification` | Better Auth — accounts, sessions, credential/OAuth accounts, email verification tokens |
| `repositories` | Name, owner, visibility, default branch, `gitPath` (informational), disk usage / last-backup bookkeeping |
| `issues` | Repo-scoped issues: title, body, status, labels (jsonb array) |
| `pullRequests` | Repo-scoped PRs: source/target branch **names** (not FKs — branches are git refs, not DB rows), status, merge metadata |
| `comments` | Attached to either an issue or a PR (both nullable FKs, exactly one set) |
| `stars` | User ↔ repository, one row per star |
| `repositoryCollaborators` | Per-repo, per-user role (`read`/`write`/`admin`) — see [authentication.md](./authentication.md) for how this composes with ownership into `RepositoryAccess` |
| `activities` | Activity feed events (commit/issue/pr/star/fork/comment) with a `metadata` jsonb blob shaped per `type` |
| `tokens` | Personal Access Tokens — stores a SHA-256 `tokenHash`, never the raw token, plus scopes and expiry |
| `gitAuthAttempts` | Failed-attempt counter + window start, keyed by username/email — backs `git-auth.ts`'s password-auth rate limiter (see [security.md](./security.md)); not app data, just rate-limit state |
| `gitTransactions` | Tracks pending/abandoned git write transactions for cleanup (not a core read/write path) |

Relations for all of these are defined via Drizzle's `relations()` alongside
each table in `github-schema.ts`, so `db.query.X.findFirst({ with: {...} })`
works for the usual joins (repo ↔ owner, issue ↔ author/repository/comments,
etc.).

## Indices

Postgres does not automatically index foreign key columns, and several query
patterns filter on more than one column together — so beyond the obvious
single-column indices, there are composite ones matching actual query shapes
in the server code:

- `repo_owner_name_idx` — **unique**, not just indexed: a concurrent
  double-submit of `createRepository` must not be able to create two rows for
  the same `(ownerId, name)`, since storage keys are name-derived and
  duplicates would clobber each other's git data.
- `collab_repo_user_idx`, `star_repo_user_idx` — collaborator/star lookups are
  always "does this specific user have a row for this specific repo,"
  (repoId, userId) together, on every repo page load.
- `issue_repo_status_idx`, `pr_repo_status_idx` — issue/PR list pages filter by
  `(repoId, status)` together.
- `activity_user_created_idx`, `activity_user_repo_idx` — the activity feed's
  two main query shapes (a user's feed ordered by time; a user's activity
  scoped to one repo).
- `session_user_idx`, `account_user_idx` — session revocation and the git
  Basic-Auth credential lookup (`git-auth.ts`) both look up by `userId`, which
  Better Auth's own schema doesn't index by default.

If you add a new query that filters on more than one column of the same table
together, check whether a composite index already covers it before assuming
the existing single-column indices are enough — Postgres can use at most one
index efficiently per table per query in the common case, so `(repoId,
status)` benefits meaningfully from its own index rather than intersecting
`repo_idx` and `status_idx`.

## Migrations

Two workflows, both via `drizzle-kit`:

```bash
pnpm db:push       # push schema.ts straight to Neon, no migration files — fast, for dev
pnpm db:generate   # generate a migration file under drizzle/ from the current schema diff
pnpm db:migrate    # apply generated migration files
pnpm db:studio     # open Drizzle Studio (browse/edit data via a local UI)
```

`db:push` is the normal day-to-day flow for this project (introspects the live
DB and diffs against `schema.ts` directly) — reach for `db:generate` +
`db:migrate` only when you specifically want a committed migration file (e.g.
for a change that needs to ship through a review/CI pipeline rather than being
applied ad hoc).

After any change to `schema.ts` or `github-schema.ts`, run one of these before
the change takes effect against Neon — editing the Drizzle schema alone does
not touch the database.
