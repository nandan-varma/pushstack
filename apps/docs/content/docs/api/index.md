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
| `GET /repos/{owner}/{repo}/contents/{path}` | supported | `ref` (branch, tag or sha; default branch); a file is base64 `content`, a directory an array, `{path}` empty for the root |
| `PUT`/`DELETE /repos/{owner}/{repo}/contents/{path}` | supported | write access; base64 `content` (bounded by the 1 MB API body cap), `message`, `branch` (default branch), `sha` (required to replace or delete; `409` when stale), `author`/`committer` (`date` ignored); `201` creates, `200` replaces; in an empty repository the first write creates the branch it names and makes it the default |
| `GET /repos/{owner}/{repo}/commits` | supported | `sha`, `path`, pagination; newest first; `409` for an empty repository |
| `GET /repos/{owner}/{repo}/commits/{ref}` | supported | with `stats` and up to 300 `files`; unknown ref is `422` |
| `GET /repos/{owner}/{repo}/compare/{basehead}` | supported | `base...head` (`owner:ref` sides); `status`, `ahead_by`, `behind_by`, `merge_base_commit`, up to 250 `commits` (paginated with `page`/`per_page`), up to 300 `files` |
| `GET /repos/{owner}/{repo}/git/ref/{ref}`, `.../git/matching-refs/{ref}`, `.../git/refs[/{ref}]` | supported | branches and tags; annotated tags are `type: "tag"` (unpeeled) |
| `DELETE /repos/{owner}/{repo}/git/refs/{ref}` | supported | write access; `heads/…` or `tags/…`; deleting a branch records `head_ref_deleted` on the closed pull requests it heads; a missing ref or the default branch is `422` |
| `GET /repos/{owner}/{repo}/git/commits/{sha}` | supported | full sha only |
| `GET /repos/{owner}/{repo}/git/trees/{sha}` | supported | `recursive`; up to 10,000 entries, then `truncated` |
| `GET /repos/{owner}/{repo}/git/blobs/{sha}` | supported | base64; up to 3 MB |
| `GET /repos/{owner}/{repo}/issues` | supported | returns issues **and pull requests** (a pull request carries a `pull_request` object); `state` (`open`/`closed`/`all`), `labels`, `assignee` (login, `none`, `*`), `sort` (`created`/`updated`/`comments`), `direction` |
| `POST /repos/{owner}/{repo}/issues` | supported | any signed-in reader; `title`, `body`, `labels`, `assignees` (labels/assignees need write access) |
| `GET /repos/{owner}/{repo}/issues/{number}` | supported | a pull request number returns the pull request; `closed_by` (the user who last closed it, else `null`) appears here only, not on lists; issues carry `state_reason` |
| `PATCH /repos/{owner}/{repo}/issues/{number}` | supported | the author or a writer; `title`, `body`, `state`, `state_reason` (`completed` default, `not_planned`, `reopened`; one that contradicts the state is `422`), `labels`, `assignees`; issues only (a pull request number is `404`) |
| `GET`/`POST /repos/{owner}/{repo}/issues/{number}/comments` | supported | comments of an issue or a pull request |
| `GET`/`PATCH`/`DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}` | supported | `204` on delete |
| `GET /repos/{owner}/{repo}/issues/{number}/timeline` | supported | comments, events and submitted reviews (`reviewed` items with `state`, `body`, `commit_id`, `author_association` `OWNER`/`COLLABORATOR`/`NONE`), oldest first |
| `GET /repos/{owner}/{repo}/issues/{number}/events` | supported | issue events only (no comments or reviews, as on GitHub), oldest first |
| `GET`/`POST /repos/{owner}/{repo}/issues/{number}/reactions`, `DELETE .../reactions/{reaction_id}` | supported | reactions on an issue or pull request; list filters by `content` and paginates; create is any signed-in reader (`repo:write` token), `201` when new and `200` with the existing reaction; delete (`204`) only your own reaction |
| `GET`/`POST /repos/{owner}/{repo}/issues/comments/{comment_id}/reactions`, `DELETE .../reactions/{reaction_id}` | supported | the same for an issue or pull request comment |
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
  legacy form (`base64("04:User<id>")`), as is a reaction's
  (`base64("08:Reaction<id>")`); other objects omit `node_id`.
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
  number is `404`), pull request field edits use the pulls endpoints.
