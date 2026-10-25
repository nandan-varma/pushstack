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
| `gh repo edit` | Settings go through GraphQL `updateRepository` (name, description, homepage, issue, wiki and project flags, template); visibility and topics use REST `PATCH /repos/{owner}/{repo}` and `PUT …/topics`, and topic edits need GraphQL `repositoryTopics` (not yet). Not yet measured with real gh |
| `gh repo delete` | REST `DELETE /repos/{owner}/{repo}` (GitHub has no delete mutation in GraphQL either) |
| `gh repo archive` | Not yet (`archiveRepository` is not served; REST `PATCH` with `archived` is) |
| `gh release …` | Served, not yet measured with real gh: `list` reads `Repository.releases`; `view`, `create`, `edit`, `delete`, `upload`, `download` use the REST release routes |
| `gh issue list`, `gh issue view`, `gh issue status` | GraphQL reads served (`Repository.issues`/`issue`/`issueOrPullRequest`); fixture-tested, not yet measured with real gh |
| `gh label list` | GraphQL `Repository.labels` served; fixture-tested, not yet measured with real gh |
| `gh issue create`, `gh issue edit`, `gh issue close`, `gh label create/edit/delete` | Not yet (issue mutations; label mutations are served in GraphQL as below, not yet measured with real gh) |
| `gh pr list`, `gh pr view`, `gh pr create`, `gh pr ready` | GraphQL reads and draft mutations served; fixture-tested, not yet measured with real gh |
| `gh pr status` | Not yet (requires GraphQL search) |

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

- Every connection that reads a page needs `first` or `last`, each at most 100
  (count-only `totalCount` selections need neither)
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

