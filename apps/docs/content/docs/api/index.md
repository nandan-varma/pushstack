---
title: "REST API compatibility"
description: "The GitHub-compatible REST API at /api/v3: auth, pagination, the endpoint matrix and differences from GitHub."
---

PushStack serves a GitHub-compatible REST API, so scripts, Octokit and
`gh`-style tools can work against it by changing the base URL. It mirrors
GitHub Enterprise's layout.

- **Base URL**: `https://git.nandan.fyi/api/v3`
- **Code**: `apps/web/src/routes/api/v3.$.ts` (the single route) → `apps/web/src/server/api/index.ts`
  (dispatcher and route table) → one module per resource in `apps/web/src/server/api/`.
  Handlers call the same plain server modules the server functions use
  (`repository-lookup.ts`, `repo-access.ts`, `git-read.ts`,
  `repository-create.ts`), never the `createServerFn`s.

To add an endpoint: write a handler `(ctx: ApiContext) => Promise<Response>` in
the resource's module, add a row to `ROUTES` in `index.ts`, add a behavior test
in `apps/web/src/server/__tests__/api.test.ts`, and add a row to the matrix below.

## Authentication

Personal access tokens (`pst_…`, created in Settings) in the `Authorization`
header, exactly as on GitHub:

```
Authorization: token pst_…
Authorization: Bearer pst_…
```

- Anonymous requests may read public repositories.
- A malformed, unknown or expired token is `401 Bad credentials` on **every**
  route, even where an anonymous request would succeed.
- A private repository the caller can't read answers `404 Not Found`, never
  403, so it doesn't reveal that it exists.
- A token missing a needed scope gets `403 Resource not accessible by personal
  access token` (writes need `repo:write`).
- Session cookies and `Basic` credentials are not accepted here.

## Responses and errors

JSON in snake_case, timestamps ISO-8601 UTC (`2026-10-19T12:00:00Z`). Every
response carries `Content-Type: application/json; charset=utf-8` and
`X-GitHub-Media-Type: github.v3; format=json`.
Every response (errors included) carries `X-GitHub-Request-Id`, the same id
that tags the request in server logs and Sentry.

Errors follow GitHub's body:

```json
{ "message": "Not Found", "documentation_url": "https://docs.github.com/rest", "status": "404" }
```

Validation failures are `422` with `errors: [{ resource, field, code }]`
(`missing_field`, `invalid`, `custom` with a `message`). A request body that
isn't a JSON object is `400 Problems parsing JSON`; a body over 1 MiB is `413`.

## Rate limits

As on GitHub, every response (errors included) carries `X-RateLimit-Limit`,
`X-RateLimit-Remaining`, `X-RateLimit-Reset` (epoch seconds), `X-RateLimit-Used`
and `X-RateLimit-Resource`. Counters are fixed windows (default one hour) shared
by every server instance.