- Issues and pull requests both return `assignee` (first assigned user or
  `null`) and `assignees` (all assigned users). The issues-list `assignee`
  filter applies to both kinds. PR assignment is available in the web UI;
  REST assignment mutation endpoints for PRs are not implemented.
- A closed pull request's `closed_at` is its merge time when merged, otherwise
  its last update (there is no `closed_at` column); a merged pull request is
  `state: "closed"` in the issues surface, as on GitHub.
- Issue, comment and timeline objects carry the `reactions` rollup (`url`,
  `total_count` and one count per content), as on GitHub; an issue's rollup
  counts its own reactions, not its comments'. They omit `node_id`,
  `author_association` and `performed_via_github_app`; `milestone` and
  `active_lock_reason` are always `null`, `locked` always `false`. A
  `labeled`/`unlabeled` event carries `{ name, color }`; an
  `assigned`/`unassigned` event carries a partial assignee (`login`, `name`,
  `type`) because the account isn't stored with the event.
- A label's `default` is `true` for the names in GitHub's default set; a label's
  `id` is an integer.
- Unsupported issue-list filters (`creator`, `mentioned`, `milestone`, `since`,
  `state_reason`) are ignored rather than rejected.
- Commit `author`/`committer` (account links) in branch, commit and compare
  responses are `null`; commits aren't linked to accounts by email.
  `comments_url` points at an endpoint that isn't implemented.
- Contents: only JSON responses (the `raw`/`html` media types are not
  supported; use `download_url`). Files over 1 MB have `content: ""` and
  `encoding: "none"`; a directory lists at most 1000 entries. Symlinks return
  `type: "symlink"` with `target` (`null` for a target over 4096 bytes, which
  is never read), not the linked file's content; submodules `type: "submodule"` with
  `submodule_git_url`.
- Commits list: `sha`, `path` and pagination; `author`, `committer`, `since`
  and `until` are ignored. Walks are bounded, so pages past ~10,000 commits are
  empty, and `Link` advertises one page past the current one while more
  commits exist (no exact `last`). An unknown `{ref}` on the single-commit
  endpoint is `422 No commit found for SHA`, as on GitHub. A single commit or a
  comparison lists at most 300 `files` (no file pagination) under the shared
  2 MiB patch budget.
- Compare: `base..head` is treated as `base...head`; an `owner:` prefix must
  name the repository's owner (there are no forks). `ahead_by`/`behind_by`
  come from bounded history walks (400 commits per side). `html_url`,
  `diff_url` and `patch_url` point at pages the web UI doesn't serve yet.
- Git database: trees list at most 10,000 entries (GitHub: 100,000) before
  `truncated: true`; `/git/trees/{sha}` also accepts a branch, tag or commit;
  blobs over 3 MB are `403` (GitHub: 100 MB), because responses are buffered.
  Commit `verification` is always `unsigned`. Only branch and tag refs exist.
- Pull requests: there are no forks, so `head.repo` and `base.repo` are the
  same repository and a `head` of another owner is `422`. `mergeable` is `null`
  for an open pull request (`false` once merged) and `mergeable_state` is always
  `unknown`: conflicts are only detected by the merge itself, which then answers
  `405`. `rebaseable` is `false`, `draft` always `false`, `requested_reviewers`
  empty, and `author_association`, `node_id` and `auto_merge`
  details are omitted or `null`. Creating a pull request doesn't require commits
  between the branches (the web UI doesn't either). A closed pull request whose
  head branch was deleted reports `head.sha` as 40 zeros and empty files and
  commits. File `sha`s are the blob ids at the head; there is no rename
  detection (`renamed` is never reported). A pull request's own comments are on the
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
