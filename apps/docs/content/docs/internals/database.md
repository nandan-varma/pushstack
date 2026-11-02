---
title: "Database"
description: "Tables, relations, indices and migrations."
---

Cloudflare D1 (SQLite), bound to the Worker as `DB` and accessed through Drizzle
ORM's `drizzle-orm/d1` client. ORM and Kit use the same 1.0 RC version. Two schema files define the tables:

- **`apps/web/src/db/schema.ts`** — Better Auth's tables (`user`, `session`,
  `account`, `verification`).
- **`apps/web/src/db/app-schema.ts`** — the app's tables, with typed `$type` columns
  (visibility, status, role, labels, activity type/metadata) and the row
  types `Repository`, `Issue`, `PullRequest`, `CollaboratorRole`. Both files
  use drizzle's `sqlite-core` types.

Git data (commits, trees, blobs, refs) lives in R2, not here — see
[git-storage.md](/docs/internals/git-storage). D1 holds metadata only.

`apps/web/src/db/relations.ts` combines the tables with `defineRelations`, using
explicit joins and required relations for non-null foreign keys. Database
initialization in `apps/web/src/db/index.ts` passes these relations to the D1
client. Relational queries use v2 object filters; raw subqueries must use the
callback table for correlated columns because Drizzle aliases the outer table.
Better Auth receives its auth schema explicitly in the adapter configuration.

Column conventions: booleans are integers 0/1 (`integer({ mode: "boolean" })`),
timestamps are epoch milliseconds (`integer({ mode: "timestamp_ms" })`), JSON
columns are `text({ mode: "json" })`, and ids are integer autoincrement or text.

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

