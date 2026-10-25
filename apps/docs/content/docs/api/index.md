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
the resource's module, add the operation's route and schemas to
`packages/api-contract` and its handler to the map in `index.ts`, add a behavior
test in `apps/web/src/server/__tests__/api.test.ts`, write its note in
`packages/api-contract/src/compat.ts` and regenerate the matrix below with
`pnpm --filter @pushstack/api-contract docs:matrix` (the package's test fails
while the matrix and the contract disagree).

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
- A `repo:write` token's responses carry `X-OAuth-Scopes: read:org, repo`
  (GitHub's classic scopes; see [GraphQL API and gh](/docs/api/graphql)).

## Responses and errors

JSON in snake_case, timestamps ISO-8601 UTC (`2026-10-19T12:00:00Z`). Every
response carries `Content-Type: application/json; charset=utf-8` and
`X-GitHub-Media-Type: github.v3; format=json`.
Every response (errors included) carries `X-GitHub-Request-Id`, the same id
that tags the request in server logs and Sentry.

Repository objects include `open_issues_count`: the number of open issues and
open pull requests combined, as on GitHub. Closed and merged threads are excluded.

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

Generated from `packages/api-contract` (`src/routes.ts` and the notes in `src/compat.ts`); don't edit it by hand.

| Endpoint | GitHub operation | Notes |
| --- | --- | --- |
| `GET /` | [`meta/root`](https://docs.github.com/rest/meta/meta#github-api-root) | URL templates for the served endpoints only; gh reads `X-OAuth-Scopes` here |
| `GET /rate_limit` | [`rate-limit/get`](https://docs.github.com/rest/rate-limit/rate-limit#get-rate-limit-status-for-the-authenticated-user) | `resources.core`, `git` and (authenticated) `core_write` and `graphql`; not counted; no `search` |
| `GET /user` | [`users/get-authenticated`](https://docs.github.com/rest/users/users#get-the-authenticated-user) | |
| `GET /user/repos` | [`repos/list-for-authenticated-user`](https://docs.github.com/rest/repos/repos#list-repositories-for-the-authenticated-user) | `visibility`, `affiliation` (`owner`, `collaborator`), `type`, `sort`, `direction` |
| `POST /user/repos` | [`repos/create-for-authenticated-user`](https://docs.github.com/rest/repos/repos#create-a-repository-for-the-authenticated-user) | `name`, `description`, `private`, `auto_init`, `gitignore_template`, `license_template` (templates apply only with `auto_init`, an unknown template is `422`); other fields ignored |
| `GET /user/followers` | [`users/list-followers-for-authenticated-user`](https://docs.github.com/rest/users/followers#list-followers-of-the-authenticated-user) | pagination |
| `GET /user/following` | [`users/list-followed-by-authenticated-user`](https://docs.github.com/rest/users/followers#list-the-people-the-authenticated-user-follows) | pagination |
| `GET /user/following/{username}` | [`users/check-person-is-followed-by-authenticated`](https://docs.github.com/rest/users/followers#check-if-a-person-is-followed-by-the-authenticated-user) | `204` or `404` |
| `PUT /user/following/{username}` | [`users/follow`](https://docs.github.com/rest/users/followers#follow-a-user) | needs a `repo:write` token (there is no `user:follow` scope); `204`, idempotent; known difference: following yourself is `422` |
| `DELETE /user/following/{username}` | [`users/unfollow`](https://docs.github.com/rest/users/followers#unfollow-a-user) | needs a `repo:write` token (there is no `user:follow` scope); `204`, idempotent |
| `GET /user/subscriptions` | [`activity/list-watched-repos-for-authenticated-user`](https://docs.github.com/rest/activity/watching#list-repositories-watched-by-the-authenticated-user) | repositories you watch (not ignore) and can still read; pagination |
| `GET /user/{account_id}` | [`users/get-by-id`](https://docs.github.com/rest/users/users#get-a-user-using-their-id) | public profile by integer id; `404` for an unknown or malformed id |
| `GET /users/{username}` | [`users/get-by-username`](https://docs.github.com/rest/users/users#get-a-user) | |
| `GET /users/{username}/repos` | [`repos/list-for-user`](https://docs.github.com/rest/repos/repos#list-repositories-for-a-user) | public repositories only; `sort`, `direction` |
| `GET /users/{username}/followers` | [`users/list-followers-for-user`](https://docs.github.com/rest/users/followers#list-followers-of-a-user) | pagination |
| `GET /users/{username}/following` | [`users/list-following-for-user`](https://docs.github.com/rest/users/followers#list-the-people-a-user-follows) | pagination |
| `GET /users/{username}/following/{target_user}` | [`users/check-following-for-user`](https://docs.github.com/rest/users/followers#check-if-a-user-follows-another-user) | `204` or `404` |
| `GET /users/{username}/subscriptions` | [`activity/list-repos-watched-by-user`](https://docs.github.com/rest/activity/watching#list-repositories-watched-by-a-user) | only repositories both the user and the caller can read; pagination |
| `GET /notifications` | [`activity/list-notifications-for-authenticated-user`](https://docs.github.com/rest/activity/notifications#list-notifications-for-the-authenticated-user) | any token; unread unless `all=true`; `participating`, `since`, `before`, `per_page` (up to 50); threads in repositories you can no longer read are hidden |
| `PUT /notifications` | [`activity/mark-notifications-as-read`](https://docs.github.com/rest/activity/notifications#mark-notifications-as-read) | marks threads updated at or before `last_read_at` (default now) read and answers `205` |
| `GET /notifications/threads/{thread_id}/subscription` | [`activity/get-thread-subscription-for-authenticated-user`](https://docs.github.com/rest/activity/notifications#get-a-thread-subscription-for-the-authenticated-user) | `reason` is always `null` |
| `PUT /notifications/threads/{thread_id}/subscription` | [`activity/set-thread-subscription`](https://docs.github.com/rest/activity/notifications#set-a-thread-subscription) | `ignored: true` mutes the thread |
| `DELETE /notifications/threads/{thread_id}/subscription` | [`activity/delete-thread-subscription`](https://docs.github.com/rest/activity/notifications#delete-a-thread-subscription) | unsubscribes until you are involved again |
| `GET /notifications/threads/{thread_id}` | [`activity/get-thread`](https://docs.github.com/rest/activity/notifications#get-a-thread) | |
| `PATCH /notifications/threads/{thread_id}` | [`activity/mark-thread-as-read`](https://docs.github.com/rest/activity/notifications#mark-a-thread-as-read) | `205` |
| `DELETE /notifications/threads/{thread_id}` | [`activity/mark-thread-as-done`](https://docs.github.com/rest/activity/notifications#mark-a-thread-as-done) | `204`: the thread leaves the inbox until new activity |
| `GET /repos/{owner}/{repo}` | [`repos/get`](https://docs.github.com/rest/repos/repos#get-a-repository) | |
| `PATCH /repos/{owner}/{repo}` | [`repos/update`](https://docs.github.com/rest/repos/repos#update-a-repository) | owner or admin collaborator (`403` otherwise); `name`, `description`, `homepage`, `private`, `visibility`, `has_issues`, `has_projects`, `has_wiki`, `is_template`, `default_branch`, `archived`; other fields ignored. Renaming moves the storage; unarchiving is the only change an archived repository accepts |
| `DELETE /repos/{owner}/{repo}` | [`repos/delete`](https://docs.github.com/rest/repos/repos#delete-a-repository) | owner only (`403` otherwise); `204` |
| `GET /repos/{owner}/{repo}/topics` | [`repos/get-all-topics`](https://docs.github.com/rest/repos/repos#get-all-repository-topics) | |
| `PUT /repos/{owner}/{repo}/topics` | [`repos/replace-all-topics`](https://docs.github.com/rest/repos/repos#replace-all-repository-topics) | `names` (at most 20, lowercase letters, digits and hyphens, at most 50 characters each; invalid is `422`) |
| `POST /repos/{owner}/{repo}/transfer` | [`repos/transfer`](https://docs.github.com/rest/repos/repos#transfer-a-repository) | `new_owner` must be a user; the transfer is immediate (no pending invitation) and answers `202`; `new_name` renames; `team_ids` ignored; the old URL does not redirect |
| `POST /repos/{template_owner}/{template_repo}/generate` | [`repos/create-using-template`](https://docs.github.com/rest/repos/repos#create-a-repository-using-a-template) | the template must be readable and `is_template`; copies the template's default branch as one `Initial commit` (files only: no history, symlinks, submodules or file modes); `owner` must be the caller (no organizations); `include_all_branches` is ignored; issues, labels, topics and settings are not copied |
| `GET /repos/{owner}/{repo}/subscribers` | [`activity/list-watchers-for-repo`](https://docs.github.com/rest/activity/watching#list-watchers) | people watching (not ignoring) who can still read the repository; pagination |
| `GET /repos/{owner}/{repo}/subscription` | [`activity/get-repo-subscription`](https://docs.github.com/rest/activity/watching#get-a-repository-subscription) | `404` when you are not subscribed; `reason` is always `null` |
| `PUT /repos/{owner}/{repo}/subscription` | [`activity/set-repo-subscription`](https://docs.github.com/rest/activity/watching#set-a-repository-subscription) | `repo:write` token; `ignored: true` ignores the repository, otherwise you watch all activity; `subscribed: false` without `ignored` removes the subscription |
| `DELETE /repos/{owner}/{repo}/subscription` | [`activity/delete-repo-subscription`](https://docs.github.com/rest/activity/watching#delete-a-repository-subscription) | `repo:write` token; back to participating-only notifications |
| `GET /repos/{owner}/{repo}/notifications` | [`activity/list-repo-notifications-for-authenticated-user`](https://docs.github.com/rest/activity/notifications#list-repository-notifications-for-the-authenticated-user) | as `GET /notifications`, for one repository |
| `PUT /repos/{owner}/{repo}/notifications` | [`activity/mark-repo-notifications-as-read`](https://docs.github.com/rest/activity/notifications#mark-repository-notifications-as-read) | as `PUT /notifications`, for one repository |
| `GET /repos/{owner}/{repo}/branches` | [`repos/list-branches`](https://docs.github.com/rest/branches/branches#list-branches) | sorted by name |
| `GET /repos/{owner}/{repo}/branches/{branch}` | [`repos/get-branch`](https://docs.github.com/rest/branches/branches#get-a-branch) | branch names may contain `/` |
| `GET /repos/{owner}/{repo}/tags` | [`repos/list-tags`](https://docs.github.com/rest/repos/repos#list-repository-tags) | version order |
| `GET /repos/{owner}/{repo}/releases` | [`repos/list-releases`](https://docs.github.com/rest/releases/releases#list-releases) | newest first; drafts only for write access; `assets` lists uploaded files; pagination |
| `POST /repos/{owner}/{repo}/releases` | [`repos/create-release`](https://docs.github.com/rest/releases/releases#create-a-release) | write access (`repo:write`); `tag_name`, `target_commitish` (default branch; a missing tag is created there as a lightweight tag unless `draft`), `name`, `body`, `draft`, `prerelease`, `make_latest`, `generate_release_notes`; a published tag already used by a release is `422 already_exists`; `discussion_category_name` ignored |
| `POST /repos/{owner}/{repo}/releases/generate-notes` | [`repos/generate-release-notes`](https://docs.github.com/rest/releases/releases#generate-release-notes-content-for-a-release) | write access; a bulleted list of the commits since `previous_tag_name` (default: the tag before `tag_name`) and a `Full Changelog` compare link; no pull request grouping, `.github/release.yml` or new-contributor section |
| `GET /repos/{owner}/{repo}/releases/latest` | [`repos/get-latest-release`](https://docs.github.com/rest/releases/releases#get-the-latest-release) | the published, non-prerelease release marked `make_latest: true`, else the newest not marked `false`; `404` when there is none |
| `GET /repos/{owner}/{repo}/releases/tags/{tag}` | [`repos/get-release-by-tag`](https://docs.github.com/rest/releases/releases#get-a-release-by-tag-name) | published releases only (a draft has no public tag) |
| `GET /repos/{owner}/{repo}/releases/assets/{asset_id}` | [`repos/get-release-asset`](https://docs.github.com/rest/releases/assets#get-a-release-asset) | `Accept: application/octet-stream` streams the file with `200` (GitHub redirects with `302`) and counts a download |
| `PATCH /repos/{owner}/{repo}/releases/assets/{asset_id}` | [`repos/update-release-asset`](https://docs.github.com/rest/releases/assets#update-a-release-asset) | write access; `name`, `label` |
| `DELETE /repos/{owner}/{repo}/releases/assets/{asset_id}` | [`repos/delete-release-asset`](https://docs.github.com/rest/releases/assets#delete-a-release-asset) | write access; removes the stored file |
| `POST /repos/{owner}/{repo}/releases/assets/{asset_id}/finish` | [`repos/finish-release-asset-upload`](https://docs.github.com/rest/releases/assets) | PushStack extension: completes a presigned upload started with `POST …/assets/uploads` after the bytes were PUT to R2; the stored size must equal the declared one, else the asset is discarded and the answer is `422`; the verified object is copied to its final key, so later `PUT`s to the URL have no effect; unfinished uploads are removed after the URL's 15 minutes |
| `GET /repos/{owner}/{repo}/releases/{release_id}` | [`repos/get-release`](https://docs.github.com/rest/releases/releases#get-a-release) | drafts for write access only (`404` otherwise) |
| `PATCH /repos/{owner}/{repo}/releases/{release_id}` | [`repos/update-release`](https://docs.github.com/rest/releases/releases#update-a-release) | write access; as create; publishing a draft sets `published_at` and creates a missing tag; `make_latest: true` moves the badge |
| `DELETE /repos/{owner}/{repo}/releases/{release_id}` | [`repos/delete-release`](https://docs.github.com/rest/releases/releases#delete-a-release) | write access; the tag stays, the assets are removed from storage; `204` |
| `GET /repos/{owner}/{repo}/releases/{release_id}/assets` | [`repos/list-release-assets`](https://docs.github.com/rest/releases/assets#list-release-assets) | uploaded assets only; pagination |
| `POST /repos/{owner}/{repo}/releases/{release_id}/assets` | [`repos/upload-release-asset`](https://docs.github.com/rest/releases/assets#upload-a-release-asset) | write access; `?name=` (required) and `?label=`; the raw bytes as the body with their `Content-Type`; up to 4,000,000 bytes (a function request body is capped at 4.5 MB): larger files use the presigned flow; `upload_url` on a release points here; a name already on the release is `422 already_exists` |
| `POST /repos/{owner}/{repo}/releases/{release_id}/assets/uploads` | [`repos/create-release-asset-upload`](https://docs.github.com/rest/releases/assets) | PushStack extension for files over 4,000,000 bytes (up to 2 GiB): declares `name`, `label`, `content_type` and `size`, answers `201` with an `open` asset and a presigned R2 `upload_url` (valid 15 minutes) to `PUT` the bytes to, then `POST …/releases/assets/{asset_id}/finish`; `501` where the deployment has no R2 |
| `GET /repos/{owner}/{repo}/contents/{path}` | [`repos/get-content`](https://docs.github.com/rest/repos/contents#get-repository-content) | `ref` (branch, tag or sha; default branch); a file is base64 `content`, a directory an array, `{path}` empty for the root. Media types: `raw` (a file's bytes, up to 50 MB, `application/octet-stream`), `object` (a directory as one object with `entries`); `html` is served as JSON |
| `PUT /repos/{owner}/{repo}/contents/{path}` | [`repos/create-or-update-file-contents`](https://docs.github.com/rest/repos/contents#create-or-update-file-contents) | write access; base64 `content` (bounded by the 1 MB API body cap), `message`, `branch` (default branch), `sha` (required to replace; `409` when stale), `author`/`committer` (`date` ignored); `201` creates, `200` replaces; in an empty repository the first write creates the branch it names and makes it the default |
| `DELETE /repos/{owner}/{repo}/contents/{path}` | [`repos/delete-file`](https://docs.github.com/rest/repos/contents#delete-a-file) | write access; `message`, `branch`, `sha` (required; `409` when stale) |
| `GET /repos/{owner}/{repo}/tarball/{ref}` | [`repos/download-tarball-archive`](https://docs.github.com/rest/repos/contents#download-a-repository-archive-tar) | `302` to `/{owner}/{repo}/legacy.tar.gz/{refs/heads/branch\|refs/tags/tag\|sha}` on this origin, which streams the archive (GitHub redirects to codeload's `legacy.tar.gz`); `ref` is a branch, tag or full commit sha (default branch when omitted), `404` otherwise; entries sit under `{owner}-{repo}-{short sha}/`; submodules are empty directories; `.gitattributes` `export-ignore` and `export-subst` are not applied; up to 50,000 entries and 256 MiB, above that `413` |
| `GET /repos/{owner}/{repo}/zipball/{ref}` | [`repos/download-zipball-archive`](https://docs.github.com/rest/repos/contents#download-a-repository-archive-zip) | as `tarball`, redirecting to `legacy.zip` |
| `GET /repos/{owner}/{repo}/commits` | [`repos/list-commits`](https://docs.github.com/rest/commits/commits#list-commits) | `sha`, `path` (a file), `author`/`committer` (an email, or a login matching that account's email), `since`/`until` (committer date), pagination; newest first; `409` for an empty repository; filters search the newest 10,100 commits; `Link` has `next` but no `last` |
| `GET /repos/{owner}/{repo}/comments` | [`repos/list-commit-comments-for-repo`](https://docs.github.com/rest/commits/comments#list-commit-comments-for-a-repository) | oldest first; pagination |
| `GET /repos/{owner}/{repo}/comments/{comment_id}` | [`repos/get-commit-comment`](https://docs.github.com/rest/commits/comments#get-a-commit-comment) | no `node_id` or `author_association`; `reactions` is always empty (commit comment reactions aren't served) |
| `PATCH /repos/{owner}/{repo}/comments/{comment_id}` | [`repos/update-commit-comment`](https://docs.github.com/rest/commits/comments#update-a-commit-comment) | `body`; the author (while they can still comment) or a write collaborator, else `403` |
| `DELETE /repos/{owner}/{repo}/comments/{comment_id}` | [`repos/delete-commit-comment`](https://docs.github.com/rest/commits/comments#delete-a-commit-comment) | the author (while they can still comment) or a write collaborator, else `403`; `204` |
| `GET /repos/{owner}/{repo}/commits/{commit_sha}/comments` | [`repos/list-comments-for-commit`](https://docs.github.com/rest/commits/comments#list-commit-comments) | `commit_sha` a full or abbreviated sha; unknown is `422`; oldest first; pagination |
| `POST /repos/{owner}/{repo}/commits/{commit_sha}/comments` | [`repos/create-commit-comment`](https://docs.github.com/rest/commits/comments#create-a-commit-comment) | any signed-in reader (`repo:write` token scope); `body`, optional `path` (a file the commit changes, else `422`) with `position` (1-based line of that file's diff) and deprecated `line` (stored and echoed) |
| `POST /repos/{owner}/{repo}/statuses/{sha}` | [`repos/create-commit-status`](https://docs.github.com/rest/commits/statuses#create-a-commit-status) | write access (`repo:write` token scope); `sha` a full or abbreviated sha of a commit in the repository, else `422`; `state`, `target_url` (http or https), `description` (up to 140 characters), `context` (default `default`); up to 1,000 statuses per commit and context (`422` beyond); no `node_id` |
| `GET /repos/{owner}/{repo}/commits/{ref}/statuses` | [`repos/list-commit-statuses-for-ref`](https://docs.github.com/rest/commits/statuses#list-commit-statuses-for-a-reference) | `ref` a branch, tag or sha (a branch name with `/` percent-encoded); newest first, every status of every context; pagination; no `node_id` |
| `GET /repos/{owner}/{repo}/commits/{ref}/status` | [`repos/get-combined-status-for-ref`](https://docs.github.com/rest/commits/statuses#get-the-combined-status-for-a-specific-reference) | the newest status of each context; `state` is `failure` when any is `failure` or `error`, `pending` when any is pending or there are none, else `success`; `required` is `null` (required checks aren't enforced); `statuses` are paginated; no `node_id`; `repository` is the minimal shape |
| `GET /repos/{owner}/{repo}/commits/{ref}/check-runs` | [`checks/list-for-ref`](https://docs.github.com/rest/checks/runs#list-check-runs-for-a-git-reference) | `check_name`, `status`, `filter` (`latest` default: the newest run per name; `all`), pagination; `{ total_count, check_runs }` |
| `GET /repos/{owner}/{repo}/commits/{ref}/check-suites` | [`checks/list-suites-for-ref`](https://docs.github.com/rest/checks/suites#list-check-suites-for-a-git-reference) | a commit has at most one suite (there are no GitHub Apps); `{ total_count, check_suites }` |
| `GET /repos/{owner}/{repo}/commits/{ref}` | [`repos/get-commit`](https://docs.github.com/rest/commits/commits#get-a-commit) | with `stats` and up to 300 `files` (`page`/`per_page` page through up to 3,000); unknown ref is `422`; media types `diff`, `patch` (`format-patch`) and `sha` |
| `GET /repos/{owner}/{repo}/compare/{basehead}` | [`repos/compare-commits-with-basehead`](https://docs.github.com/rest/commits/commits#compare-two-commits) | `base...head` or `base..head` (`owner:ref` sides); `status`, `ahead_by`, `behind_by`, `merge_base_commit`, up to 250 `commits` (paginated with `page`/`per_page`), up to 300 `files`; media types `diff` (merge base to head for `...`, tip to tip for `..`) and `patch` (one message per commit) |
| `POST /repos/{owner}/{repo}/check-runs` | [`checks/create`](https://docs.github.com/rest/checks/runs#create-a-check-run) | write access (`repo:write` token scope; GitHub requires a GitHub App); `name`, `head_sha` (a commit of the repository, else `422`), `status` (default `queued`; `conclusion` implies `completed`), `started_at`, `completed_at`, `details_url`, `external_id`, `output` (`title`, `summary`, `text`); `completed` needs a `conclusion`; annotations, images and actions are ignored and `annotations_count` is `0` (no `annotations_url`); up to 1,000 runs per commit; `app`, `pull_requests`, `node_id` and `deployment` are omitted |
| `GET /repos/{owner}/{repo}/check-runs/{check_run_id}` | [`checks/get`](https://docs.github.com/rest/checks/runs#get-a-check-run) | |
| `PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}` | [`checks/update`](https://docs.github.com/rest/checks/runs#update-a-check-run) | write access (`repo:write` token scope); the same fields as create, all optional; a `completed` run cannot go back to `queued` or `in_progress` |
| `POST /repos/{owner}/{repo}/check-suites` | [`checks/create-suite`](https://docs.github.com/rest/checks/suites#create-a-check-suite) | write access; `head_sha`; `201` with the commit's suite, created if absent (GitHub answers `200` when it exists) |
| `GET /repos/{owner}/{repo}/check-suites/{check_suite_id}` | [`checks/get-suite`](https://docs.github.com/rest/checks/suites#get-a-check-suite) | `status` and `conclusion` are computed from the suite's runs; `app`, `pull_requests`, `before` and `after` are omitted |
| `GET /repos/{owner}/{repo}/check-suites/{check_suite_id}/check-runs` | [`checks/list-for-suite`](https://docs.github.com/rest/checks/runs#list-check-runs-in-a-check-suite) | as `checks/list-for-ref`, for one suite |
| `GET /repos/{owner}/{repo}/git/ref/{ref}` | [`git/get-ref`](https://docs.github.com/rest/git/refs#get-a-reference) | branches and tags; annotated tags are `type: "tag"` (unpeeled) |
| `GET /repos/{owner}/{repo}/git/refs/{ref}` | [`git/list-refs`](https://docs.github.com/rest/git/refs#get-a-reference) | `{ref}` may be empty (every ref) |
| `GET /repos/{owner}/{repo}/git/matching-refs/{ref}` | [`git/list-matching-refs`](https://docs.github.com/rest/git/refs#list-matching-references) | |
| `DELETE /repos/{owner}/{repo}/git/refs/{ref}` | [`git/delete-ref`](https://docs.github.com/rest/git/refs#delete-a-reference) | write access; `heads/…` or `tags/…`; deleting a branch records `head_ref_deleted` on the closed pull requests it heads; a missing ref or the default branch is `422` |
| `GET /repos/{owner}/{repo}/git/commits/{commit_sha}` | [`git/get-commit`](https://docs.github.com/rest/git/commits#get-a-commit-object) | full sha only |
| `GET /repos/{owner}/{repo}/git/trees/{tree_sha}` | [`git/get-tree`](https://docs.github.com/rest/git/trees#get-a-tree) | `recursive`; up to 10,000 entries, then `truncated` |
| `GET /repos/{owner}/{repo}/git/blobs/{file_sha}` | [`git/get-blob`](https://docs.github.com/rest/git/blobs#get-a-blob) | base64; up to 3 MB |
| `POST /repos/{owner}/{repo}/git/refs` | [`git/create-ref`](https://docs.github.com/rest/git/refs#create-a-reference) | write access; `ref` fully qualified (`refs/heads/…`, `refs/tags/…`); an existing ref is `422` |
| `PATCH /repos/{owner}/{repo}/git/refs/{ref}` | [`git/update-ref`](https://docs.github.com/rest/git/refs#update-a-reference) | write access; a branch only fast-forwards unless `force` (`422 Update is not a fast forward`) |
| `POST /repos/{owner}/{repo}/git/blobs` | [`git/create-blob`](https://docs.github.com/rest/git/blobs#create-a-blob) | `content` with `encoding` `utf-8` (default) or `base64`; `201 { sha, url }` |
| `POST /repos/{owner}/{repo}/git/trees` | [`git/create-tree`](https://docs.github.com/rest/git/trees#create-a-tree) | `tree` entries (`path`, `mode`, `type`, and `sha` or `content`; nested paths edit subtrees, `sha: null` deletes) over an optional `base_tree`; up to 10,000 entries |
| `POST /repos/{owner}/{repo}/git/commits` | [`git/create-commit`](https://docs.github.com/rest/git/commits#create-a-commit) | `message`, `tree`, `parents`, `author`/`committer` (with `date`; default the caller, now); no ref moves |
| `GET /repos/{owner}/{repo}/git/tags/{tag_sha}` | [`git/get-tag`](https://docs.github.com/rest/git/tags#get-a-tag) | annotated tag objects (unsigned) |
| `POST /repos/{owner}/{repo}/git/tags` | [`git/create-tag`](https://docs.github.com/rest/git/tags#create-a-tag-object) | unsigned; create the `refs/tags/…` ref separately, as on GitHub |
| `GET /repos/{owner}/{repo}/issues` | [`issues/list-for-repo`](https://docs.github.com/rest/issues/issues#list-repository-issues) | returns issues **and pull requests** (a pull request carries a `pull_request` object); `state` (`open`/`closed`/`all`), `labels`, `milestone` (number, `none`, `*`), `assignee` (login, `none`, `*`), `sort` (`created`/`updated`/`comments`), `direction` |
| `POST /repos/{owner}/{repo}/issues` | [`issues/create`](https://docs.github.com/rest/issues/issues#create-an-issue) | any signed-in reader; `title`, `body`, `labels`, `assignees`, `milestone` (number; labels/assignees/milestone need write access, an unknown milestone is `422`) |
| `GET /repos/{owner}/{repo}/issues/comments/{comment_id}` | [`issues/get-comment`](https://docs.github.com/rest/issues/comments#get-an-issue-comment) | |
| `PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}` | [`issues/update-comment`](https://docs.github.com/rest/issues/comments#update-an-issue-comment) | |
| `DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}` | [`issues/delete-comment`](https://docs.github.com/rest/issues/comments#delete-an-issue-comment) | `204` |
| `GET /repos/{owner}/{repo}/issues/comments/{comment_id}/reactions` | [`reactions/list-for-issue-comment`](https://docs.github.com/rest/reactions/reactions#list-reactions-for-an-issue-comment) | filters by `content`; paginated |
| `POST /repos/{owner}/{repo}/issues/comments/{comment_id}/reactions` | [`reactions/create-for-issue-comment`](https://docs.github.com/rest/reactions/reactions#create-reaction-for-an-issue-comment) | any signed-in reader (`repo:write` token); `201` when new, `200` with the existing reaction |
| `DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}/reactions/{reaction_id}` | [`reactions/delete-for-issue-comment`](https://docs.github.com/rest/reactions/reactions#delete-an-issue-comment-reaction) | only your own reaction; `204` |
| `GET /repos/{owner}/{repo}/issues/{issue_number}` | [`issues/get`](https://docs.github.com/rest/issues/issues#get-an-issue) | a pull request number returns the pull request; `closed_by` (the user who last closed it, else `null`) appears here only, not on lists; issues carry `state_reason` |
| `PATCH /repos/{owner}/{repo}/issues/{issue_number}` | [`issues/update`](https://docs.github.com/rest/issues/issues#update-an-issue) | the author or a writer; `title`, `body`, `state`, `state_reason` (`completed` default, `not_planned`, `reopened`; one that contradicts the state is `422`), `labels`, `assignees`, `milestone` (number, or `null` to clear; writers only; records `milestoned`/`demilestoned` events); also accepts pull request numbers (state reasons are ignored for pull requests); merged pull requests stay closed and cannot be reopened |
| `GET /repos/{owner}/{repo}/issues/{issue_number}/comments` | [`issues/list-comments`](https://docs.github.com/rest/issues/comments#list-issue-comments) | comments of an issue or a pull request |
| `POST /repos/{owner}/{repo}/issues/{issue_number}/comments` | [`issues/create-comment`](https://docs.github.com/rest/issues/comments#create-an-issue-comment) | any signed-in reader |
| `GET /repos/{owner}/{repo}/issues/{issue_number}/timeline` | [`issues/list-events-for-timeline`](https://docs.github.com/rest/issues/timeline#list-timeline-events-for-an-issue) | comments, events and submitted reviews (`reviewed` items with `state`, `body`, `commit_id`, `author_association` `OWNER`/`COLLABORATOR`/`NONE`), oldest first |
| `GET /repos/{owner}/{repo}/issues/{issue_number}/events` | [`issues/list-events`](https://docs.github.com/rest/issues/events#list-issue-events) | issue events only (no comments or reviews, as on GitHub), oldest first |
| `GET /repos/{owner}/{repo}/issues/{issue_number}/reactions` | [`reactions/list-for-issue`](https://docs.github.com/rest/reactions/reactions#list-reactions-for-an-issue) | reactions on an issue or pull request; filters by `content`; paginated |
| `POST /repos/{owner}/{repo}/issues/{issue_number}/reactions` | [`reactions/create-for-issue`](https://docs.github.com/rest/reactions/reactions#create-reaction-for-an-issue) | any signed-in reader (`repo:write` token); `201` when new, `200` with the existing reaction |
| `DELETE /repos/{owner}/{repo}/issues/{issue_number}/reactions/{reaction_id}` | [`reactions/delete-for-issue`](https://docs.github.com/rest/reactions/reactions#delete-an-issue-reaction) | only your own reaction; `204` |
| `GET /repos/{owner}/{repo}/issues/{issue_number}/labels` | [`issues/list-labels-on-issue`](https://docs.github.com/rest/issues/labels#list-labels-for-an-issue) | |
| `POST /repos/{owner}/{repo}/issues/{issue_number}/labels` | [`issues/add-labels`](https://docs.github.com/rest/issues/labels#add-labels-to-an-issue) | write access; returns every label |
| `PUT /repos/{owner}/{repo}/issues/{issue_number}/labels` | [`issues/set-labels`](https://docs.github.com/rest/issues/labels#set-labels-for-an-issue) | write access; returns every label |
| `DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels` | [`issues/remove-all-labels`](https://docs.github.com/rest/issues/labels#remove-all-labels-from-an-issue) | write access; `204` |
| `DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}` | [`issues/remove-label`](https://docs.github.com/rest/issues/labels#remove-a-label-from-an-issue) | write access; returns the remaining labels |
| `GET /repos/{owner}/{repo}/pulls` | [`pulls/list`](https://docs.github.com/rest/pulls/pulls#list-pull-requests) | `state` (`open`/`closed`/`all`; closed includes merged), `head` (`branch` or `owner:branch`), `base`, `sort` (`created`/`updated`/`popularity`/`long-running`), `direction` (GitHub's defaults) |
| `POST /repos/{owner}/{repo}/pulls` | [`pulls/create`](https://docs.github.com/rest/pulls/pulls#create-a-pull-request) | write access; `title`, `body`, `head`, `base` (`draft` opens it as a draft: `mergeable_state` is `draft` and merging it is `405`; `issue`, `maintainer_can_modify` ignored); unknown or equal branches and an already-open pull request are `422` |
| `GET /repos/{owner}/{repo}/pulls/{pull_number}` | [`pulls/get`](https://docs.github.com/rest/pulls/pulls#get-a-pull-request) | media types `diff` (the unified diff, base to head) and `patch` (one format-patch section per commit, oldest first, up to 250 commits); both are `text/plain; charset=utf-8` (an inert type with `nosniff`, not GitHub's `application/vnd.github.v3.diff`/`.patch` Content-Type) and stream up to the 10 MiB media cap, past which the answer is `406` |
| `PATCH /repos/{owner}/{repo}/pulls/{pull_number}` | [`pulls/update`](https://docs.github.com/rest/pulls/pulls#update-a-pull-request) | the author or a writer; `title`, `body`, `state`; changing `base` is `422` |
| `GET /repos/{owner}/{repo}/pulls/{pull_number}/merge` | [`pulls/check-if-merged`](https://docs.github.com/rest/pulls/pulls#check-if-a-pull-request-has-been-merged) | `204` once merged, else `404` |
| `PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge` | [`pulls/merge`](https://docs.github.com/rest/pulls/pulls#merge-a-pull-request) | `commit_title`, `commit_message`, `sha` (`409` when the head moved), `merge_method` (`merge` only; `squash`/`rebase` are `405`). A closed, merged, conflicting or review-blocked pull request is `405 Pull Request is not mergeable`. Returns `{ sha, merged, message }` |
| `GET /repos/{owner}/{repo}/pulls/{pull_number}/commits` | [`pulls/list-commits`](https://docs.github.com/rest/pulls/pulls#list-commits-on-a-pull-request) | oldest first, up to 250 |
| `GET /repos/{owner}/{repo}/pulls/{pull_number}/files` | [`pulls/list-files`](https://docs.github.com/rest/pulls/pulls#list-pull-requests-files) | up to 3000 files, paginated; `patch` holds the hunks (absent for binary and oversized files, and for files past a 2 MiB per-response patch budget). The whole diff is computed per request (cached for 30 seconds by the compared tips) |
| `GET /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers` | [`pulls/list-requested-reviewers`](https://docs.github.com/rest/pulls/review-requests#get-all-requested-reviewers-for-a-pull-request) | `{ users, teams }`; `teams` is always empty (no teams yet) |
| `POST /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers` | [`pulls/request-reviewers`](https://docs.github.com/rest/pulls/review-requests#request-reviewers-for-a-pull-request) | `reviewers` (collaborators only, at most 15; never the author); `team_reviewers` is refused. Each new request is a `review_requested` event and notifies the reviewer (`reason: review_requested`). Needs write access or authorship. `201` with the pull request |
| `DELETE /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers` | [`pulls/remove-requested-reviewers`](https://docs.github.com/rest/pulls/review-requests#remove-requested-reviewers-from-a-pull-request) | `reviewers` must all have a pending request (`422` otherwise); records `review_request_removed`. Returns the pull request |
| `GET /repos/{owner}/{repo}/milestones` | [`issues/list-milestones`](https://docs.github.com/rest/issues/milestones#list-milestones) | `state` (`open` default, `closed`, `all`), `sort` (`due_on` default, `completeness`), `direction`; `open_issues`/`closed_issues` count issues and pull requests |
| `POST /repos/{owner}/{repo}/milestones` | [`issues/create-milestone`](https://docs.github.com/rest/issues/milestones#create-a-milestone) | write access; `title`, `state`, `description`, `due_on`; a duplicate title is `422 already_exists` |
| `GET /repos/{owner}/{repo}/milestones/{milestone_number}` | [`issues/get-milestone`](https://docs.github.com/rest/issues/milestones#get-a-milestone) | |
| `PATCH /repos/{owner}/{repo}/milestones/{milestone_number}` | [`issues/update-milestone`](https://docs.github.com/rest/issues/milestones#update-a-milestone) | write access |
| `DELETE /repos/{owner}/{repo}/milestones/{milestone_number}` | [`issues/delete-milestone`](https://docs.github.com/rest/issues/milestones#delete-a-milestone) | write access; `204`; issues and pull requests in it lose the milestone |
| `GET /repos/{owner}/{repo}/labels` | [`issues/list-labels-for-repo`](https://docs.github.com/rest/issues/labels#list-labels-for-a-repository) | |
| `POST /repos/{owner}/{repo}/labels` | [`issues/create-label`](https://docs.github.com/rest/issues/labels#create-a-label) | write access; `color` optional (defaults to `ededed`); a duplicate name is `422 already_exists` |
| `GET /repos/{owner}/{repo}/labels/{name}` | [`issues/get-label`](https://docs.github.com/rest/issues/labels#get-a-label) | |
| `PATCH /repos/{owner}/{repo}/labels/{name}` | [`issues/update-label`](https://docs.github.com/rest/issues/labels#update-a-label) | write access |
| `DELETE /repos/{owner}/{repo}/labels/{name}` | [`issues/delete-label`](https://docs.github.com/rest/issues/labels#delete-a-label) | write access; `204` |
| everything else | | not implemented: `404 Not Found` |

## Differences from GitHub

- User, repository and pull request `id`s are integers. Their `node_id`s
  (`base64("04:User<id>")`, `"010:Repository<id>"`, `"011:PullRequest<id>"`) are
  GitHub's legacy form, verified against GitHub, and resolve through GraphQL
  `node(id:)`. Milestone, reaction, release and release asset objects also carry
  a `node_id` in the legacy form, but its code is not yet verified against
  GitHub (#269); other objects omit it.
- **`avatar_url` is `null`** when the user has no image (GitHub always has one).
- `email` on a user is always `null`, and the `email` of a commit author or
  committer is always the placeholder `noreply@<host>`: web commits carry the
  account's sign-in email, which is never exposed. Names and dates are real.
- `pushed_at` is omitted and `sort=pushed` sorts by `updated_at`.
- Repository objects carry the fields PushStack has an equivalent for:
  `id, name, full_name, private, owner, html_url, description, fork, url,
  clone_url, created_at, updated_at, default_branch, visibility, archived,
  disabled, homepage, topics, is_template, has_issues, has_wiki, has_projects,
  stargazers_count, watchers_count, forks_count` and (when
  authenticated, on repo and `/user/repos`) `permissions`. `fork` is always
  `false`, `forks_count` `0`. Everything else (`language`, `size`,
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
  `author_association` and `performed_via_github_app`; `active_lock_reason`
  is always `null`, `locked` always `false`. A
  `labeled`/`unlabeled` event carries `{ name, color }`; a
  `milestoned`/`demilestoned` event carries `{ title }`; an
  `assigned`/`unassigned` event carries a partial assignee (`login`, `name`,
  `type`) because the account isn't stored with the event.
- A label's `default` is `true` for the names in GitHub's default set; a label's
  `id` is an integer.
- A milestone's `number` is its own per-repository sequence (not the issue
  `#N`); `open_issues`/`closed_issues` count issues and pull requests (a
  merged pull request is closed). Milestone `node_id` is the legacy
  `09:Milestone<id>` id. Deleting a milestone clears it from its issues and
  pull requests without a timeline event. The web search accepts
  `milestone:"v1"` and `no:milestone`.
- Unsupported issue-list filters (`creator`, `mentioned`, `since`,
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
- Compare: `base..head` diffs the two tips directly (`base...head` diffs from
  the merge base; `merge_base_commit` is the real merge base either way); an `owner:` prefix must
  name the repository's owner (there are no forks). `ahead_by`/`behind_by`
  come from bounded history walks (400 commits per side). `html_url`,
  `diff_url` and `patch_url` point at the web UI's compare page and its
  plain-text `.diff`/`.patch` URLs.
- Git database: trees list at most 10,000 entries (GitHub: 100,000) before
  `truncated: true`; `/git/trees/{sha}` also accepts a branch, tag or commit;
  blobs over 3 MB are `403` (GitHub: 100 MB), because responses are buffered.
  Commit `verification` is always `unsigned`. Only branch and tag refs exist.
- Pull requests: there are no forks, so `head.repo` and `base.repo` are the
  same repository and a `head` of another owner is `422`. `mergeable` is `null`
  for an open pull request (`false` once merged) and `mergeable_state` is
  `draft` for a draft and otherwise `unknown`: conflicts are only detected by the merge itself, which then answers
  `405`. `rebaseable` is `false`, `draft` reflects the draft state (merging a draft is `405` "Pull Request is still a draft"; REST cannot change it after creation, as on GitHub), `requested_teams`
  empty (there are no teams yet; `team_reviewers` is `422`), and `author_association` and `auto_merge`
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