Global ids resolve through `node(id:)` / `nodes(ids:)`. Users, repositories,
issues, labels, refs, pull requests and issue comments use GitHub's legacy node
id form (base64 of `04:User1`), the same as REST `node_id`. The codes for
commits, milestones, reactions, pull request reviews, releases and release assets
are not verified against GitHub yet (tracked in #269); GitHub gives commits,
releases and release assets a newer id format, so do not rely on their exact
encoding.

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
and `release(tagName:)` finds published releases. `tag`, reactions and mentions are not served; `tagCommit` resolves the tagged commit.

`Repository.pullRequest(number:)` and `pullRequests(first:, after:, states:,
baseRefName:, headRefName:, labels:, orderBy:)` serve GitHub's `PullRequest`
shape, including `isDraft`, identity, branches, author, state, comments, labels,
assignees, milestone, reviews, review requests, reactions, diff totals, and
commits with status/check rollups. A `labels` filter takes at most 100 names
(`UNPROCESSABLE` beyond that). `CLOSED` excludes merged pull requests; `MERGED`
selects them. Default `gh pr list` and `gh pr view` documents are validated and
executed against the real stores in behavior tests. There are no cross-
repository pulls, native auto-merge, or native Actions workflows. Review
reactions are not stored. Mergeability reports `UNKNOWN` until a merge is
attempted. Commit walks and page offsets are bounded; exceeding a bound returns
`UNPROCESSABLE`, never a truncated connection presented as complete.

`createPullRequest(input:)` accepts `draft`, repository node id, head/base
branches, title and body. It requires write access and a `repo:write` token,
rejects missing branches, duplicate open pulls (checked and inserted under the
repository lock, so concurrent creates cannot both succeed) and branches with no
new commits, and applies the same text limits as REST/web. Cross-repository
heads and disabling maintainer modifications are unsupported and rejected.
`markPullRequestReadyForReview` and `convertPullRequestToDraft` accept a pull
request node id, preserve `clientMutationId`, and allow its author or a writer
to change an open pull request. Marking ready requests CODEOWNERS reviews.
`closePullRequest`, `reopenPullRequest` and `updatePullRequest` (title, body,
`state`) follow the same author-or-writer rule. Closing a merged pull request
is a no-op and reopening one is refused, as on REST. `updatePullRequest`
refuses a changed `baseRefName` and labels, assignees, milestone and projects
are not yet accepted (unknown fields fail validation rather than being ignored).
`mergePullRequest` follows the REST merge rules: it needs write access (or
`canMergePullRequest`) and a `repo:write` token, refuses archived repositories,
drafts and closed or merged pulls, and is blocked by a changes-requested review
unless the caller can moderate. `expectedHeadOid` must match the head branch
(`UNPROCESSABLE` otherwise). Only `mergeMethod: MERGE` is supported; `SQUASH`
and `REBASE` are refused like REST's `405`. `commitHeadline` and `commitBody`
set the merge commit message. `authorEmail` is not accepted. Both
`mergePullRequest` and `updatePullRequest` resolve `actor` to the caller.
Every top-level mutation costs at least five GraphQL rate-limit points,
including aliases.

`Commit.zipballUrl` and `Commit.tarballUrl` point to source archives pinned to
the commit sha. Reach them through `Ref.target` or `Repository.object` using
an inline fragment on `Commit`, as in GitHub's schema; these fields are not
on `Repository`, `Ref`, or `Release`. Releases expose the commit through `Release.tagCommit`. Private archive downloads require an
authorized session or PAT, just like other archive URLs.

`createRepository` refuses what PushStack cannot do (`teamId`, `template`,
`homepageUrl`, `INTERNAL`, disabling issues) with `UNPROCESSABLE`; it accepts
`hasWikiEnabled`, which gh always sends, and the repository reports
the default (`hasWikiEnabled: false`).

`Repository.issue(number:)`, `issueOrPullRequest(number:)` and `issues(first:,
after:, last:, before:, states:, labels:, orderBy:, filterBy:)` serve `Issue`
(identity, `title`, `body`, `state`, `stateReason`, `closed`, `closedAt`,
`author`, `repository`, `milestone`, `labels`, `assignees`, `comments`,
`reactionGroups`, URLs). `states` and `filterBy.states` both narrow, and
`filterBy` serves `assignee`, `createdBy`, `mentioned`, `labels` and
`milestone`; `since` and `viewerSubscribed: true` are `UNPROCESSABLE`. The `labels` and `filterBy.labels` arguments, together, take at most 100 names
(`UNPROCESSABLE` beyond that). An issue page whose bodies exceed the 1 MB
response budget is `UNPROCESSABLE`, so ask for fewer issues. An issue has
no type, parent or sub-issues in PushStack, so `issueType` and `parent` are
null, `subIssues` is empty and `subIssuesSummary` is zero. Without a `states`
argument every issue is listed. An unknown or unreadable number is `NOT_FOUND`,
and an issue is a `node(id:)` target. Issue mutations are not served yet.

The GraphQL overlap check accepts two enum types under one response name, as
GitHub does for `Issue.state` and `PullRequest.state` in `gh issue view`.

`updateRepository(input:)` takes `repositoryId` and the fields GitHub's
`UpdateRepositoryInput` has for settings PushStack keeps: `name`, `description`,
`homepageUrl`, `hasIssuesEnabled`, `hasWikiEnabled`, `hasProjectsEnabled` and
`template`. Other fields fail validation. It needs a `repo:write` token and an
owner or admin (`FORBIDDEN` for other writers, `NOT_FOUND` for a repository
they cannot read). Names follow the create rules, the description and homepage
are capped as in REST, and an archived repository refuses changes as REST does.
GitHub has no `deleteRepository` mutation; `gh repo delete` uses REST.

`Repository.labels(first:, after:, last:, before:, query:, orderBy:)` serves
`LabelConnection` with `totalCount`. `orderBy` is `CREATED_AT` (the default) or
`NAME`, each with a direction; `ISSUE_COUNT` is `UNPROCESSABLE`. `query` matches
a name or description, case-insensitively, up to 100 characters. `Label`
serves `id`, `name`, `color` and `description`; `url`, `isDefault`, `createdAt`
and the label's issues and pull requests are not served yet.
`createLabel`, `updateLabel` and `deleteLabel` take the REST rules for names
(50 characters), colors (six hex digits, `#` optional) and descriptions (100
characters), need a `repo:write` token and push access (`FORBIDDEN`
otherwise), and refuse a duplicate name with `UNPROCESSABLE`.

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
