/**
 * Per-operation notes for the generated REST compatibility matrix
 * (apps/docs/content/docs/api/index.md): how PushStack serves each route and
 * where it differs from GitHub. Typed over every operation id, so adding a
 * route to the contract fails typecheck until it has a note ("" for none).
 * Regenerate the docs with `pnpm --filter @pushstack/api-contract docs:matrix`;
 * the package test fails while they drift.
 */
import { type OperationId, routes } from "./routes";

export const compatibilityNotes: Record<OperationId, string> = {
	"meta/root":
		"URL templates for the served endpoints only; gh reads `X-OAuth-Scopes` here",
	"rate-limit/get":
		"`resources.core`, `git` and (authenticated) `core_write` and `graphql`; not counted; no `search`",
	"users/get-authenticated": "",
	"repos/list-for-authenticated-user":
		"`visibility`, `affiliation` (`owner`, `collaborator`), `type`, `sort`, `direction`",
	"repos/create-for-authenticated-user":
		"`name`, `description`, `private`, `auto_init`, `gitignore_template`, `license_template` (templates apply only with `auto_init`, an unknown template is `422`); other fields ignored",
	"users/list-followers-for-authenticated-user": "pagination",
	"users/list-followed-by-authenticated-user": "pagination",
	"users/check-person-is-followed-by-authenticated": "`204` or `404`",
	"users/follow":
		"needs a `repo:write` token (there is no `user:follow` scope); `204`, idempotent; known difference: following yourself is `422`",
	"users/unfollow":
		"needs a `repo:write` token (there is no `user:follow` scope); `204`, idempotent",
	"activity/list-watched-repos-for-authenticated-user":
		"repositories you watch (not ignore) and can still read; pagination",
	"users/get-by-id":
		"public profile by integer id; `404` for an unknown or malformed id",
	"users/get-by-username": "",
	"users/list-followers-for-user": "pagination",
	"users/list-following-for-user": "pagination",
	"users/check-following-for-user": "`204` or `404`",
	"activity/list-repos-watched-by-user":
		"only repositories both the user and the caller can read; pagination",
	"repos/list-for-user": "public repositories only; `sort`, `direction`",
	"activity/list-notifications-for-authenticated-user":
		"any token; unread unless `all=true`; `participating`, `since`, `before`, `per_page` (up to 50); threads in repositories you can no longer read are hidden",
	"activity/mark-notifications-as-read":
		"marks threads updated at or before `last_read_at` (default now) read and answers `205`",
	"activity/get-thread-subscription-for-authenticated-user":
		"`reason` is always `null`",
	"activity/set-thread-subscription": "`ignored: true` mutes the thread",
	"activity/delete-thread-subscription":
		"unsubscribes until you are involved again",
	"activity/get-thread": "",
	"activity/mark-thread-as-read": "`205`",
	"activity/mark-thread-as-done":
		"`204`: the thread leaves the inbox until new activity",
	"repos/get": "",
	"activity/list-watchers-for-repo":
		"people watching (not ignoring) who can still read the repository; pagination",
	"activity/get-repo-subscription":
		"`404` when you are not subscribed; `reason` is always `null`",
	"activity/set-repo-subscription":
		"`repo:write` token; `ignored: true` ignores the repository, otherwise you watch all activity; `subscribed: false` without `ignored` removes the subscription",
	"activity/delete-repo-subscription":
		"`repo:write` token; back to participating-only notifications",
	"activity/list-repo-notifications-for-authenticated-user":
		"as `GET /notifications`, for one repository",
	"activity/mark-repo-notifications-as-read":
		"as `PUT /notifications`, for one repository",
	"repos/list-branches": "sorted by name",
	"repos/get-branch": "branch names may contain `/`",
	"repos/list-tags": "version order",
	"repos/get-content":
		"`ref` (branch, tag or sha; default branch); a file is base64 `content`, a directory an array, `{path}` empty for the root. Media types: `raw` (a file's bytes, up to 50 MB, `application/octet-stream`), `object` (a directory as one object with `entries`); `html` is served as JSON",
	"repos/create-or-update-file-contents":
		"write access; base64 `content` (bounded by the 1 MB API body cap), `message`, `branch` (default branch), `sha` (required to replace; `409` when stale), `author`/`committer` (`date` ignored); `201` creates, `200` replaces; in an empty repository the first write creates the branch it names and makes it the default",
	"repos/delete-file":
		"write access; `message`, `branch`, `sha` (required; `409` when stale)",
	"repos/list-commits":
		"`sha`, `path` (a file), `author`/`committer` (an email, or a login matching that account's email), `since`/`until` (committer date), pagination; newest first; `409` for an empty repository; filters search the newest 10,100 commits; `Link` has `next` but no `last`",
	"repos/list-commit-comments-for-repo": "oldest first; pagination",
	"repos/get-commit-comment":
		"no `node_id` or `author_association`; `reactions` is always empty (commit comment reactions aren't served)",
	"repos/update-commit-comment":
		"`body`; the author (while they can still comment) or a write collaborator, else `403`",
	"repos/delete-commit-comment":
		"the author (while they can still comment) or a write collaborator, else `403`; `204`",
	"repos/list-comments-for-commit":
		"`commit_sha` a full or abbreviated sha; unknown is `422`; oldest first; pagination",
	"repos/create-commit-comment":
		"any signed-in reader (`repo:write` token scope); `body`, optional `path` (a file the commit changes, else `422`) with `position` (1-based line of that file's diff) and deprecated `line` (stored and echoed)",
	"repos/get-commit":
		"with `stats` and up to 300 `files` (`page`/`per_page` page through up to 3,000); unknown ref is `422`; media types `diff`, `patch` (`format-patch`) and `sha`",
	"repos/compare-commits-with-basehead":
		"`base...head` or `base..head` (`owner:ref` sides); `status`, `ahead_by`, `behind_by`, `merge_base_commit`, up to 250 `commits` (paginated with `page`/`per_page`), up to 300 `files`; media types `diff` (merge base to head for `...`, tip to tip for `..`) and `patch` (one message per commit)",
	"git/get-ref":
		'branches and tags; annotated tags are `type: "tag"` (unpeeled)',
	"git/list-refs": "`{ref}` may be empty (every ref)",
	"git/list-matching-refs": "",
	"git/delete-ref":
		"write access; `heads/…` or `tags/…`; deleting a branch records `head_ref_deleted` on the closed pull requests it heads; a missing ref or the default branch is `422`",
	"git/get-commit": "full sha only",
	"git/get-tree": "`recursive`; up to 10,000 entries, then `truncated`",
	"git/get-blob": "base64; up to 3 MB",
	"git/create-ref":
		"write access; `ref` fully qualified (`refs/heads/…`, `refs/tags/…`); an existing ref is `422`",
	"git/update-ref":
		"write access; a branch only fast-forwards unless `force` (`422 Update is not a fast forward`)",
	"git/create-blob":
		"`content` with `encoding` `utf-8` (default) or `base64`; `201 { sha, url }`",
	"git/create-tree":
		"`tree` entries (`path`, `mode`, `type`, and `sha` or `content`; nested paths edit subtrees, `sha: null` deletes) over an optional `base_tree`; up to 10,000 entries",
	"git/create-commit":
		"`message`, `tree`, `parents`, `author`/`committer` (with `date`; default the caller, now); no ref moves",
	"git/get-tag": "annotated tag objects (unsigned)",
	"git/create-tag":
		"unsigned; create the `refs/tags/…` ref separately, as on GitHub",
	"issues/list-for-repo":
		"returns issues **and pull requests** (a pull request carries a `pull_request` object); `state` (`open`/`closed`/`all`), `labels`, `assignee` (login, `none`, `*`), `sort` (`created`/`updated`/`comments`), `direction`",
	"issues/create":
		"any signed-in reader; `title`, `body`, `labels`, `assignees` (labels/assignees need write access)",
	"issues/get-comment": "",
	"issues/update-comment": "",
	"issues/delete-comment": "`204`",
	"reactions/list-for-issue-comment": "filters by `content`; paginated",
	"reactions/create-for-issue-comment":
		"any signed-in reader (`repo:write` token); `201` when new, `200` with the existing reaction",
	"reactions/delete-for-issue-comment": "only your own reaction; `204`",
	"issues/get":
		"a pull request number returns the pull request; `closed_by` (the user who last closed it, else `null`) appears here only, not on lists; issues carry `state_reason`",
	"issues/update":
		"the author or a writer; `title`, `body`, `state`, `state_reason` (`completed` default, `not_planned`, `reopened`; one that contradicts the state is `422`), `labels`, `assignees`; also accepts pull request numbers (state reasons are ignored for pull requests); merged pull requests stay closed and cannot be reopened",
	"issues/list-comments": "comments of an issue or a pull request",
	"issues/create-comment": "any signed-in reader",
	"issues/list-events-for-timeline":
		"comments, events and submitted reviews (`reviewed` items with `state`, `body`, `commit_id`, `author_association` `OWNER`/`COLLABORATOR`/`NONE`), oldest first",
	"issues/list-events":
		"issue events only (no comments or reviews, as on GitHub), oldest first",
	"reactions/list-for-issue":
		"reactions on an issue or pull request; filters by `content`; paginated",
	"reactions/create-for-issue":
		"any signed-in reader (`repo:write` token); `201` when new, `200` with the existing reaction",
	"reactions/delete-for-issue": "only your own reaction; `204`",
	"issues/list-labels-on-issue": "",
	"issues/add-labels": "write access; returns every label",
	"issues/set-labels": "write access; returns every label",
	"issues/remove-all-labels": "write access; `204`",
	"issues/remove-label": "write access; returns the remaining labels",
	"pulls/list":
		"`state` (`open`/`closed`/`all`; closed includes merged), `head` (`branch` or `owner:branch`), `base`, `sort` (`created`/`updated`/`popularity`/`long-running`), `direction` (GitHub's defaults)",
	"pulls/create":
		"write access; `title`, `body`, `head`, `base` (`draft`, `issue`, `maintainer_can_modify` ignored); unknown or equal branches and an already-open pull request are `422`",
	"pulls/get": "",
	"pulls/update":
		"the author or a writer; `title`, `body`, `state`; changing `base` is `422`",
	"pulls/check-if-merged": "`204` once merged, else `404`",
	"pulls/merge":
		"`commit_title`, `commit_message`, `sha` (`409` when the head moved), `merge_method` (`merge` only; `squash`/`rebase` are `405`). A closed, merged, conflicting or review-blocked pull request is `405 Pull Request is not mergeable`. Returns `{ sha, merged, message }`",
	"pulls/list-commits": "oldest first, up to 250",
	"pulls/list-files":
		"up to 3000 files, paginated; `patch` holds the hunks (absent for binary and oversized files, and for files past a 2 MiB per-response patch budget). The whole diff is computed per request (cached for 30 seconds by the compared tips)",
	"issues/list-labels-for-repo": "",
	"issues/create-label":
		"write access; `color` optional (defaults to `ededed`); a duplicate name is `422 already_exists`",
	"issues/get-label": "",
	"issues/update-label": "write access",
	"issues/delete-label": "write access; `204`",
};

