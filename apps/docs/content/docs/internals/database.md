---
title: "Database"
description: "Tables, relations, indices and db:push."
---

Neon (serverless Postgres) via `@neondatabase/serverless`, accessed through
Drizzle ORM. ORM and Kit use the same 1.0 RC version. Two schema files define the tables:

- **`apps/web/src/db/schema.ts`** — Better Auth's tables (`user`, `session`,
  `account`, `verification`).
- **`apps/web/src/db/app-schema.ts`** — the app's tables, with typed `$type` columns
  (visibility, status, role, labels, activity type/metadata) and the row
  types `Repository`, `Issue`, `PullRequest`, `CollaboratorRole`.

Git data (commits, trees, blobs, refs) lives in R2, not here — see
[git-storage.md](/docs/internals/git-storage). Postgres holds metadata only.

`apps/web/src/db/relations.ts` combines the tables with `defineRelations`, using
explicit joins and required relations for non-null foreign keys. Database
initialization passes these relations to both Neon and local pglite. Relational
queries use v2 object filters; raw subqueries must use the callback table for
correlated columns because Drizzle aliases the outer table. Better Auth receives
its auth schema explicitly in the adapter configuration. Local schema pushes use
`drizzle-kit/api-postgres`.

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

`user.apiId` is app-owned, outside Better Auth's schema: an
`integer GENERATED ALWAYS AS IDENTITY` the REST API serves as GitHub's numeric
user `id`. Better Auth never writes it (Drizzle's insert type omits it), so the
`get-tables.mjs` diff above should show it as the one extra column. Push the
schema before deploying code that selects it.

## Tables

| Table | Purpose |
|---|---|
| `user`, `session`, `account`, `verification` | Better Auth. Sessions cascade on user delete. |
| `repositories` | Name, owner, visibility, default branch, `nextIssueNumber` |
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

Every app timestamp is `timestamp with time zone` (`app-schema.ts`'s
`timestamptz()` helper). A plain `timestamp` filled by the database's `now()`
stores the session's wall-clock time, which reads back shifted by the session's
UTC offset — Neon's session is GMT so production looked fine, but pglite (local
dev, tests) and any non-UTC Postgres put every `created_at` hours off, and the
repo lock compared JS-written `expires_at` against SQL `now()` across that
offset. `apps/web/src/db/__tests__/timestamps.test.ts` pins it. Better Auth's tables are
written with JS `Date`s only and keep its own column types.

## Indices

Postgres doesn't index foreign keys on its own; the indices match real query
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
- `session_user_idx`, `account_user_idx` — Better Auth doesn't index these.

## Migrations

`pnpm db:push` is the only path: drizzle-kit diffs both schema files against
the live database and applies the difference. Editing the schema alone
changes nothing in Neon. Before applying a rollout, run
`pnpm --filter @pushstack/web db:push --explain` against the intended rollout
schema and database. It prints the SQL without applying changes; review the
complete plan for unexpected drops, rewrites, and constraints before the actual
push. For a staged replacement, keep tables still used by the deployed code in
the rollout schema so the first push is additive. Remove them only after the
replacement deployment is verified.

A change that drops or tightens columns (`NOT NULL`, unique) needs its data
fixed first. `--force` skips confirmation; it does not make destructive changes
safe or replace reviewing the `--explain` plan.

## Multi-step writes

Production uses the Neon HTTP driver, which has no interactive transactions (`db.transaction` throws). `db.batch` is atomic only for statements that do not need an id from an earlier one. For a write that spans steps, persist the root row, then delete it in a `catch` if a later step fails. Deletion cascades to child rows. `createIssueForUser`, `insertPullRequest` and `createCommentForUser` follow this pattern; `mergePullRequestBranches` reopens the pull request if recording the merge fails. `store-atomicity.test.ts` injects failures by SQL text through the test db logger.
