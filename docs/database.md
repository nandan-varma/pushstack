# Database

Neon (serverless Postgres) via `@neondatabase/serverless`, accessed through
Drizzle ORM. Two schema files, merged in `src/db/index.ts`:

- **`src/db/schema.ts`** — Better Auth's tables (`user`, `session`,
  `account`, `verification`).
- **`src/db/app-schema.ts`** — the app's tables, with typed `$type` columns
  (visibility, status, role, labels, activity type/metadata) and the row
  types `Repository`, `Issue`, `PullRequest`, `CollaboratorRole`.

Git data (commits, trees, blobs, refs) lives in R2, not here — see
[git-storage.md](./git-storage.md). Postgres holds metadata only.

## Better Auth's tables are hand-maintained

`schema.ts` is kept in sync by hand with what the installed `better-auth`
expects. It has drifted both ways: 1.7.2 added a required `account.issuer`
column (every sign-in threw until it was added), and 1.7.3 removed it again
(every sign-in threw because better-auth refused a required column it never
writes). better-auth checks the schema at request time, so `pnpm build`,
`typecheck` and `test` all stay green through such a mismatch. **Before
bumping `better-auth`, diff `node_modules/@better-auth/core/dist/db/get-tables.mjs`
against `schema.ts`.**

`user.username` is `NOT NULL` and never changes (`auth.ts`'s database hooks
require it on create and refuse it on update): it's the first segment of
every storage key.

## Tables

| Table | Purpose |
|---|---|
| `user`, `session`, `account`, `verification` | Better Auth. Sessions cascade on user delete. |
| `repositories` | Name, owner, visibility, default branch, `nextIssueNumber` |
| `issues` | Title, body, status, labels (`string[]`, default `[]`), `number` |
| `pullRequests` | Source/target branch **names** (branches are git refs, not rows), status, merge metadata, `number` |
| `comments` | On exactly one issue or pull request |
| `stars` | Unique per (repo, user) |
| `repositoryCollaborators` | Role `read`/`write`/`admin`, unique per (repo, user) — see [authentication.md](./authentication.md) |
| `activities` | Feed events: `type` + `metadata` together form one `ActivityEvent` (`src/lib/activity-types.ts`) |
| `tokens` | Personal access tokens: SHA-256 hash, scopes, expiry |
| `repoLocks` | The per-repo write lease (`git-repo-lock.ts`); see [git-storage.md](./git-storage.md#locking) |

**Issues and pull requests share one number sequence per repo**, like GitHub.
`claimNextIssueOrPrNumber` (`repositories.ts`) claims one with
`UPDATE … SET next_issue_number = next_issue_number + 1 RETURNING`, which is
atomic across serverless instances without app-level locking; `(repoId,
number)` is unique on both tables. Routes (`/issues/$id`, `/pulls/$id`) carry
this number and resolve it with `getIssueByNumber`/`getPullRequestByNumber`;
mutations take the row `id` from the loaded row. Activity metadata stores
the number too.

## Timestamps

Every app timestamp is `timestamp with time zone` (`app-schema.ts`'s
`timestamptz()` helper). A plain `timestamp` filled by the database's `now()`
stores the session's wall-clock time, which reads back shifted by the session's
UTC offset — Neon's session is GMT so production looked fine, but pglite (local
dev, tests) and any non-UTC Postgres put every `created_at` hours off, and the
repo lock compared JS-written `expires_at` against SQL `now()` across that
offset. `src/db/__tests__/timestamps.test.ts` pins it. Better Auth's tables are
written with JS `Date`s only and keep its own column types.

## Indices

Postgres doesn't index foreign keys on its own; the indices match real query
shapes:

- `repo_owner_name_idx` — **unique** (owner, name): storage keys derive from
  the name, so two rows must never share one.
- `star_repo_user_idx`, `collab_repo_user_idx` — **unique** (repo, user),
  the lookup on every repo page, and what makes star/collaborator writes
  idempotent.
- `issue_repo_number_idx`, `pr_repo_number_idx` — unique (repo, number).
- `issue_repo_status_idx`, `pr_repo_status_idx` — list pages filter by both.
- `activity_user_created_idx`, `activity_repo_created_idx` — feeds by user
  or repo, newest first.
- `repo_visibility_idx`, `repo_name_idx` — search and public listings.
- `session_user_idx`, `account_user_idx` — Better Auth doesn't index these.

## Migrations

`pnpm db:push` is the only path: drizzle-kit diffs both schema files against
the live database and applies the difference. Editing the schema alone
changes nothing in Neon. A change that drops or tightens columns (`NOT
NULL`, unique) needs its data fixed first, then `db:push --force`.