`user.apiId` is app-owned, outside Better Auth's schema: an integer the REST API
serves as GitHub's numeric user `id`. SQLite cannot auto-increment a column that
is not the primary key, so an AFTER INSERT trigger assigns it from a sequence
table (the hand-written migration `user_api_id`). Better Auth never writes it
(Drizzle's insert type omits it), so the `get-tables.mjs` diff above should show
it as the one extra column. Apply the migrations before deploying code that
selects it.

## Tables

| Table | Purpose |
|---|---|
| `user`, `session`, `account`, `verification` | Better Auth. Sessions cascade on user delete. |
| `repositories` | Name, owner, visibility, default branch, `nextIssueNumber`. A fork has `is_fork` and `fork_of_id` (its parent, `on delete set null`, so `is_fork` outlives the parent) |
| `issues` | **Every issue and pull request**: title, body, status (`open`/`closed`), `state_reason`, `closed_at`, `closed_by_id`, repository-scoped `number`, `is_pull_request` |
| `pullRequests` | Only what a pull request adds, 1:1 by `issue_id`: source/target branch **names** (branches are git refs, not rows) and merge metadata (`merged_at`, `merged_by`, merge commit, merged range) |
| `labels`, `threadLabels` | Repository labels and their application to an issue (`issue_id`) |
| `milestones` | Repository milestones (`number` is its own per-repo sequence, `repositories.next_milestone_number`); an issue or pull request carries at most one through `issues.milestone_id` (`on delete set null`) |
| `threadAssignees` | Users assigned to an issue or pull request, unique per (`issue_id`, user) |
| `comments`, `timelineEvents` | On an issue or pull request (`issue_id`) |
| `pullRequestReviews`, `pullRequestReviewComments` | On a pull request (`pull_request_id` → `pull_requests.issue_id`) |
| `stars` | Unique per (repo, user) |
| `repositoryCollaborators` | Role `read`/`write`/`admin`, unique per (repo, user) — see [authentication.md](/docs/internals/authentication) |
| `activities` | Feed events: `type` + `metadata` together form one `ActivityEvent` (`apps/web/src/lib/activity-types.ts`) |
| `tokens` | Personal access tokens: SHA-256 hash, scopes, expiry |
| `repoLocks` | The per-repo write lease (`git-repo-lock.ts`); see [git-storage.md](/docs/internals/git-storage#locking) |

**A pull request is an issue**, as in GitHub's data model: one `issues` row
per thread (with `is_pull_request`), plus a `pull_requests` row keyed by the
issue id for a pull request. Comments, labels, assignees and timeline events
reference `issues.id` with real foreign keys (cascading), so one set of
helpers serves both kinds and deleting a thread or repository cleans up
everything under it. A merged pull request's issue is `closed`;
`pull_requests.merged_at` is what makes it merged (the composed
`PullRequest` record in `thread-store.ts` reports `status: "merged"`).

They share one number sequence per repo. `claimNextIssueOrPrNumber`
(`repository-lookup.ts`) claims one with
`UPDATE … SET next_issue_number = next_issue_number + 1 RETURNING`, which is
atomic across serverless instances without app-level locking; `(repo_id,
number)` is unique on `issues`. Routes (`/issues/$id`, `/pull/$id`) carry
this number and resolve it with `getIssueByNumber`/`getPullRequestByNumber`;
mutations take the issue `id` from the loaded row (a pull request's `id` is
its issue id). Activity metadata stores the number too.

**Reads go through `thread-store.ts`.** `listThreads(filter, { sort, limit,
offset })` is the one list query, used by the web lists (`getIssues`,
`getPullRequests`) and the REST lists (`GET …/issues`, `GET …/pulls`) alike:
a single indexed `SELECT` per page joining the author and the
`pull_requests` row, with labels, assignees, `closed_by`, `merged_by` and the
comment count as correlated subqueries and the total as `count(*) over ()`
(a separate count runs only for a page past the end). `findThread`/
`findThreads` are the same query by number. The filter covers GitHub's
query syntax (`thread-search.ts` maps a parsed `?q=` onto it) and the REST
parameters (`state`, `labels`, `assignee`, `head`, `base`, `sort`,
`direction`). `thread-query-count.test.ts` pins the database round trips
per list and detail read.

## Timestamps

Every app timestamp is an integer count of epoch milliseconds
(`integer({ mode: "timestamp_ms" })` in `app-schema.ts`), written by JavaScript.
Raw SQL that needs the clock uses `nowMs` from `apps/web/src/db/sql.ts`, so
the database clock and the application clock are the same number, such as the
repo lock's `expires_at` comparison.

## Indices

SQLite doesn't index foreign keys on its own; the indices match real query
shapes:

- `repo_owner_name_idx` — **unique** (owner, name): storage keys derive from
  the name, so two rows must never share one.
- `star_repo_user_idx`, `collab_repo_user_idx` — **unique** (repo, user),
  the lookup on every repo page, and what makes star/collaborator writes
  idempotent.
- `issue_repo_number_idx` — unique (repo, number): the shared `#N`.
- `issue_repo_state_created_idx`, `issue_repo_state_updated_idx` — the REST
  issues list (both kinds) by state, sorted by created or updated.
- `issue_repo_kind_state_created_idx`, `issue_repo_kind_state_updated_idx` —
  the one-kind lists (web issues/pulls, REST pulls), same sorts.
- `pr_branches_idx` — the pulls list's `head`/`base` filters and the
  duplicate-PR check.
- `comment_issue_created_idx`, `timeline_issue_idx` — a thread's comments
  and events, oldest first; the comment index also serves the comment-count
  subquery. `thread_label_label_idx` and the (`issue_id`, …) primary/unique
  keys of `thread_labels`/`thread_assignees` serve the label and assignee
  filters.
- `reaction_issue_user_content_idx`, `reaction_comment_user_content_idx` —
  partial unique indexes (one reaction per user, subject and `content`; the
  issue one covers rows with a null `comment_id`). Their `issue_id` prefix
  serves the one grouped read of a thread's rollups; `reaction_user_idx`
  serves user deletes.
- `activity_user_created_idx`, `activity_repo_created_idx` — feeds by user
  or repo, newest first.
- `repo_visibility_idx`, `repo_name_idx` — search and public listings.
- `repo_fork_of_idx` — a repository's forks (`forks_count`, the fork list).
- `session_user_idx`, `account_user_idx` — Better Auth doesn't index these.

## Migrations

Schema changes are SQL migrations in `apps/web/migrations/`, one folder per
change (`<timestamp>_<name>/migration.sql`). `pnpm --filter @pushstack/web
db:generate` has drizzle-kit write the migration for the difference between the
schema files and the previous migrations. Hand-written migrations, such as
`user_api_id`, sit in the same folder layout. Editing the schema alone changes
nothing in any database.

- `db:migrate:local` runs `wrangler d1 migrations apply DB --local` against the
  simulated D1 that `pnpm dev:local` uses. Tests build their database by applying
  the same folder in order.
- `db:migrate:remote` runs `wrangler d1 migrations apply DB --remote` against the
  deployed database. Wrangler records which migrations have been applied.

Review each generated `migration.sql` before applying it. SQLite has no in-place
`ALTER COLUMN`, so a change to a column's constraints is generated as a table
rebuild; check that the rebuilt table keeps its rows and indices. A migration
that tightens columns (`NOT NULL`, unique) needs its data fixed first. Keep the
tables still used by the deployed code in place until the replacement is
deployed and verified.

## Multi-step writes

D1 has no interactive transactions, and a multi-step write cannot wrap its steps in one. A write that must be all-or-nothing is a single `db.batch`, which D1 runs as one transaction. A write whose steps cannot share a batch follows the rule below. Its rule depends on where the failure lands:

- **Before the change commits**, a failure leaves nothing behind. A write that spans steps persists its root row, then deletes it in a `catch` if a later step fails (deletion cascades to child rows). `createIssueForUser`, `insertPullRequest` and `createCommentForUser` follow this pattern, and `mergePullRequestBranches` reopens the pull request if recording the merge fails. Cleanup is best-effort: log cleanup failures at error level and rethrow the original write error. A failed cleanup can leave a row behind, so duplicate-free retries depend on successful cleanup.
- **When several rows must agree**, as with a single latest release, clear the others first, write the change, and restore the cleared rows in the `catch` if the write fails (`release-store.ts`). This holds for sequential failures. A failed restore is logged, not thrown, so if the database fails both writes the repository can be left with no latest release until one is set. Writes are not serialized, so two concurrent creates with `make_latest` can both clear the others before either inserts, and two latest releases remain possible.
- **After the change commits**, the follow-ups (timeline events, activity, notifications, cross references, closing linked issues, clearing a review request) run through `bestEffort` (`best-effort.ts`). A failure is logged at error level and the request still succeeds. Reporting an error for a committed change would make a retry fail ("already submitted") or duplicate the change. Each follow-up is attempted on its own, so one failure does not drop the others.

Comment and issue creation record activity before notifying subscribers, so an activity failure sends no notification; a failed notification removes the activity row it recorded (activities have no foreign key to the root row, so cascades do not reach them). `store-atomicity.test.ts` covers the rollbacks, simultaneous write/cleanup failures and cross-reference cleanup; `store-followups.test.ts` covers follow-up failures (the change stands and a retry is not refused) and the latest-release restores. Both inject failures by SQL text through the test db logger.
