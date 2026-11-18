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
	"meta/get":
		"`installed_version` is the app's own version from `apps/web/package.json` (PushStack is not a GitHub Enterprise release; gh needs a semver for a non-github.com host to choose its search syntax)",
	"rate-limit/get":
		"`resources.core`, `git` and (authenticated) `core_write` and `graphql`; not counted; no `search`",
	"users/get-authenticated": "",
	"repos/list-for-authenticated-user":
		"`visibility`, `affiliation` (`owner`, `collaborator`), `type`, `sort`, `direction`, `since` and `before` (bound the last update)",
	"repos/create-for-authenticated-user":
		"`name`, `description`, `homepage`, `private`, `auto_init`, `gitignore_template`, `license_template` (templates apply only with `auto_init`, an unknown template is `422`), `has_issues`, `has_projects`, `has_wiki`, `is_template`; other GitHub fields, such as `allow_squash_merge` or `team_id`, are `422`",
	"users/list-followers-for-authenticated-user": "pagination",
	"users/list-followed-by-authenticated-user": "pagination",
	"users/check-person-is-followed-by-authenticated": "`204` or `404`",
	"users/follow":
		"needs a `repo:write` token (there is no `user:follow` scope); `204`, idempotent; known difference: following yourself is `422`",
	"users/unfollow":
		"needs a `repo:write` token (there is no `user:follow` scope); `204`, idempotent",
	"activity/list-watched-repos-for-authenticated-user":
		"repositories you watch (not ignore) and can still read; pagination",
	"orgs/list-memberships-for-authenticated-user":
		"every organization the caller belongs to, `pending` included; `state` (`active`, `pending`); pagination",
	"orgs/get-membership-for-authenticated-user":
		"`404` when the caller is not a member",
	"orgs/list-members":
		"active members only; `filter` and `role` are `422`; pagination",
	"orgs/check-membership-for-user": "`204` or `404`",
	"orgs/remove-member":
		"needs an organization owner; removes the membership, not a direct repository grant (that user becomes an outside collaborator); `204`",
	"orgs/get-membership-for-user": "needs an organization owner",
	"orgs/set-membership-for-user":
		"needs an organization owner; `role` is `admin` or `member` (default `member`); invites are not sent, the membership is active at once",
	"orgs/remove-membership-for-user":
		"needs an organization owner; `204`, also when there was no membership",
	"orgs/list-outside-collaborators":
		"needs an organization owner: users with a direct grant on an organization repository who are not active members; `filter` is `422`; pagination",
	"users/get-by-id":
		"public profile by integer id; `404` for an unknown or malformed id",
	"users/list-gpg-keys-for-authenticated-user":
		"only the caller's public keys; `public_key` is the base64 key packet and `raw_key` the armor",
	"users/create-gpg-key-for-authenticated-user":
		"needs a `repo:write` token (there is no `write:gpg_key` scope); `armored_public_key` only; private keys and keys that cannot sign are `422`",
	"users/get-gpg-key-for-authenticated-user": "`404` for another user's key",
	"users/delete-gpg-key-for-authenticated-user":
		"needs a `repo:write` token; `204`; `404` for another user's key",
	"users/list-ssh-signing-keys-for-authenticated-user":
		"only the caller's keys; `ssh-ed25519`, `ssh-rsa` and ECDSA keys",
	"users/create-ssh-signing-key-for-authenticated-user":
		"needs a `repo:write` token (there is no `write:ssh_signing_key` scope); `key` and `title` (default `Signing key`); anything but a public key line is `422`",
	"users/get-ssh-signing-key-for-authenticated-user":
		"`404` for another user's key",
	"users/delete-ssh-signing-key-for-authenticated-user":
		"needs a `repo:write` token; `204`; `404` for another user's key",
	"users/get-by-username": "",
	"search/repos":
		"words match the name or description; `user:` (one), `is:public`/`is:private`, `topic:` (repeats AND); `org:` and other qualifiers are `422`; `sort` is only `updated` (no best-match ranking: newest first); only repositories the caller can read; the first 100 per page, pages past 10,000 items are empty",
	"search/issues-and-pull-requests":
		"GitHub's issue and pull request syntax over every repository the caller can read (or public ones, anonymously); `repo:` and `user:` (one each), `is:`, `type:`, `state:`, `author:`, `label:`, `assignee:`, `mentions:`, `review-requested:`, `reviewed-by:`, `milestone:`, `no:`, `draft:`; any other qualifier, a negated one or an unquoted `scheme:` is `422`; `advanced_search` and `search_type` (GitHub's advanced and semantic search) are `422`; `sort` is `created`, `updated` or `comments`; pages past 10,000 items are empty",
	"users/list-followers-for-user": "pagination",
	"users/list-following-for-user": "pagination",
	"users/check-following-for-user": "`204` or `404`",
	"activity/list-repos-watched-by-user":
		"only repositories both the user and the caller can read; pagination",
	"repos/list-for-user":
		"public repositories only; `type` (`owner` by default, `member`, `all`), `sort`, `direction`",
	"activity/list-notifications-for-authenticated-user":
		"any token; unread unless `all=true`; `participating`, `since`, `before`, `per_page` (up to 50); threads in repositories you can no longer read are hidden",
	"activity/mark-notifications-as-read":
		"marks threads updated at or before `last_read_at` (default now) read and answers `205`; `read` is accepted only as `true`",
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
	"repos/update":
		"owner or admin collaborator (`403` otherwise); `name`, `description`, `homepage`, `private`, `visibility`, `has_issues`, `has_projects`, `has_wiki`, `is_template`, `default_branch`, `archived`, `allow_merge_commit`, `allow_squash_merge`, `allow_rebase_merge` (the merge methods pull requests may use; all on by default, and at least one must stay on, else `422`); other GitHub fields, such as `allow_auto_merge`, are `422`. Renaming moves the storage; unarchiving is the only change an archived repository accepts",
	"repos/delete": "owner only (`403` otherwise); `204`",
	"repos/get-all-topics": "paginated",
	"repos/replace-all-topics":
		"`names` (at most 20, lowercase letters, digits and hyphens, at most 50 characters each; invalid is `422`)",
	"repos/transfer":
		"`new_owner` must be a user; the transfer is immediate (no pending invitation) and answers `202`; `new_name` renames; `team_ids` is `422` (there are no teams); the old URL does not redirect",
	"repos/create-using-template":
		"the template must be readable and `is_template`; copies the template's default branch as one `Initial commit` (files only: no history, symlinks, submodules or file modes); `owner` must be the caller (no organizations); `include_all_branches` must be `false` (`true` is `422`); issues, labels, topics and settings are not copied",
	"repos/list-forks":
		"only the forks the caller can read (a private fork is not listed to someone who cannot read it; a private parent is `404` to them); `sort` `newest` (default), `oldest`, `stargazers` or `watchers` (stars); pagination",
	"repos/create-fork":
		"`202` with the fork (`fork`, `parent` and `source`); the fork is a copy of the parent's git data, so it carries every branch and tag (`default_branch_only` is ignored) and the parent's visibility, description and default branch, but not its issues, labels, topics, settings, releases or stars; `organization` must be the caller (no organizations); forking a repository you already forked under that name answers that fork; another repository of that name is `422`; a parent over 1 GiB of git data is `422`; forks per user per hour are limited (`RATE_LIMIT_FORKS_USER`, `403` when exceeded); an archived parent can be forked",
	"repos/merge-upstream":
		"`repo:write` token and write access to the fork; `branch` is a branch of the fork, synced with the parent's branch of the same name: `fast-forward` when only the parent moved, `merge` (a merge commit by the caller) when both did, `none` when already up to date; a conflict is `409`, a repository that is not a fork or a parent without the branch is `422`, a missing fork branch `404`; the parent must be readable by the caller; a sync over the per-request copy caps is `422`",
	"gists/list":
		"the caller's public and secret gists, newest update first; `since`; pagination",
	"gists/list-public":
		"public gists only, newest update first; `since`; pagination",
	"gists/list-starred":
		"gists the caller starred (secret ones included when starred); `since`; pagination",
	"gists/list-for-user":
		"a user's public gists only; `404` for an unknown user; `since`; pagination",
	"gists/create":
		"needs a `gist` token; `files` (1–300, content inline), `description`, `public` (default `false`, as gh); `201` with `Location`; `422` at 1,000 gists or an unsafe path",
	"gists/get":
		"anyone holding the id reads it: secret means unlisted, not private",
	"gists/get-revision":
		"the gist's files at a commit sha; an unknown or malformed revision is `404`",
	"gists/update":
		"`PATCH` (and `POST`, as gh sends it); the owner and a `gist` token only (`404` otherwise); file keys are current names: `content` replaces, `filename` renames (keeping content when omitted), a null entry or an object with neither deletes; one commit per change",
	"gists/delete":
		"the owner and a `gist` token only (`404` otherwise); `204`; the git storage is removed",
	"gists/check-is-starred":
		"needs authentication; `204` when starred, `404` when not",
	"gists/star": "needs a `gist` token; `204`, idempotent",
	"gists/unstar": "needs a `gist` token; `204`, idempotent",
	"gists/list-forks":
		"the gists forked from this one, newest update first; pagination",
	"gists/fork":
		"needs a `gist` token; `201` with the fork, whose files and visibility are the parent's; `422` at 1,000 gists or when the parent is over the fork copy cap",
	"gists/list-commits":
		"newest first; `version` is the commit sha and `change_status` its lines against the first parent; pagination",
	"gists/list-comments": "oldest first; pagination",
	"gists/create-comment":
		"needs a `gist` token; `body` (at most 65,535 characters, else `422`); `201` with `Location`",
	"gists/get-comment": "`404` for another gist's comment",
	"gists/update-comment":
		"the comment's author only (`404` otherwise); `body` (at most 65,535 characters)",
	"gists/delete-comment": "the comment's author only (`404` otherwise); `204`",
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
	"repos/list-branches":
		"sorted by name; the `protected` filter is `422`; each branch's `protected` is the rule that matches its name",
	"repos/get-branch": "branch names may contain `/`",
	"repos/get-branch-protection":
		"read access; classic rules only, and `404 Branch not protected` when no rule matches; `required_signatures`, `required_linear_history`, `block_creations`, `required_conversation_resolution`, `lock_branch` and `allow_fork_syncing` are always disabled, and `dismissal_restrictions`/`bypass_pull_request_allowances` are always empty",
	"repos/get-status-checks-protection":
		"`404 Required status checks not enabled` unless the rule requires status checks; `contexts` and `checks` are the same contexts in name order",
	"repos/get-all-status-check-contexts":
		"the rule's contexts in name order; `404` unless the rule requires status checks",
	"repos/get-pull-request-review-protection":
		"`404 Required pull request reviews not enabled` unless the rule requires reviews",
	"repos/update-branch-protection":
		"admin or owner only (`403 Must have admin rights to Repository.`); a full replace of the rule whose pattern is exactly the branch path (creating it when absent), unlike the reads, which match branch names; fields GitHub declares required here (`enforce_admins`, `required_pull_request_reviews`, `restrictions`) are optional so a minimal `PUT` works; `restrictions`, linear history, block creations, conversation resolution, lock branch and fork syncing are `422`",
	"repos/delete-branch-protection":
		"admin or owner only; `204`; deletes the rule whose pattern is exactly the branch path, `404` when there is none",
	"repos/update-status-check-protection":
		"admin or owner only; addresses the rule whose pattern is exactly the branch path; `strict` defaults to `false` and `contexts`/`checks` (checks wins) replace the rule's contexts; `404` when unprotected",
	"repos/remove-status-check-protection":
		"admin or owner only; `204`; disables required status checks and clears their contexts; `404` when unprotected",
	"repos/add-status-check-contexts":
		"admin or owner only; `{contexts}`; adding a context twice keeps one; returns every context in name order; `404` unless the rule requires status checks",
	"repos/set-status-check-contexts":
		"admin or owner only; replaces the contexts whole; `404` unless the rule requires status checks",
	"repos/remove-status-check-contexts":
		"admin or owner only; the body travels on the `DELETE`, as GitHub's does; returns the remaining contexts; `404` unless the rule requires status checks",
	"repos/update-pull-request-review-protection":
		"admin or owner only; enables required reviews if they were off; `required_approving_review_count` is 0–6 and above is `422`; `dismissal_restrictions`, `require_last_push_approval` and `bypass_pull_request_allowances` are `422`; `404` when unprotected",
	"repos/delete-pull-request-review-protection":
		"admin or owner only; `204`; disables required reviews; `404` when unprotected",
	"repos/set-admin-branch-protection":
		"admin or owner only; enables `enforce_admins` and returns the toggle; `404` when unprotected",
	"repos/delete-admin-branch-protection":
		"admin or owner only; `204`; disables `enforce_admins`; `404` when unprotected",
	"repos/set-force-push-protection":
		"no GitHub REST operation today (the toggle is set through `PUT …/protection`); admin or owner only; enables force pushes and returns the toggle; `404` when unprotected",
	"repos/delete-force-push-protection":
		"no GitHub REST operation today; admin or owner only; `204`; blocks force pushes; `404` when unprotected",
	"repos/set-deletion-protection":
		"no GitHub REST operation today; admin or owner only; enables branch deletion and returns the toggle; `404` when unprotected",
	"repos/delete-deletion-protection":
		"no GitHub REST operation today; admin or owner only; `204`; blocks branch deletion; `404` when unprotected",
	"repos/get-admin-branch-protection":
		"the `enforce_admins` toggle of the matching rule; `404` when unprotected",
	"repos/get-force-push-protection":
		"no GitHub REST operation today (GitHub carries it only in the protection object); the same `{url, enabled}` toggle; `404` when unprotected",
	"repos/get-deletion-protection":
		"no GitHub REST operation today (GitHub carries it only in the protection object); the same `{url, enabled}` toggle; `404` when unprotected",
	"repos/list-tags": "version order",
	"repos/list-webhooks":
		"needs a `repo:write` token (there is no `admin:repo_hook` scope) and ownership or admin; pagination; `config.secret` reads as `********`, never the secret",
	"repos/create-webhook":
		"needs a `repo:write` token and ownership or admin (`403 Must have admin rights to Repository.`); `name` must be `web`, `active` defaults to `true`, `events` to `['push']`, `config.content_type` to `form`; an `https` `config.url`, a known event name and at most 20 hooks per event type are required (`422`), and `insecure_ssl: 1` is `422`; an empty `secret` stores none",
	"repos/get-webhook":
		"needs a `repo:write` token and ownership or admin; `404` for a hook of another repository",
	"repos/update-webhook":
		"`active`, `events` (replaces), `add_events`, `remove_events` (merged) and `config`; a `config` without `secret` clears the stored secret, and no `config` leaves it; same access and `422` rules as create",
	"repos/delete-webhook":
		"needs a `repo:write` token and ownership or admin; `204`",
	"repos/get-webhook-config-for-repo":
		'`secret` reads as `********` or `""`; never the secret itself',
	"repos/update-webhook-config-for-repo":
		'any subset of `url`, `content_type`, `secret` and `insecure_ssl: "0"`; a body without `secret` clears the stored secret',
	"repos/ping-webhook":
		"needs a `repo:write` token and ownership or admin; `204` immediately, the `ping` delivery happens after the response and appears in the hook's delivery log",
	"repos/list-webhook-deliveries":
		'ownership or admin; newest first; pages by `cursor` (a delivery id) with a `Link` `rel="next"`, default 30 and at most 100 per page; `status=success` is 2xx–3xx and `status=failure` 4xx–5xx, anything else or a non-numeric cursor is `422`',
	"repos/get-webhook-delivery":
		"ownership or admin; `request.payload` and `response.payload` are the exact bytes sent and received as text, `null` when not retained; a delivery of another hook or repository is `404`",
	"repos/redeliver-webhook-delivery":
		"ownership or admin; `202` immediately, a new delivery row (with a fresh `X-GitHub-Delivery`) is sent after the response from the stored bytes; `422` when the payload was not retained",
	"repos/list-releases":
		"newest first; drafts only for write access; `assets` lists uploaded files; pagination",
	"repos/create-release":
		"write access (`repo:write`); `tag_name`, `target_commitish` (default branch; a missing tag is created there as a lightweight tag unless `draft`), `name`, `body`, `draft`, `prerelease`, `make_latest`, `generate_release_notes`; a published tag already used by a release is `422 already_exists`; `discussion_category_name` is `422`; at 1,000 releases in the repository it is `422`",
	"repos/generate-release-notes":
		"write access; a bulleted list of the commits since `previous_tag_name` (default: the tag before `tag_name`) and a `Full Changelog` compare link; no pull request grouping, `.github/release.yml` (`configuration_file_path` is `422`) or new-contributor section",
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
		"write access; as create (`discussion_category_name` is `422`); publishing a draft sets `published_at` and creates a missing tag; `make_latest: true` moves the badge",
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
		"`check_name`, `status`, `filter` (`latest` default: the newest run per name; `all`), pagination; `app_id` is `422`; `{ total_count, check_runs }`",
	"checks/list-suites-for-ref":
		"a commit has at most one suite (there are no GitHub Apps); `app_id` and `check_name` are `422`; `{ total_count, check_suites }`",
	"repos/get-commit":
		"with `stats` and up to 300 `files` (`page`/`per_page` page through up to 3,000); unknown ref is `422`; media types `diff`, `patch` (`format-patch`) and `sha`; `diff` and `patch` past the 4 MB media cap are `406`",
	"repos/compare-commits":
		"`base...head` or `base..head` (`owner:ref` sides: another owner names a fork in the repository's fork network, for a signed-in caller who can read it, else `404`; its commit is copied in and kept for a day); `status`, `ahead_by`, `behind_by`, `merge_base_commit`, up to 250 `commits` (paginated with `page`/`per_page`), up to 300 `files`; media types `diff` (merge base to head for `...`, tip to tip for `..`) and `patch` (one message per commit); `diff` and `patch` past the 4 MB media cap are `406`",
	"checks/create":
		"write access (`repo:write` token scope; GitHub requires a GitHub App); `name`, `head_sha` (a commit of the repository, else `422`), `status` (default `queued`; `conclusion` implies `completed`), `started_at`, `completed_at`, `details_url`, `external_id`, `output` (`title`, `summary`, `text`); `completed` needs a `conclusion`; `actions` is `422`; `output.annotations` and `output.images` are `422` unless empty (a no-op); `annotations_count` is `0` (no `annotations_url`); up to 1,000 runs per commit; `app`, `pull_requests`, `node_id` and `deployment` are omitted",
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
		"`message`, `tree`, `parents`, `author`/`committer` (with `date`; default the caller, now); no ref moves; `signature` is `422`",
	"git/get-tag": "annotated tag objects (unsigned)",
	"git/create-tag":
		"unsigned; create the `refs/tags/…` ref separately, as on GitHub",
	"issues/list-for-repo":
		"returns issues **and pull requests** (a pull request carries a `pull_request` object); `state` (`open`/`closed`/`all`), `labels`, `milestone` (number, `none`, `*`), `assignee` (login, `none`, `*`), `sort` (`created`/`updated`/`comments`), `direction`, `creator`, `mentioned`, `type` (`*` or `none`: PushStack has no issue types, so both match every issue; a named type is `422`), `since` (last updated at or after; `issue_field_values` is `422`)",
	"issues/create":
		"any signed-in reader; `title`, `body`, `labels`, `assignees`, `assignee` (deprecated: one login, added to `assignees`), `milestone` (number; labels/assignees/milestone need write access, an unknown milestone is `422`); `type`, `parent_issue_id` and `issue_field_values` are `422`",
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
		"the author or a writer; `title`, `body`, `state`, `state_reason` (`completed` default, `not_planned`, `reopened`; one that contradicts the state is `422`), `labels`, `assignees`, `assignee` (deprecated: one login, `null` clears; added to `assignees`), `milestone` (number, or `null` to clear; writers only; records `milestoned`/`demilestoned` events); also accepts pull request numbers (state reasons are ignored for pull requests); merged pull requests stay closed and cannot be reopened; `type`, `duplicate_issue_id` and `issue_field_values` are `422`",
	"issues/list-comments":
		"comments of an issue or a pull request; `since` (updated at or after)",
	"issues/create-comment": "any signed-in reader",
	"issues/list-events-for-timeline":
		"comments, events and submitted reviews (`reviewed` items with `state`, `body`, `commit_id`, `author_association` `OWNER`/`COLLABORATOR`/`NONE`), oldest first; `exclude` is `422`",
	"issues/list-events":
		"issue events only (no comments or reviews, as on GitHub), oldest first",
	"reactions/list-for-issue":
		"reactions on an issue or pull request; filters by `content`; paginated",
	"reactions/create-for-issue":
		"any signed-in reader (`repo:write` token); `201` when new, `200` with the existing reaction",
	"reactions/delete-for-issue": "only your own reaction; `204`",
	"issues/list-labels-on-issue": "paginated",
	"issues/add-labels": "write access; returns every label",
	"issues/set-labels": "write access; returns every label",
	"issues/remove-all-labels": "write access; `204`",
	"issues/remove-label": "write access; returns the remaining labels",
	"pulls/list":
		"`state` (`open`/`closed`/`all`; closed includes merged), `head` (`branch` or `owner:branch`), `base`, `sort` (`created`/`updated`/`popularity`/`long-running`), `direction` (GitHub's defaults)",
	"pulls/create":
		"write access; `title`, `body`, `head`, `base` (`draft` opens it as a draft: `mergeable_state` is `draft` and merging it is `405`; `issue` and `maintainer_can_modify` are `422`); `head` is `branch` or `owner:branch`, and `owner:branch` from a fork in the base's fork network (`head_repo` names it when it is not called like the base) copies the head into the base as `refs/pull/{n}/head`: the caller must read the fork, a private fork into a public base is `422`, and `head.repo` is `null` once the fork is deleted or unreadable; the head follows the fork branch on each read and merge; unknown or equal branches and an already-open pull request are `422`",
	"pulls/get":
		"media types `diff` (the unified diff, base to head) and `patch` (one format-patch section per commit, oldest first, up to 250 commits); both are `text/plain; charset=utf-8` (an inert type with `nosniff`, not GitHub's `application/vnd.github.v3.diff`/`.patch` Content-Type) and stream up to the 4 MB media cap, past which the answer is `406`",
	"pulls/update":
		"the author or a writer; `title`, `body`, `state`; changing `base` is `422`; `maintainer_can_modify` is `422`",
	"pulls/check-if-merged": "`204` once merged, else `404`",
	"pulls/merge":
		"`commit_title`, `commit_message`, `sha` (`409` when the head moved), `merge_method` (`merge`, `squash` or `rebase`; a method the repository disallows is `405`). `merge` always records a merge commit, even when the base has not moved. Squash makes one commit on the target, authored by the pull request's author and committed by the merging user, titled `<title> (#N)` by default, with a bulleted list of the commits (up to 250, then a truncation line) when there are several; rebase replays the branch's commits without a merge commit and ignores `commit_title`/`commit_message`; a branch of more than 250 commits, one with a merge commit, or a range that would read more than 1000 commits of the base's own history is `405`. A closed, merged, conflicting or review-blocked pull request is `405 Pull Request is not mergeable`. Returns `{ sha, merged, message }`",
	"pulls/list-commits": "oldest first, up to 250",
	"pulls/list-files":
		"up to 3000 files, paginated; `patch` holds the hunks (absent for binary and oversized files, and for files past a 2 MiB per-response patch budget). The whole diff is computed per request (cached for 30 seconds by the compared tips)",
	"pulls/list-requested-reviewers":
		"`{ users, teams }`; `teams` is always empty (no teams yet)",
	"pulls/request-reviewers":
		"`reviewers` (collaborators only, at most 15; never the author); `team_reviewers` is refused. Each new request is a `review_requested` event and notifies the reviewer (`reason: review_requested`). Needs write access or authorship. `201` with the pull request",
	"pulls/remove-requested-reviewers":
		"`reviewers` must all have a pending request (`422` otherwise); records `review_request_removed`. Returns the pull request",
	"issues/list-milestones":
		"`state` (`open` default, `closed`, `all`), `sort` (`due_on` default, `completeness`), `direction`; `open_issues`/`closed_issues` count issues and pull requests",
	"issues/create-milestone":
		"write access; `title`, `state`, `description`, `due_on`; a duplicate title is `422 already_exists`; at 1,000 milestones in the repository it is `422`",
	"issues/get-milestone": "",
	"issues/update-milestone": "write access",
	"issues/delete-milestone":
		"write access; `204`; issues and pull requests in it lose the milestone",
	"issues/list-labels-for-repo": "",
	"issues/create-label":
		"write access; `color` optional (defaults to `ededed`); a duplicate name is `422 already_exists`; at 1,000 labels in the repository it is `422`",
	"issues/get-label": "",
	"issues/update-label": "write access; `archived` is `422`",
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
