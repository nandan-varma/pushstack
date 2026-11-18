---
title: "Database"
description: "Postgres via Drizzle: schema rules, migrations and multi-step writes."
---

Neon serverless Postgres behind `@neondatabase/serverless`, through Drizzle.
It holds metadata only: commits, trees, blobs and refs live in R2 (see
[git-storage.md](/docs/internals/git-storage)).

## Schema rules

- `schema.ts` is Better Auth's tables and is kept in sync by hand. A mismatch
  fails at request time only, so `build`, `typecheck` and `test` stay green
  through it: 1.7.2 added a required `account.issuer` column and 1.7.3 removed
  it, breaking every sign-in both times. **Before bumping `better-auth`, diff
  `node_modules/@better-auth/core/dist/db/get-tables.mjs` against
  `schema.ts`.**
- `user.username` is `NOT NULL` and immutable (`auth.ts` enforces both): it is
  the first segment of every storage key. `user.apiId` is app-owned, outside
  Better Auth's schema, and serves GitHub's numeric user `id`; push the schema
  before deploying code that selects it.
- Every app timestamp is `timestamptz()`: a plain `timestamp` defaulted by
  `now()` stores the session's wall clock and reads back shifted by its UTC
  offset, so pglite (dev, tests) disagreed with Neon's GMT session.
- Postgres indexes no foreign key on its own; give each one an index matching
  the query it serves. `(owner, name)` on repositories is unique because
  storage keys derive from the name.

**A pull request is an issue**, as in GitHub: one `issues` row per thread with
`is_pull_request`, plus a `pull_requests` row keyed by the issue id. Comments,
labels, assignees and timeline events point at `issues.id`, so one set of
helpers serves both kinds and deleting a thread cleans up everything under it.
A merged pull request is a closed issue whose `merged_at` is set. Both kinds
share one per-repository number sequence, claimed atomically with `UPDATE …
RETURNING` rather than app-level locking; `(repo_id, number)` is unique.

Thread reads go through `thread-store.ts`: one list query serves the web and
REST lists — a single indexed `SELECT` per page, with the total from
`count(*) over ()` and a separate count only for a page past the end.

## Migrations

`pnpm db:push` is the only path: drizzle-kit diffs the schema files against the
live database, so editing a schema alone changes nothing. Run
`pnpm --filter @pushstack/web db:push --explain` against the intended rollout
schema and review the whole plan for unexpected drops and rewrites; a change
that drops or tightens columns needs its data fixed first. `--force` only skips
confirmation.

## Multi-step writes

The Neon HTTP driver has no interactive transactions (`db.transaction` throws)
and pglite has no `db.batch`, so a write spanning steps picks a rule by where a
failure lands:

- **Before it commits**: persist the root row and delete it in a `catch`, which
  cascades. Cleanup is best-effort — log its failure at error level and rethrow
  the original error — so a duplicate-free retry depends on cleanup succeeding.
- **Rows that must agree** (one latest release): clear the others first, write,
  then restore the cleared rows in the `catch`, logging a failed restore rather
  than throwing. Writes are not serialized, so two concurrent creates with
  `make_latest` can still both leave a latest release.
- **After it commits**: follow-ups (timeline, activity, notifications,
  cross-references, closing linked issues) run through `bestEffort`, logged at
  error level while the request succeeds — an error for a committed change
  would make the retry fail or duplicate it.
