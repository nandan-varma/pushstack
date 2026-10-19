# REST API

PushStack serves a GitHub-compatible REST API, so scripts, Octokit and
`gh`-style tools can work against it by changing the base URL. It mirrors
GitHub Enterprise's layout.

- **Base URL**: `https://git.nandan.fyi/api/v3`
- **Code**: `src/routes/api/v3.$.ts` (the single route) → `src/server/api/index.ts`
  (dispatcher and route table) → one module per resource in `src/server/api/`.
  Handlers call the same plain server modules the server functions use
  (`repository-lookup.ts`, `repo-access.ts`, `git-read.ts`,
  `repository-create.ts`), never the `createServerFn`s.

To add an endpoint: write a handler `(ctx: ApiContext) => Promise<Response>` in
the resource's module, add a row to `ROUTES` in `index.ts`, add a behavior test
in `src/server/__tests__/api.test.ts`, and add a row to the matrix below.

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

Errors follow GitHub's body:

```json
{ "message": "Not Found", "documentation_url": "https://docs.github.com/rest", "status": "404" }
```

Validation failures are `422` with `errors: [{ resource, field, code }]`
(`missing_field`, `invalid`, `custom` with a `message`). A request body that
isn't a JSON object is `400 Problems parsing JSON`; a body over 1 MiB is `413`.

## Pagination

List endpoints take `per_page` (default 30, max 100) and `page` (from 1);
invalid values fall back to the defaults. The `Link` header carries
`rel="prev"`, `"next"`, `"last"` and `"first"` (other query parameters are
kept) and is absent when everything fits on one page. Pages deeper than
10,000 items are empty.

## Compatibility matrix

| Endpoint | Status | Notes |
| --- | --- | --- |
| `GET /user` | supported | |
| `GET /users/{username}` | supported | |
| `GET /user/repos` | supported | `visibility`, `affiliation` (`owner`, `collaborator`), `type`, `sort`, `direction` |
| `POST /user/repos` | supported | `name`, `description`, `private`; other fields ignored |
| `GET /users/{username}/repos` | supported | public repositories only; `sort`, `direction` |
| `GET /repos/{owner}/{repo}` | supported | |
| `GET /repos/{owner}/{repo}/branches` | supported | sorted by name |
| `GET /repos/{owner}/{repo}/branches/{branch}` | supported | branch names may contain `/` |
| `GET /repos/{owner}/{repo}/tags` | supported | version order |
| everything else | not implemented | `404 Not Found` |

## Differences from GitHub

- **User `id` is a string**, not an integer (PushStack's user ids are text).
  Repository `id` is an integer. `node_id` is omitted.
- **`avatar_url` is `null`** when the user has no image (GitHub always has one).
- `email` on a user is always `null`; the address is never exposed.
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
- Commit `author`/`committer` (account links) in a branch response are `null`;
  commits aren't linked to accounts by email. `commit.url`/`html_url` point at
  endpoints/pages that aren't implemented yet.
- Branch `protected` is always `false`; there is no branch protection.
- Tags have no `zipball_url`/`tarball_url`.
- `description` is limited to 500 characters (GitHub: 350 on creation, so
  anything valid there is valid here); repository names follow PushStack's
  rule (letters, digits, `.`, `-`, `_`) and an invalid name is a `422` rather
  than being rewritten to hyphens.
- No `X-RateLimit-*` headers, no ETag/conditional requests, no CORS headers.