| Caller | Budget (default per hour) |
| --- | --- |
| Authenticated reads, per user (all of a user's tokens share it) | 5000 |
| Anonymous, per client IP | 60 |
| Authenticated mutating calls (`POST`/`PATCH`/`PUT`/`DELETE`), per user | 1000, a separate bucket |

Over the limit the answer is `403` with `Retry-After` and GitHub's body
(`"API rate limit exceeded for user ID …."`, or for the IP address when
anonymous). `GET /rate_limit` returns `{ resources: { core, git, core_write },
rate }` (`limit`, `used`, `remaining`, `reset`) and is never counted. Git over
HTTPS has its own buckets (see the internals security notes) and answers `403`
with a plain-text message. Limits are env knobs (`RATE_LIMIT_*`,
`apps/web/src/server/config.ts`). If the limiter's database is unreachable,
requests are served unmetered. Failed credentials are limited per client IP: after
30 bad tokens in a window, requests from that IP carrying credentials get `403`.

## Pagination

List endpoints take `per_page` (default 30, max 100) and `page` (from 1);
invalid values fall back to the defaults. The `Link` header carries
`rel="prev"`, `"next"`, `"last"` and `"first"` (other query parameters are
kept) and is absent when everything fits on one page. Items deeper than
10,000 are unreachable: such a page is an empty list.

## Compatibility matrix

| Endpoint | Status | Notes |
| --- | --- | --- |
| `GET /user` | supported | |
| `GET /user/{account_id}` | supported | public profile by integer id; `404` for an unknown or malformed id |
| `GET /users/{username}` | supported | |
| `GET /user/repos` | supported | `visibility`, `affiliation` (`owner`, `collaborator`), `type`, `sort`, `direction` |
| `POST /user/repos` | supported | `name`, `description`, `private`, `auto_init`, `gitignore_template`, `license_template` (templates apply only with `auto_init`, an unknown template is `422`); other fields ignored |
| `GET /users/{username}/repos` | supported | public repositories only; `sort`, `direction` |
| `GET /repos/{owner}/{repo}` | supported | |
| `GET /repos/{owner}/{repo}/branches` | supported | sorted by name |
| `GET /repos/{owner}/{repo}/branches/{branch}` | supported | branch names may contain `/` |
| `GET /repos/{owner}/{repo}/tags` | supported | version order |
| `GET /repos/{owner}/{repo}/issues` | supported | returns issues **and pull requests** (a pull request carries a `pull_request` object); `state` (`open`/`closed`/`all`), `labels`, `assignee` (login, `none`, `*`), `sort` (`created`/`updated`/`comments`), `direction` |
| `POST /repos/{owner}/{repo}/issues` | supported | any signed-in reader; `title`, `body`, `labels`, `assignees` (labels/assignees need write access) |
| `GET /repos/{owner}/{repo}/issues/{number}` | supported | a pull request number returns the pull request |
| `PATCH /repos/{owner}/{repo}/issues/{number}` | supported | the author or a writer; `title`, `body`, `state`, `labels`, `assignees`; issues only (a pull request number is `404`) |
| `GET`/`POST /repos/{owner}/{repo}/issues/{number}/comments` | supported | comments of an issue or a pull request |
| `GET`/`PATCH`/`DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}` | supported | `204` on delete |
| `GET /repos/{owner}/{repo}/issues/{number}/timeline` | supported | comments and events, oldest first |
| `GET /repos/{owner}/{repo}/issues/{number}/events` | supported | events only, oldest first |
| `GET`/`POST /repos/{owner}/{repo}/labels`, `GET`/`PATCH`/`DELETE .../labels/{name}` | supported | `color` optional (defaults to `ededed`); a duplicate name is `422 already_exists` |
| `GET`/`POST`/`PUT`/`DELETE /repos/{owner}/{repo}/issues/{number}/labels` (+ `/{name}`) | supported | write access; add and set return every label, removing one returns the rest, removing all is `204` |
| `GET /rate_limit` | supported | `resources.core`, `git` and (authenticated) `core_write`; not counted; no `search`/`graphql` |
| `GET /repos/{owner}/{repo}/pulls` | supported | `state` (`open`/`closed`/`all`; closed includes merged), `head` (`branch` or `owner:branch`), `base`, `sort` (`created`/`updated`/`popularity`/`long-running`), `direction` (GitHub's defaults) |
| `POST /repos/{owner}/{repo}/pulls` | supported | write access; `title`, `body`, `head`, `base` (`draft`, `issue`, `maintainer_can_modify` ignored); unknown or equal branches and an already-open pull request are `422` |
| `GET`/`PATCH /repos/{owner}/{repo}/pulls/{number}` | supported | `PATCH`: the author or a writer; `title`, `body`, `state`; changing `base` is `422` |
| `GET`/`PUT /repos/{owner}/{repo}/pulls/{number}/merge` | supported | `GET` is `204` once merged, else `404`. `PUT`: `commit_title`, `commit_message`, `sha` (`409` when the head moved), `merge_method` (`merge` only; `squash`/`rebase` are `405`). A closed, merged, conflicting or review-blocked pull request is `405 Pull Request is not mergeable`. Returns `{ sha, merged, message }` |
| `GET /repos/{owner}/{repo}/pulls/{number}/files` | supported | up to 3000 files, paginated; `patch` holds the hunks (absent for binary and oversized files, and for files past a 2 MiB per-response patch budget). The whole diff is computed per request (cached for 30 seconds by the compared tips) |
| `GET /repos/{owner}/{repo}/pulls/{number}/commits` | supported | oldest first, up to 250 |
| everything else | not implemented | `404 Not Found` |

## Differences from GitHub

- User and repository `id` are integers, and a user's `node_id` is GitHub's
  legacy form (`base64("04:User<id>")`); other objects omit `node_id`.
- **`avatar_url` is `null`** when the user has no image (GitHub always has one).
- `email` on a user is always `null`, and the `email` of a commit author or
  committer is always the placeholder `noreply@<host>`: web commits carry the
  account's sign-in email, which is never exposed. Names and dates are real.
- `pushed_at` is omitted and `sort=pushed` sorts by `updated_at`.
- Repository objects carry the fields PushStack has an equivalent for:
  `id, name, full_name, private, owner, html_url, description, fork, url,
  clone_url, created_at, updated_at, default_branch, visibility, archived,
  disabled, stargazers_count, watchers_count, forks_count` and (when
  authenticated, on repo and `/user/repos`) `permissions`. `fork` is always
  `false`, `forks_count` `0`. Everything else (`topics`, `language`, `size`,
  `license`, `ssh_url`, …) is omitted.
- `GET /users/{username}/repos` ignores `type`; there are no organizations, so
  `organization_member` affiliation matches nothing and every owner is a user.
- `GET /repos/{owner}/{repo}/issues` returns issues and pull requests together,
  as the GitHub endpoint does. Get, comments, timeline, events and labels work
  on a pull request number too; editing one does not (`PATCH` at a pull request
  number is `404`), since a pull request's fields and its separate assignee
  model stay on the pulls endpoints.
- Assignees are issues-only. A pull request is never assigned, so the
  `assignee` filter's login and `*` match no pull requests, while `none` matches
  them (they are all unassigned).
- A closed pull request's `closed_at` is its merge time when merged, otherwise
  its last update (there is no `closed_at` column); a merged pull request is
  `state: "closed"` in the issues surface, as on GitHub.
- Issue, comment and timeline objects omit `node_id`, `author_association`,
  `reactions` and `performed_via_github_app`; `milestone` and
  `active_lock_reason` are always `null`, `locked` always `false`. A
  `labeled`/`unlabeled` event carries `{ name, color }`; an
  `assigned`/`unassigned` event carries a partial assignee (`login`, `name`,
  `type`) because the account isn't stored with the event.
- A label's `default` is `true` for the names in GitHub's default set; a label's
  `id` is an integer.
- Unsupported issue-list filters (`creator`, `mentioned`, `milestone`, `since`,
  `state_reason`) are ignored rather than rejected.
- Commit `author`/`committer` (account links) in a branch response are `null`;
  commits aren't linked to accounts by email. `commit.url`/`html_url` point at
  endpoints/pages that aren't implemented yet.
- Pull requests: there are no forks, so `head.repo` and `base.repo` are the
  same repository and a `head` of another owner is `422`. `mergeable` is `null`
  for an open pull request (`false` once merged) and `mergeable_state` is always
  `unknown`: conflicts are only detected by the merge itself, which then answers
  `405`. `rebaseable` is `false`, `draft` always `false`, `requested_reviewers`
  and `assignees` empty, and `author_association`, `node_id` and `auto_merge`
  details are omitted or `null`. Creating a pull request doesn't require commits
  between the branches (the web UI doesn't either). A closed pull request whose
  head branch was deleted reports `head.sha` as 40 zeros and empty files and
  commits. File `sha`s are the blob ids at the head; there is no rename
  detection (`renamed` is never reported) and `contents_url` points at an
  endpoint that isn't implemented. A pull request's own comments are on the
  issues endpoints; review endpoints are not implemented yet.
- Branch `protected` is always `false`; there is no branch protection.
- Tags have no `zipball_url`/`tarball_url`.
- `description` is limited to 500 characters (GitHub: 350 on creation, so
  anything valid there is valid here); repository names follow PushStack's
  rule (letters, digits, `.`, `-`, `_`) and an invalid name is a `422` rather
  than being rewritten to hyphens.
- Repository lookups are cached per serverless instance for a few seconds, so
  right after `POST /user/repos` another instance may briefly answer `404` for
  the new repository.
- No `X-RateLimit-*` headers, no ETag/conditional requests, no CORS headers.
