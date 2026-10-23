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
	"repos/list-releases":
		"newest first; drafts only for write access; `assets` lists uploaded files; pagination",
	"repos/create-release":
		"write access (`repo:write`); `tag_name`, `target_commitish` (default branch; a missing tag is created there as a lightweight tag unless `draft`), `name`, `body`, `draft`, `prerelease`, `make_latest`, `generate_release_notes`; a published tag already used by a release is `422 already_exists`; `discussion_category_name` ignored",
	"repos/generate-release-notes":
		"write access; a bulleted list of the commits since `previous_tag_name` (default: the tag before `tag_name`) and a `Full Changelog` compare link; no pull request grouping, `.github/release.yml` or new-contributor section",
	"repos/get-latest-release":
		"the published, non-prerelease release marked `make_latest: true`, else the newest not marked `false`; `404` when there is none",
	"repos/get-release-by-tag":
		"published releases only (a draft has no public tag)",
	"repos/get-release-asset":
		"`Accept: application/octet-stream` streams the file with `200` (GitHub redirects with `302`) and counts a download",
	"repos/update-release-asset": "write access; `name`, `label`",
	"repos/delete-release-asset": "write access; removes the stored file",
	"repos/finish-release-asset-upload":
		"PushStack extension: completes a presigned upload started with `POST …/assets/uploads` after the bytes were PUT to R2; the stored size must equal the declared one, else the asset is discarded and the answer is `422`; the verified object is copied to its final key, so later `PUT`s to the URL have no effect; unfinished uploads are removed after the URL's 15 minutes",
	"repos/get-release": "drafts for write access only (`404` otherwise)",
	"repos/update-release":
		"write access; as create; publishing a draft sets `published_at` and creates a missing tag; `make_latest: true` moves the badge",
	"repos/delete-release":
		"write access; the tag stays, the assets are removed from storage; `204`",
	"repos/list-release-assets": "uploaded assets only; pagination",
	"repos/upload-release-asset":
		"write access; `?name=` (required) and `?label=`; the raw bytes as the body with their `Content-Type`; up to 4,000,000 bytes (a function request body is capped at 4.5 MB): larger files use the presigned flow; `upload_url` on a release points here; a name already on the release is `422 already_exists`",
	"repos/create-release-asset-upload":
		"PushStack extension for files over 4,000,000 bytes (up to 2 GiB): declares `name`, `label`, `content_type` and `size`, answers `201` with an `open` asset and a presigned R2 `upload_url` (valid 15 minutes) to `PUT` the bytes to, then `POST …/releases/assets/{asset_id}/finish`; `501` where the deployment has no R2",
	"repos/get-content":
		"`ref` (branch, tag or sha; default branch); a file is base64 `content`, a directory an array, `{path}` empty for the root. Media types: `raw` (a file's bytes, up to 50 MB, `application/octet-stream`), `object` (a directory as one object with `entries`); `html` is served as JSON",
	"repos/download-tarball-archive":
		"`302` to `/{owner}/{repo}/legacy.tar.gz/{refs/heads/branch|refs/tags/tag|sha}` on this origin, which streams the archive (GitHub redirects to codeload's `legacy.tar.gz`); `ref` is a branch, tag or full commit sha (default branch when omitted), `404` otherwise; entries sit under `{owner}-{repo}-{short sha}/`; submodules are empty directories; `.gitattributes` `export-ignore` and `export-subst` are not applied; up to 50,000 entries and 256 MiB, above that `413`",
	"repos/download-zipball-archive": "as `tarball`, redirecting to `legacy.zip`",
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
	"repos/create-commit-status":
		"write access (`repo:write` token scope); `sha` a full or abbreviated sha of a commit in the repository, else `422`; `state`, `target_url` (http or https), `description` (up to 140 characters), `context` (default `default`); up to 1,000 statuses per commit and context (`422` beyond); no `node_id`",
	"repos/list-commit-statuses-for-ref":
		"`ref` a branch, tag or sha (a branch name with `/` percent-encoded); newest first, every status of every context; pagination; no `node_id`",
	"repos/get-combined-status-for-ref":
		"the newest status of each context; `state` is `failure` when any is `failure` or `error`, `pending` when any is pending or there are none, else `success`; `required` is `null` (required checks aren't enforced); `statuses` are paginated; no `node_id`; `repository` is the minimal shape",
	"checks/list-for-ref":
		"`check_name`, `status`, `filter` (`latest` default: the newest run per name; `all`), pagination; `{ total_count, check_runs }`",
	"checks/list-suites-for-ref":
		"a commit has at most one suite (there are no GitHub Apps); `{ total_count, check_suites }`",
	"repos/get-commit":
		"with `stats` and up to 300 `files` (`page`/`per_page` page through up to 3,000); unknown ref is `422`; media types `diff`, `patch` (`format-patch`) and `sha`",
	"repos/compare-commits-with-basehead":
		"`base...head` or `base..head` (`owner:ref` sides); `status`, `ahead_by`, `behind_by`, `merge_base_commit`, up to 250 `commits` (paginated with `page`/`per_page`), up to 300 `files`; media types `diff` (merge base to head for `...`, tip to tip for `..`) and `patch` (one message per commit)",
	"checks/create":
		"write access (`repo:write` token scope; GitHub requires a GitHub App); `name`, `head_sha` (a commit of the repository, else `422`), `status` (default `queued`; `conclusion` implies `completed`), `started_at`, `completed_at`, `details_url`, `external_id`, `output` (`title`, `summary`, `text`); `completed` needs a `conclusion`; annotations, images and actions are ignored and `annotations_count` is `0` (no `annotations_url`); up to 1,000 runs per commit; `app`, `pull_requests`, `node_id` and `deployment` are omitted",
	"checks/get": "",
	"checks/update":
		"write access (`repo:write` token scope); the same fields as create, all optional; a `completed` run cannot go back to `queued` or `in_progress`",
	"checks/create-suite":
		"write access; `head_sha`; `201` with the commit's suite, created if absent (GitHub answers `200` when it exists)",
	"checks/get-suite":
		"`status` and `conclusion` are computed from the suite's runs; `app`, `pull_requests`, `before` and `after` are omitted",
	"checks/list-for-suite": "as `checks/list-for-ref`, for one suite",
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
		"returns issues **and pull requests** (a pull request carries a `pull_request` object); `state` (`open`/`closed`/`all`), `labels`, `milestone` (number, `none`, `*`), `assignee` (login, `none`, `*`), `sort` (`created`/`updated`/`comments`), `direction`",
	"issues/create":
		"any signed-in reader; `title`, `body`, `labels`, `assignees`, `milestone` (number; labels/assignees/milestone need write access, an unknown milestone is `422`)",
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
		"the author or a writer; `title`, `body`, `state`, `state_reason` (`completed` default, `not_planned`, `reopened`; one that contradicts the state is `422`), `labels`, `assignees`, `milestone` (number, or `null` to clear; writers only; records `milestoned`/`demilestoned` events); also accepts pull request numbers (state reasons are ignored for pull requests); merged pull requests stay closed and cannot be reopened",
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
		"write access; `title`, `body`, `head`, `base` (`draft` opens it as a draft: `mergeable_state` is `draft` and merging it is `405`; `issue`, `maintainer_can_modify` ignored); unknown or equal branches and an already-open pull request are `422`",
	"pulls/get": "",
	"pulls/update":
		"the author or a writer; `title`, `body`, `state`; changing `base` is `422`",
	"pulls/check-if-merged": "`204` once merged, else `404`",
	"pulls/merge":
		"`commit_title`, `commit_message`, `sha` (`409` when the head moved), `merge_method` (`merge` only; `squash`/`rebase` are `405`). A closed, merged, conflicting or review-blocked pull request is `405 Pull Request is not mergeable`. Returns `{ sha, merged, message }`",
	"pulls/list-commits": "oldest first, up to 250",
	"pulls/list-files":
		"up to 3000 files, paginated; `patch` holds the hunks (absent for binary and oversized files, and for files past a 2 MiB per-response patch budget). The whole diff is computed per request (cached for 30 seconds by the compared tips)",
	"issues/list-milestones":
		"`state` (`open` default, `closed`, `all`), `sort` (`due_on` default, `completeness`), `direction`; `open_issues`/`closed_issues` count issues and pull requests",
	"issues/create-milestone":
		"write access; `title`, `state`, `description`, `due_on`; a duplicate title is `422 already_exists`",
	"issues/get-milestone": "",
	"issues/update-milestone": "write access",
	"issues/delete-milestone":
		"write access; `204`; issues and pull requests in it lose the milestone",
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
