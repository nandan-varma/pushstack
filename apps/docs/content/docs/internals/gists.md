---
title: "Gists"
description: "Design note for issue #221: GitHub's gist REST and GraphQL surface on PushStack's existing git-on-R2 storage."
---

Status: **design only** — nothing in this document is implemented yet. The
follow-up issues at the end do the work. Issue: [#221](https://github.com/nandan-varma/pushstack/issues/221).

A gist is a small git repository with an id, its files, a description and one
of two visibilities:

- **public** — listed in public listings and on the owner's profile;
- **secret** — unlisted. It is *not* private: anyone holding the id can read
  it, anonymously, over the web, the REST API and `git clone`. Only listing
  hides it, exactly as on GitHub.

Everything below follows GitHub's names, URLs, status codes and JSON/GraphQL
shapes. Where GitHub documents no bound (a gist's description, how many gists a
user may own), the number is PushStack's own cap in `limits.ts` and is marked
as such here.

## What a gist reuses, and what it must not

A gist is a git repository, so its bytes live in R2 under the same
`git-fs-s3` stack as a repository, and its commits are made with the same
`git-fs-s3/ops` primitives (`commitFilesToBare`, `getTreeFromRef`, `getBlob`,
`getCommitHistory`, `copyPrefix`).

It is **not** a `repositories` row. Forcing one would make a gist appear in
repository lists and search, collide with the `(owner_id, name)` unique index,
give it repository privacy semantics (secret is unlisted, not private), and
expose `/{owner}/{name}` repository pages for it. Gists therefore get their own
three tables, their own storage prefix (`gists/{id}/git/…`) and a small
`gist-access.ts` modelled on `repo-access.ts` (same `readWithAccess` /
`writeWithAccess` shape, degenerate rules: anyone reads, only the owner
writes). `repo-access.ts`'s helpers themselves are repository-row based and are
left untouched.

The git layer is reused without touching its 80+ call sites: `git-read.ts` and
`git-write.ts` keep their `(ownerKey, repoName)` signatures for repositories,
and a new `gist-git.ts` builds the same `Repo` handle for a gist (its gitdir,
its isomorphic-git cache, its ops hooks) and calls the same `git-fs-s3/ops`
functions. The write lock is the same Postgres lease: `withRepositoryLock`
composes `{ownerKey}/{repoName}`, so a gist takes `withGistLock(id)` =
`gists/{id}` — the same string as its storage prefix.

## GitHub's REST surface

Base: `GET/POST/PATCH/DELETE https://api.github.com`, served here at
`/api/v3`. Gist operations are keyed by GitHub's operation ids in
`packages/api-contract`.

| Operation id | Method and path | Success | Notes |
| --- | --- | --- | --- |
| `gists/list` | `GET /gists` | 200 | Authenticated: the caller's gists (public and secret). Anonymous: all public gists, as GitHub's docs state. `since`, `per_page`, `page` |
| `gists/list-public` | `GET /gists/public` | 200 | Public only, most recently updated first. `since`, `per_page`, `page` |
| `gists/list-starred` | `GET /gists/starred` | 200 | Requires authentication (401 otherwise). `since`, `per_page`, `page` |
| `gists/list-for-user` | `GET /users/{username}/gists` | 200 | That user's **public** gists. `since`, `per_page`, `page` |
| `gists/create` | `POST /gists` | 201 | Body `description`, `files` (required, at least one), `public` (boolean or `"true"`/`"false"`). `Location` header |
| `gists/get` | `GET /gists/{gist_id}` | 200 | Full gist: file contents included. 404 when missing |
| `gists/get-revision` | `GET /gists/{gist_id}/{sha}` | 200 | The gist as of that commit. 404 for an unknown revision, 422 for a malformed sha |
| `gists/update` | `PATCH /gists/{gist_id}` | 200 | `description` and/or `files`; at least one is required (422). Owner only |
| `gists/delete` | `DELETE /gists/{gist_id}` | 204 | Owner only |
| `gists/list-commits` | `GET /gists/{gist_id}/commits` | 200 | `Gist Commit` array |
| `gists/list-forks` | `GET /gists/{gist_id}/forks` | 200 | `Gist Simple` array |
| `gists/fork` | `POST /gists/{gist_id}/forks` | 201 | Any signed-in user; server-side copy of the git prefix |
| `gists/check-is-starred` | `GET /gists/{gist_id}/star` | 204 | **404** when not starred (GitHub's odd but documented answer) |
| `gists/star` | `PUT /gists/{gist_id}/star` | 204 | Idempotent; no body |
| `gists/unstar` | `DELETE /gists/{gist_id}/star` | 204 | Idempotent |
| `gists/list-comments` | `GET /gists/{gist_id}/comments` | 200 | `Gist Comment` array; `per_page`, `page` |
| `gists/create-comment` | `POST /gists/{gist_id}/comments` | 201 | Body `body` (required) |
| `gists/get-comment` | `GET /gists/{gist_id}/comments/{comment_id}` | 200 | |
| `gists/update-comment` | `PATCH /gists/{gist_id}/comments/{comment_id}` | 200 | Author only |
| `gists/delete-comment` | `DELETE /gists/{gist_id}/comments/{comment_id}` | 204 | Author or gist owner |

Contract ordering matters where templates overlap: `/gists/public` and
`/gists/starred` must match before `/gists/{gist_id}`.

### The gist object

`Base Gist` (list items) — verified against a live gist:

```json
{
  "url": "https://host/api/v3/gists/9bd5243101186cd830f5493920739c68",
  "forks_url": "https://host/api/v3/gists/9bd5243101186cd830f5493920739c68/forks",
  "commits_url": "https://host/api/v3/gists/9bd5243101186cd830f5493920739c68/commits",
  "comments_url": "https://host/api/v3/gists/9bd5243101186cd830f5493920739c68/comments",
  "id": "9bd5243101186cd830f5493920739c68",
  "node_id": "G_kwDOAF-wA9oAIDliZDUyNDMxMDExODZjZDgzMGY1NDkzOTIwNzM5YzY4",
  "git_pull_url": "https://host/9bd5243101186cd830f5493920739c68.git",
  "git_push_url": "https://host/9bd5243101186cd830f5493920739c68.git",
  "html_url": "https://host/gist/choco-bot/9bd5243101186cd830f5493920739c68",
  "files": {
    "Install.txt": {
      "filename": "Install.txt",
      "type": "text/plain",
      "language": "Text",
      "raw_url": "https://host/gist/choco-bot/9bd5243101186cd830f5493920739c68/raw/76f26ff33c3b24c5ad40c45b2f4e93b8506fc606/Install.txt",
      "size": 52550
    }
  },
  "public": true,
  "created_at": "2025-03-05T04:12:27Z",
  "updated_at": "2025-03-20T10:04:01Z",
  "description": "…",
  "comments": 0,
  "comments_enabled": true,
  "owner": { "login": "choco-bot", "…": "Simple User" },
  "user": { "login": "choco-bot", "…": "Simple User" },
  "truncated": false
}
```

`Gist` (single gist: `GET`, `POST`, `PATCH`, `GET …/{sha}`) is the same object
plus each file's `content` (string), `truncated` (boolean) and `encoding`
(`"utf-8"`, or `"base64"` for a blob that is not valid UTF-8 — the same
convention as `GET /contents`). GitHub's `Gist` schema also offers `fork_of`,
`forks` and `history` arrays; those are **omitted** here and served by the
dedicated endpoints instead (`packages/api-contract/src/compat.ts` notes it).

`files` keys are the file names as they appear in the gist's tree, including
the directory part if a name contains `/`.

### Truncation (GitHub's, adopted as-is)

- Each file's `content` is at most 1 MB; a larger blob is returned partially
  with `truncated: true` and the whole file is still downloadable from
  `raw_url`.
- The files map is capped: beyond 300 files GitHub returns the first 300 with
  the gist-level `truncated: true`. PushStack refuses creation past
  `MAX_GIST_FILES` (300) instead, so every gist's API view is complete; the
  cap difference is noted in compat.
- A third bound is PushStack's: a whole `Gist` response stays under Vercel's
  4.5 MB buffered-response cap by stopping inline content at
  `MAX_GIST_INLINE_RESPONSE_BYTES`, setting the remaining files'
  `truncated: true` and the gist's `truncated: true`.

### Gist commit

```json
{
  "url": "https://host/api/v3/gists/{id}/{sha}",
  "version": "{sha}",
  "user": { "…": "Simple User" } | null,
  "change_status": { "total": 902, "additions": 902, "deletions": 0 },
  "committed_at": "2026-11-18T02:26:57Z"
}
```

`change_status` is a line count against the first parent (`getCommitDiff`),
computed per commit of the requested page; a page is at most 100 commits.

### Gist comment

```json
{
  "id": 1,
  "node_id": "…",
  "url": "https://host/api/v3/gists/{id}/comments/1",
  "body": "…",
  "user": { "…": "Simple User" } | null,
  "created_at": "…",
  "updated_at": "…",
  "author_association": "OWNER"
}
```

`author_association` is `OWNER` for the gist owner's comments and `NONE` for
everyone else (there are no collaborators on a gist). `body` is at most 65,535
characters (GitHub's schema), longer is 422.

### Authentication and scopes

- Reads need no scope: public gists are anonymous, and a secret gist is
  readable by anyone who knows its id.
- Writes (create, update, delete, star, fork, comment) need the caller's token
  to carry the **`gist`** scope; a token without it is `403 Resource not
  accessible by personal access token`, GitHub's answer for an unscoped token.
- `GET /gists/starred` is `401` without credentials, like other
  authenticated-user endpoints.
- Session cookies are accepted on the web pages only; `/api/v3` stays
  token-only, as everywhere else.

Adding `gist` to `TOKEN_SCOPES` needs one security fix in the same change:
`tokenAllows` currently treats *any* scope as satisfying `repo:read`
(`scopes.length > 0`). A gist-only token must not read private repositories, so
the check becomes "a `repo:*` scope for repo reads, `repo:write` for writes,
`gist` for gists". `X-OAuth-Scopes` maps a `gist` token to GitHub's classic
`gist` (a `repo:write` token keeps `read:org, repo`).

## URLs

`getGitBaseUrl()` (`lib/git-utils.ts`) is the origin for HTML, raw and clone
URLs; `apiUrl()` prefixes `/api/v3`.

| URL | What it serves |
| --- | --- |
| `/gist` | Index: the caller's gists when signed in, recent public gists otherwise |
| `/gist/{user}/{gist_id}` | The gist page: files, revision picker, forks, stars, comments, clone box. This is `html_url` |
| `/gist/{user}/{gist_id}/{revision}` | The same page at a revision (commit sha) |
| `/gist/{user}/{gist_id}/raw/{revision}/{filename}` | Raw bytes of one file at a revision; `raw_url`. `Content-Type` from the file's detected type, streamed |
| `/{user}/{gist_id}` | 301 to `/gist/{user}/{gist_id}` when that pair names a gist, otherwise the existing repository route's 404 |
| `/{user}/{gist_id}/{revision}` | 301 to the `/gist/…` revision page under the same condition |
| `/{gist_id}.git` | `git clone`/`fetch` (smart HTTP upload-pack), HEAD on `master` |

Why `/gist/` and a redirect: `/{user}/{gist_id}` has exactly the shape of
`/{owner}/{repo}`, and a TanStack Router route tree cannot hold two different
pages for one path. The repository layout route resolves its repository first;
when no repository has that name it asks for a gist with that owner and id and
redirects, so repository pages are untouched and a gist-only path still works.
A `gist.` host would remove the ambiguity but needs DNS and Vercel domain
configuration, so it is not used.

`/{gist_id}.git` is one path segment, which a TanStack file route cannot
express (a param cannot share a segment with a literal suffix). The entry point
(`apps/web/src/server.ts`) therefore matches `^/[0-9a-f]{32}\.git/…` before the
router and hands it to the gist git handler; repository clone URLs keep their
`$owner.$name.*` routes.

Gists are single-branch: `master` (GitHub's default name for a gist
repository), so `HEAD → refs/heads/master`.

**Clone is read-only in this design.** `git-upload-pack` is served;
`git-receive-pack` answers `403` with a clear message, because every supported
write path is REST (`gh gist edit`) or the web UI. GitHub accepts pushes to a
gist, so this is a documented difference and a later issue if it is ever
wanted.

## Data model (additive)

Three new tables in `apps/web/src/db/app-schema.ts`; existing tables are not
changed. `user` and the auth tables are untouched.

`gists`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `text` primary key | 32 lowercase hex, generated (`crypto.randomUUID()` without dashes). GitHub's own ids are hex strings; the id *is* the storage segment, so it is the key |
| `owner_id` | `text not null` → `user.id` `on delete cascade` | |
| `description` | `text null` | ≤ `MAX_GIST_DESCRIPTION_CHARS` |
| `visibility` | `text not null default 'public'` `$type<"public" \| "secret">` | GitHub's `public: false` is `secret` |
| `fork_of_id` | `text null` → `gists.id` `on delete set null` | the fork's parent; null once the parent is deleted |
| `is_fork` | `boolean not null default false` | stays true after the parent is deleted (GitHub's `fork` rule) |
| `pushed_at` | `timestamptz not null default now()` | last REST update or push; GitHub's `pushed_at` |
| `created_at`, `updated_at` | `timestamptz not null default now()` | |

Indexes: `(owner_id, created_at)`, `(visibility, updated_at)`, `fork_of_id`.
Lists sort by `updated_at`/`created_at` and always filter by owner or
visibility, so those are the access paths.

`gist_stars`

| Column | Type | Notes |
| --- | --- | --- |
| `gist_id` | `text not null` → `gists.id` cascade | |
| `user_id` | `text not null` → `user.id` cascade | |
| `created_at` | `timestamptz not null default now()` | |

Unique `(gist_id, user_id)`; index `user_id` (the starred list).

`gist_comments`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `serial` primary key | GitHub's integer comment ids |
| `gist_id` | `text not null` → `gists.id` cascade | |
| `user_id` | `text not null` → `user.id` cascade | |
| `body` | `text not null` | ≤ 65,535 characters |
| `created_at`, `updated_at` | `timestamptz not null default now()` | |

Indexes: `(gist_id, created_at)`, `user_id`.

`db/relations.ts` gains `gists.owner`, `gists.forkOf`, `gists.stars`,
`gists.comments`; `gistStars.gist`/`.user`; `gistComments.gist`/`.author`.
`internals/database.md`'s table list gains the three rows.

**Safe deploy order:** additive only — three new tables, no column or index
changes on existing tables. `pnpm db:push` (the orchestrator, before the code
deploys) then deploy; the new code reads only the new tables, so an instance
running old code is unaffected.

`node_id`: a gist's id is GitHub's new global form
(`G_` + base64url msgpack), with the gist id string in the key slot; the
legacy form (`04:Gist…`, verified from a live id) decodes too. So
`graphql/node-id.ts` gains `Gist: "G"` in `GLOBAL_PREFIX` and `Gist: "04"` in
the legacy codes. Only the legacy form is decoded today, so `node(id:)` needs a
decoder for the `G_` form too (msgpack array version 0; the middle slot is
ignored, the key is the gist id string) — otherwise the ids we serve would not
resolve. `GistComment`'s codes are unverified — the implementation
captures one from GitHub (create a comment over REST, read `node_id`) before
serving it; `node-id.ts` has an `UNVERIFIED_CODES` map for exactly this.

## Storage

```text
gists/{id}/git/{path-inside-the-bare-repo}
gists/{id}/git/refs/heads/master
gists/{id}/git/objects/pack/pack-….pack
```

That is the only prefix a gist ever writes, and
`server/git-storage-naming.ts` is still the only file that builds keys:

- `GIST_ID_RE = /^[0-9a-f]{32}$/` and `segment()`-style validation (the same
  backstop as repositories: an id becomes a gitFs path);
- `getGistGitStorageRoot(id)` / `getGistGitStoragePrefix(id)`;
- `parseGistGitStorageKey(key)` for classifying keys, beside
  `parseRepoGitStorageKey`.

`server/git-fs.ts` gains three functions beside `registerRepoGitdir` /
`deleteRepoStorage` / `forkRepoGitStorage`:

- `registerGistGitdir(id)` — registers `gists/{id}/git` with `gitFs` and the
  same `absentFiles: ["packed-refs", "shallow"]`; isomorphic-git's per-command
  gitdir probes then cost no R2 call;
- `deleteGistStorage(id)` — `deletePrefix` over the gist prefix;
- `forkGistGitStorage(parentId, forkId, maxBytes)` — `copyPrefix`, with
  `MAX_FORK_COPY_BYTES` checked from the listing first, like a repository fork.

`server/gist-git.ts` (new, the gist side of `git-repo.ts` + `git-read.ts` +
`git-write.ts`):

- `gistRepoFor(id)` → `{ fs: gitFs, gitdir: registerGistGitdir(id), cache: getRepoCache("gists", id) }`;
- `gistOpsHooks(id)` → `opsHooksFor`'s shape with `prefetchGistPacks(id)` (the
  gist twin of `prefetchAllPacks`), so parsed-pack caching behaves as it does
  for repositories;
- `initGistRepo(id)` — bare `git.init` with default branch `master`;
- `createGistFiles(id, files, author)` — the first commit under
  `withGistLock(id)`;
- `applyGistUpdate(id, changes, author)` — update/rename/delete in one commit
  under the same lock (renames and deletes are tree operations, so this runs
  as one `commitFilesToBare` plus deletes, not one commit per file);
- `readGistFiles(id, revision?)` — tree at the revision (default `HEAD`), then
  each blob's size before its content, so the truncation and response budgets
  are applied before bytes are read;
- `gistCommitPage(id, limit, skip)` — `getCommitHistory` and, per commit,
  `getCommitDiff` for `change_status`;
- `afterGistWrite(id)` — `invalidateResultCache` over `resultKeyPrefixes` and
  `invalidateRepoCache("gists", id)`.

`git-repo-lock.ts` exports `withGistLock(id)` (a thin
`withLockKey(`gists/${id}`)`), so the lock key equals the storage prefix. A
repository's key is `{username}/{repoName}`; `gists` is added to
`lib/reserved-names.ts`'s username reservations (with `gist`, which is also a
new top-level route) so no user can ever own a repository whose lock key
collides with a gist's.

Deleting a gist deletes the row first (cascading stars and comments), then
`deleteGistStorage(id)` inside the lock; a failed cleanup only leaves an
unreachable prefix, and ids are never reused.

## Access rules

`server/gist-access.ts` mirrors `repo-access.ts`'s shape:

- `readGist(id)` / `readGistByOwnerAndId(user, id)` — never a 404 for an
  existing gist: secret means unlisted, not private. A missing id is 404.
- `writeGist(id)` — the caller must be the owner (404 for missing,
  403 for someone else's gist, GitHub's answer).
- listing helpers only ever select public rows for anyone else's view; the
  caller's own view includes secret ones.

## REST wiring

- `packages/api-contract/src/routes.ts`: the 20 operations above, with
  GitHub's docs links and `status` (201 for create/fork/comment,
  204 for delete/star/unstar and the star check's success).
- `endpoints.ts` + `inputs.ts`: `gistParams` (`gist_id` must match
  `GIST_ID_RE`, else 404), `sha` for revisions, `gists` body (files as a record
  of filename → `{content}` or `null` or `{content?, filename?}`), description,
  `public` (boolean or `"true"`/`"false"`), `since`/pagination.
- `resources.ts`: `gistFile` (base and full), `gistSimple`, `gist`,
  `gistCommit`, `gistComment`.
- `compat.ts`: one note per operation (`""` only where identical).
- `apps/web/src/server/api/gists.ts` (lifecycle, revisions, lists) and
  `gists-social.ts` (stars, forks, commits, comments), registered in
  `server/api/index.ts`.
- `apps/web/src/server/api/serializers.ts`: `gistSimple`, `gist`,
  `gistFile`, `gistCommit`, `gistComment` — reusing `simpleUser`, `apiUrl`,
  `htmlUrl`, `isoTimestamp`, and `lib/file-preview.ts` /
  `lib/language-detection.ts` for a file's `type` and `language`.
- `server/gist-store.ts`: plain Drizzle helpers (insert with generated id,
  find by id, find by owner + id, update, delete, page queries, star/unstar,
  comment CRUD) — the gist twin of `comment-store.ts`.
- Rate limits: unchanged. Reads count against the existing read bucket, writes
  (including the 204s) against the write bucket.

The web page uses server functions in `server/gists.ts` (create/edit are
**not** in this design — `gh gist create`/`edit` and the REST API are the
write paths; a gist editor is a later issue) plus `server/gist-store.ts`, with
query keys/options added to `lib/query-options.ts`.

## GraphQL

`gh`'s gist commands are REST; GraphQL is for `User.gists` parity (and for
clients like `gh api graphql`). GitHub's schema has no `Query.gist`, so neither
do we.

- New domain `gists`, last in `apps/web/scripts/graphql-vendor.mjs`'s
  `DOMAINS` (it extends `User` and `RepositoryOwner` from earlier domains):
  `schema/gists.subset.json` → generated `schema/gists.graphql`;
  `resolvers/gists.ts`; registered in `graphql/schema.ts`.
- Types: `Gist` (fields `id`, `name`, `description`, `isPublic`, `isFork`,
  `owner`, `files`, `comments`, `forks`, `stargazers`, `stargazerCount`,
  `viewerHasStarred`, `pushedAt`, `createdAt`, `updatedAt`, `url`,
  `resourcePath`), `GistFile` (`name`, `encodedName`, `extension`, `size`,
  `isTruncated`, `isImage`, `language`, `text(truncate:)`), `GistComment`
  (`id`, `databaseId`, `author`, `body`, `bodyText`, `createdAt`,
  `updatedAt`, `authorAssociation`), `GistConnection`/`GistEdge`,
  `GistCommentConnection`/`GistCommentEdge`, `GistOrder`, `GistOrderField`,
  `GistPrivacy`, `Language` (`id`, `name`), and `User.gists(privacy, orderBy,
  first, last, after, before)`.
- `Gist.name` is the **gist id** (verified against GitHub: `name` equals the
  id string, not the first filename); `resourcePath` is `/{id}` and `url` is
  `{base}/gist/{id}` in GitHub's output, while REST's `html_url` keeps the
  owner — we serve our owner-qualified page for both.
- Another user's `User.gists` only ever returns public gists; the viewer's own
  connection honours `privacy` (`PUBLIC`, `SECRET`, `ALL`).
- `node(id:)` gains `Gist` and `GistComment` loaders in the core resolver
  (node ids above, legacy and `G_` forms), so `... on Gist` fragments work.
- Fixtures: `graphql-fixtures.test.ts`'s `PENDING` entry for the gist command
  moves out once the domain is served; the new operations get documents in
  `__fixtures__/gh/`.

## Limits (`apps/web/src/lib/limits.ts`)

| Constant | Value | Why |
| --- | --- | --- |
| `MAX_GIST_FILES` | 300 | GitHub truncates the files map past 300; refusing creation past it keeps every response complete |
| `MAX_GIST_FILE_NAME_CHARS` | 255 | a gist file name is a git tree path, so it gets the same bound as a path segment elsewhere |
| `MAX_GIST_DESCRIPTION_CHARS` | 1,000 | GitHub documents no bound; this bounds the persisted string |
| `MAX_GISTS_PER_USER` | 1,000 | GitHub documents no bound; matches the other per-owner collection caps, creation past it is 422 |
| `MAX_GIST_INLINE_CONTENT_BYTES` | 1 MiB | GitHub's per-file API truncation threshold |
| `MAX_GIST_INLINE_RESPONSE_BYTES` | 4,000,000 | below Vercel's 4.5 MB buffered-response cap; remaining files are marked `truncated` |
| `MAX_GIST_COMMENT_BODY_CHARS` | 65,535 | GitHub's `Gist Comment.body` maxLength |
| fork copy | `MAX_FORK_COPY_BYTES` (1 GiB) | reused, not duplicated |

`MAX_GIST_ID_CHARS` is not needed: `GIST_ID_RE` already fixes the length. The
contract package's `limits.ts` mirrors the values its schemas need
(`MAX_GIST_FILES`, `MAX_GIST_FILE_NAME_CHARS`, `MAX_GIST_DESCRIPTION_CHARS`,
`MAX_GIST_COMMENT_BODY_CHARS`), as it does today for repositories.

## Verification for each follow-up

Every issue lands with its own vitest coverage over the pglite harness
(`createUsers` + `mintToken` + `call`), and its acceptance test is written in
the issue. The whole feature is done when, against `pnpm dev:local`:

```sh
gh gist create --public -d "hello" hello.txt
gh gist list
gh gist view <id>
gh gist edit <id> -a hello.txt -f hello.txt
gh gist clone <id> /tmp/gist-clone   # git clone /<id>.git
gh gist delete <id>
```

and `GET /api/v3/gists/{id}` answers GitHub's shapes.

## Follow-up issues

Split into five issues, in dependency order. Each names the files it touches,
its hotspot files and its acceptance test.

1. [#355 Gist storage: schema, `gists/{id}/git` prefix, clone at
   `/{id}.git`](https://github.com/nandan-varma/pushstack/issues/355) — the
   tables, the storage prefix, `gist-git.ts`, `withGistLock`, the limits, and
   `git-upload-pack` at `/{id}.git`.
2. [#356 REST gists: create, get, update, delete, list, list-for-user,
   revisions](https://github.com/nandan-varma/pushstack/issues/356) — the
   lifecycle routes, the `gist` token scope, `gist-store.ts`,
   `gist-access.ts`, serializers.
3. [#357 REST gists: stars, forks, commits and
   comments](https://github.com/nandan-varma/pushstack/issues/357) — star,
   fork, commit-history and comment routes.
4. [#358 Gists on the web: `/gist`, `/gist/{user}/{id}`, revisions, raw URLs,
   clone](https://github.com/nandan-varma/pushstack/issues/358) — the pages,
   the redirects, the raw route.
5. [#359 GraphQL `User.gists` and the gh gist compatibility
   pass](https://github.com/nandan-varma/pushstack/issues/359) — the vendored
   `gists` domain, resolvers, node ids, gh fixtures and smoke.

## Out of scope

- A web editor for gists (create/edit stay REST and `gh`).
- Pushing to a gist over git (`git-receive-pack`); clone and fetch only.
- `application/vnd.github.raw+json` for `GET /gists/{id}` (GitHub returns the
  raw markdown); JSON only, noted in compat.
- Gist notifications, anonymous gists (GitHub removed them), and gists in
  search or the activity feed.
- A `gist.` hostname.
