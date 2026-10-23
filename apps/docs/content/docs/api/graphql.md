---
title: "GraphQL API and gh"
description: "GitHub's GraphQL API at /api/graphql, and which stock gh (GitHub CLI) commands work against PushStack."
---

PushStack serves a subset of GitHub's GraphQL API at `/api/graphql`, so the
stock GitHub CLI (`gh`) treats it as a GitHub Enterprise Server host: REST at
`/api/v3`, GraphQL at `/api/graphql`.

- **Endpoint**: `POST https://git.nandan.fyi/api/graphql`
- **Code**: `apps/web/src/routes/api/graphql.ts` → `apps/web/src/server/graphql/index.ts`
  (auth, limits, metering, errors) → `schema.ts` (the vendored SDL plus
  resolvers) → `resolvers/<domain>.ts`. Resolvers call the same plain server
  modules the REST handlers use, never `createServerFn`s, and check
  permissions through `repo-access.ts`.

## Using gh

```sh
echo "$PUSHSTACK_TOKEN" | gh auth login --with-token --hostname git.nandan.fyi
gh auth status --hostname git.nandan.fyi
gh repo view git.nandan.fyi/OWNER/REPO
```

Measured with gh 2.102.1 by the real-gh smoke test
(`apps/web/scripts/smoke/gh-cli.smoke.test.ts`, part of `pnpm smoke:git`):

| Command | Status |
| --- | --- |
| `gh auth login --with-token`, `auth status`, `auth token` | Works |
| `gh api` (REST) | Works |
| `gh api graphql` (including `--paginate`) | Works |
| `gh repo view` (text and `--json`) | Works |
| `gh repo list` (text, `--json`, `--visibility`) | Works |
| `gh repo create` | Works (GraphQL `createRepository`) |
| `gh repo clone` | Works (git at `https://HOST/OWNER/REPO.git`) |
| `gh repo edit`, `gh repo delete`, `gh repo archive` | REST `PATCH`/`DELETE /repos/{owner}/{repo}` are served; topic edits and `gh repo view --json repositoryTopics` need GraphQL `repositoryTopics` (not yet) |
| `gh release …` | Served, not yet measured with real gh: `list` reads `Repository.releases`; `view`, `create`, `edit`, `delete`, `upload`, `download` use the REST release routes |
| `gh issue …`, `gh label …` | Not yet (issues domain) |
| `gh pr …` | Not yet (pulls domain) |

## Authentication and scopes

GraphQL always needs a token, as on GitHub: `Authorization: bearer pst_…` (or
`token pst_…`). Without one the answer is `401` with
`This endpoint requires you to be authenticated.`; a bad token is
`401 Bad credentials`.

REST and GraphQL responses carry `X-OAuth-Scopes` for a `repo:write` token:
`read:org, repo` (GitHub's classic scopes; there are no organizations, so
`read:org` hides nothing). A `repo:read` token has no classic equivalent and
gets no header, like a GitHub fine-grained token. gh reads the header from
`GET /api/v3/` to validate a token at login.

## Responses and errors

Errors use GitHub's shape, with the machine-readable `type` beside the message:

```json
{
  "data": { "repository": null },
  "errors": [
    {
      "type": "NOT_FOUND",
      "path": ["repository"],
      "locations": [{ "line": 1, "column": 3 }],
      "message": "Could not resolve to a Repository with the name 'alice/secret'."
    }
  ]
}
```

- A repository the caller can't read is `null` plus `NOT_FOUND`, exactly like
  a missing one.
- Validation and parse errors answer `200` with `errors` and no `data`.
- Unexpected failures are logged and answered with GitHub's generic message
  and the request id; internal messages never leave the server.

## Limits and rate limiting

Checked before any resolver runs:

- Every connection needs `first` or `last`, each at most 100
  (`MISSING_PAGINATION_BOUNDARIES`, `EXCESSIVE_PAGINATION`).
- The node count (each connection's page size times its parents') is at most
  50,000 (`MAX_NODE_LIMIT_EXCEEDED`), deliberately tighter than GitHub's
  500,000.
- Selection depth is at most 25 (`MAX_DEPTH_EXCEEDED`).

Each query costs GitHub's points (connection requests / 100, at least 1)
from its own `graphql` bucket: `X-RateLimit-Resource: graphql`,
`rateLimit { cost nodeCount limit remaining used resetAt }`, and
`resources.graphql` in `GET /rate_limit`.