const HEADING = "## Compatibility matrix";

/** The matrix table: one row per contract route, in contract order. */
export function renderCompatibilityMatrix(): string {
	const rows = (Object.keys(routes) as OperationId[]).map((id) => {
		const route = routes[id];
		const path = route.path.replaceAll("{+", "{");
		const notes = compatibilityNotes[id].replaceAll("|", "\\|");
		return `| \`${route.method} ${path}\` | [\`${id}\`](${route.docs}) |${notes ? ` ${notes} ` : " "}|`;
	});
	return [
		"| Endpoint | GitHub operation | Notes |",
		"| --- | --- | --- |",
		...rows,
		"| everything else | | not implemented: `404 Not Found` |",
	].join("\n");
}

/**
 * Replaces the body of the "Compatibility matrix" section of `markdown`
 * (up to the next `## ` heading) with the generated note and table.
 */
export function withCompatibilityMatrix(markdown: string): string {
	const start = markdown.indexOf(`\n${HEADING}\n`);
	if (start < 0) throw new Error(`"${HEADING}" not found`);
	const bodyStart = start + HEADING.length + 2;
	const next = markdown.indexOf("\n## ", bodyStart);
	const end = next < 0 ? markdown.length : next + 1;
	const body = `\nGenerated from \`packages/api-contract\` (\`src/routes.ts\` and the notes in \`src/compat.ts\`); don't edit it by hand.\n\n${renderCompatibilityMatrix()}\n\n`;
	return markdown.slice(0, bodyStart) + body + markdown.slice(end);
}