## Connections and ids

Connections have GitHub's shape: `nodes`, `edges { cursor node }`,
`pageInfo { hasNextPage hasPreviousPage startCursor endCursor }` and
`totalCount`. Cursors are opaque.

Global ids are GitHub's legacy node ids (base64 of `04:User1`), the same as
REST `node_id`, and resolve through `node(id:)` / `nodes(ids:)`.

## Served schema

`User`: `id`, `databaseId`, `login`, `name`, `url`, `resourcePath`,
`createdAt`, `updatedAt`, `repositories(...)`, `repository(name:)`.
`Repository`: identity and URLs, `visibility`, `isPrivate`, `isEmpty`,
`defaultBranchRef`, `owner`, `stargazerCount`, `viewerHasStarred`,
`viewerPermission`, `viewerCanAdminister`, merge-method flags and the
`isArchived`, `isTemplate`, `homepageUrl`, `hasIssuesEnabled`, `hasWikiEnabled`,
`hasProjectsEnabled` (the repository's settings; wikis and projects default off
because none exist) and the always-false/null facts PushStack has no notion of
(forks, mirrors, `parent`, `repositoryTopics`). `pushedAt` is `null` (not tracked yet;
`PUSHED_AT` ordering uses `updatedAt`, as the REST API's `pushed` sort does).
`sshUrl` follows GitHub's format, but PushStack serves git over HTTPS only.

Commits are reachable through `Repository.object(expression:)` (a branch, `HEAD`
or a full sha; anything else, including trees, blobs and malformed names, is
`null`), `Repository.ref(qualifiedName:)` and `Ref.target`. `Commit` serves
`oid`, `abbreviatedOid`, `message`, `messageHeadline`, `authoredDate`,
`committedDate`, `url`, `resourcePath`, `repository` and `blame(path:)`.

`Commit.blame(path:)` returns `Blame { ranges { startingLine endingLine age
commit } }`, attributing each line to the commit that introduced it across all
parents, like `git blame` (renames are not followed). It is bounded work: a
file over 1 MiB or 20,000 lines, or a binary file, is `UNPROCESSABLE`; a
missing path is `NOT_FOUND`. Histories deeper than 400 commits, or too costly
to diff, attribute the unresolved lines to the oldest commit examined. `age`
is a heuristic, not GitHub's exact quantile: 1 (newest) to 10 (oldest), by the
rank of the range's commit date among the commit dates in that file's blame.
A blame costs 5 rate-limit points and a query may ask for at most one.

`Repository.releases(first:, after:, orderBy:)`, `release(tagName:)` and
`latestRelease` serve `Release` (`name`, `tagName`, `description`, `isDraft`,
`isLatest`, `isPrerelease`, `createdAt`, `publishedAt`, `author`,
`releaseAssets`, `url`) and `ReleaseAsset` (`name`, `size`, `contentType`,
`downloadCount`, `downloadUrl`, `uploadedBy`). Drafts appear to writers only,
and `release(tagName:)` finds published releases. `tag`, `tagCommit`,
reactions and mentions are not served.

`createRepository` refuses what PushStack cannot do (`teamId`, `template`,
`homepageUrl`, `INTERNAL`, disabling issues) with `UNPROCESSABLE`; it accepts
`hasWikiEnabled`, which gh always sends, and the repository reports
the default (`hasWikiEnabled: false`).

## Extending the schema

The schema is GitHub's own SDL, never hand-written. Each domain (`core`,
`repository`, `issues`, `pulls`) owns:

- `apps/web/src/server/graphql/schema/<domain>.subset.json`: the types and
  fields it serves;
- `schema/<domain>.graphql`: generated from it by
  `node apps/web/scripts/graphql-vendor.mjs schema.docs.graphql` (download
  GitHub's schema from `https://docs.github.com/public/fpt/schema.docs.graphql`).
  The first domain naming a type defines it; later ones emit `extend type`;
- `resolvers/<domain>.ts`: `{ types: { Type: { field: resolver } }, nodes: { Type: loader } }`.

Fixtures: `GH_CAPTURE_FIXTURES=1 pnpm --filter @pushstack/web smoke:git`
records the documents gh sends into `src/server/graphql/__fixtures__/gh/`.
`graphql-fixtures.test.ts` validates every fixture against the schema and
executes the served ones; commands whose domain is not served yet are listed in
its `PENDING` map and must keep failing validation until they move out.
