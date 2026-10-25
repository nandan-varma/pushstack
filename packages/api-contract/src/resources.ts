/**
 * GitHub's resource shapes as PushStack serves them: GitHub's names and
 * types, with fields PushStack has no equivalent for omitted (never renamed).
 * Objects are strict, so a field the server adds or drops is drift.
 */
import { z } from "zod";

const timestamp = z.iso.datetime();
const url = z.string();
const sha = z.string().regex(/^[0-9a-f]{40}$/);
const count = z.number().int().nonnegative();

export const simpleUser = z.strictObject({
	login: z.string(),
	id: z.number().int(),
	node_id: z.string(),
	avatar_url: z.string().nullable(),
	url,
	html_url: url,
	type: z.literal("User"),
	site_admin: z.boolean(),
});

export const publicUser = z.strictObject({
	...simpleUser.shape,
	name: z.string().nullable(),
	email: z.string().nullable(),
	public_repos: count,
	followers: count,
	following: count,
	created_at: timestamp,
	updated_at: timestamp,
});

/** `GET /user`: the profile plus the caller's private counts. */
export const privateUser = z.strictObject({
	...publicUser.shape,
	total_private_repos: count,
	owned_private_repos: count,
});

export const repository = z.strictObject({
	id: z.number().int(),
	node_id: z.string(),
	name: z.string(),
	full_name: z.string(),
	private: z.boolean(),
	owner: simpleUser,
	html_url: url,
	description: z.string().nullable(),
	fork: z.boolean(),
	homepage: z.string().nullable(),
	topics: z.array(z.string()),
	is_template: z.boolean(),
	has_issues: z.boolean(),
	has_wiki: z.boolean(),
	has_projects: z.boolean(),
	url,
	clone_url: url,
	created_at: timestamp,
	updated_at: timestamp,
	default_branch: z.string(),
	visibility: z.enum(["public", "private"]),
	archived: z.boolean(),
	disabled: z.boolean(),
	stargazers_count: count,
	/** Stars, as on GitHub (people watching are `subscribers_count`). */
	watchers_count: count,
	watchers: count,
	/** People watching; only `GET /repos/{owner}/{repo}` carries it. */
	subscribers_count: count.optional(),
	forks_count: count,
	/** Open issues and open pull requests combined, as on GitHub. */
	open_issues_count: count,
	/** The caller's access; present when the request is authenticated. */
	permissions: z
		.strictObject({ admin: z.boolean(), push: z.boolean(), pull: z.boolean() })
		.optional(),
});

export const label = z.strictObject({
	id: z.number().int(),
	url,
	name: z.string(),
	color: z.string().regex(/^[0-9a-f]{6}$/),
	default: z.boolean(),
	description: z.string().nullable(),
});

export const milestone = z.strictObject({
	url,
	html_url: url,
	labels_url: url,
	id: z.number().int(),
	node_id: z.string(),
	number: z.number().int().positive(),
	state: z.enum(["open", "closed"]),
	title: z.string(),
	description: z.string().nullable(),
	creator: simpleUser.nullable(),
	open_issues: count,
	closed_issues: count,
	created_at: timestamp,
	updated_at: timestamp,
	closed_at: timestamp.nullable(),
	due_on: timestamp.nullable(),
});

/** GitHub's reaction `content` values. */
export const reactionContent = z.enum([
	"+1",
	"-1",
	"laugh",
	"confused",
	"heart",
	"hooray",
	"rocket",
	"eyes",
]);

/** The `reactions` rollup on an issue or comment. */
export const reactionRollup = z.strictObject({
	url,
	total_count: count,
	"+1": count,
	"-1": count,
	laugh: count,
	confused: count,
	heart: count,
	hooray: count,
	rocket: count,
	eyes: count,
});

export const reaction = z.strictObject({
	id: z.number().int(),
	node_id: z.string(),
	user: simpleUser.nullable(),
	content: reactionContent,
	created_at: timestamp,
});

const issueState = z.enum(["open", "closed"]);
export const stateReason = z.enum(["completed", "not_planned", "reopened"]);

/** An issue; a pull request listed through the issues endpoints carries `pull_request`. */
export const issue = z.strictObject({
	id: z.number().int(),
	url,
	repository_url: url,
	labels_url: url,
	comments_url: url,
	events_url: url,
	html_url: url,
	number: z.number().int().positive(),
	state: issueState,
	title: z.string(),
	body: z.string().nullable(),
	user: simpleUser,
	labels: z.array(label),
	assignees: z.array(simpleUser),
	assignee: simpleUser.nullable(),
	locked: z.boolean(),
	active_lock_reason: z.string().nullable(),
	comments: count,
	milestone: milestone.nullable(),
	created_at: timestamp,
	updated_at: timestamp,
	closed_at: timestamp.nullable(),
	state_reason: stateReason.nullable(),
	reactions: reactionRollup,
	/** Single-issue reads only. */
	closed_by: simpleUser.nullable().optional(),
	pull_request: z
		.strictObject({
			url,
			html_url: url,
			diff_url: url,
			patch_url: url,
			merged_at: timestamp.nullable(),
		})
		.optional(),
});

export const issueComment = z.strictObject({
	id: z.number().int(),
	url,
	html_url: url,
	issue_url: url,
	user: simpleUser,
	created_at: timestamp,
	updated_at: timestamp,
	body: z.string(),
	reactions: reactionRollup,
});

/** A commit comment (`GET …/comments/{id}`). */
export const commitComment = z.strictObject({
	id: z.number().int(),
	url,
	html_url: url,
	body: z.string(),
	path: z.string().nullable(),
	position: z.number().int().nullable(),
	line: z.number().int().nullable(),
	commit_id: sha,
	user: simpleUser,
	created_at: timestamp,
	updated_at: timestamp,
	reactions: reactionRollup,
});

/** A repository as other resources embed it (GitHub's `minimal-repository`). */
export const minimalRepository = z.strictObject({
	id: z.number().int(),
	node_id: z.string(),
	name: z.string(),
	full_name: z.string(),
	owner: simpleUser,
	private: z.boolean(),
	html_url: url,
	description: z.string().nullable(),
	fork: z.boolean(),
	url,
});

const statusState = z.enum(["error", "failure", "pending", "success"]);

/** A commit status (`POST …/statuses/{sha}`, `GET …/commits/{ref}/statuses`). */
export const commitStatus = z.strictObject({
	url,
	avatar_url: z.string().nullable(),
	id: z.number().int(),
	state: statusState,
	description: z.string().nullable(),
	target_url: z.string().nullable(),
	context: z.string(),
	created_at: timestamp,
	updated_at: timestamp,
	creator: simpleUser,
});

/** One status inside the combined status. */
export const simpleCommitStatus = z.strictObject({
	description: z.string().nullable(),
	id: z.number().int(),
	state: statusState,
	context: z.string(),
	target_url: z.string().nullable(),
	required: z.boolean().nullable(),
	avatar_url: z.string().nullable(),
	url,
	created_at: timestamp,
	updated_at: timestamp,
});

/** `GET …/commits/{ref}/status`. */
export const combinedCommitStatus = z.strictObject({
	state: statusState,
	statuses: z.array(simpleCommitStatus),
	sha,
	total_count: count,
	repository: minimalRepository,
	commit_url: url,
	url,
});

const checkConclusion = z.enum([
	"action_required",
	"cancelled",
	"failure",
	"neutral",
	"success",
	"skipped",
	"stale",
	"timed_out",
]);

/** A check run (`POST …/check-runs`, `GET …/check-runs/{id}`). */
export const checkRun = z.strictObject({
	id: z.number().int(),
	head_sha: sha,
	external_id: z.string().nullable(),
	url,
	html_url: url.nullable(),
	details_url: url.nullable(),
	status: z.enum(["queued", "in_progress", "completed"]),
	conclusion: checkConclusion.nullable(),
	started_at: timestamp.nullable(),
	completed_at: timestamp.nullable(),
	output: z.strictObject({
		title: z.string().nullable(),
		summary: z.string().nullable(),
		text: z.string().nullable(),
		annotations_count: count,
	}),
	name: z.string(),
	check_suite: z.strictObject({ id: z.number().int() }),
});

/** A check suite (`GET …/check-suites/{id}`). */
export const checkSuite = z.strictObject({
	id: z.number().int(),
	head_branch: z.string().nullable(),
	head_sha: sha,
	status: z.enum(["queued", "in_progress", "completed"]),
	conclusion: checkConclusion.nullable(),
	url,
	created_at: timestamp,
	updated_at: timestamp,
	latest_check_runs_count: count,
	check_runs_url: url,
	repository: minimalRepository,
});

const eventBase = {
	id: z.number().int(),
	url,
	actor: simpleUser,
	created_at: timestamp,
	commit_id: sha.nullable(),
	commit_url: url.nullable(),
	performed_via_github_app: z.null(),
};

/** An issue event (`GET …/issues/{n}/events`), one variant per `event`. */
export const issueEvent = z.discriminatedUnion("event", [
	z.strictObject({
		...eventBase,
		event: z.literal("closed"),
		state_reason: z.enum(["completed", "not_planned"]),
	}),
	z.strictObject({
		...eventBase,
		event: z.literal("reopened"),
		state_reason: z.literal("reopened"),
	}),
	z.strictObject({
		...eventBase,
		event: z.literal("merged"),
		commit_id: sha,
		commit_url: url,
		state_reason: z.null(),
	}),
	z.strictObject({
		...eventBase,
		event: z.literal("referenced"),
		commit_id: sha,
		commit_url: url,
	}),
	z.strictObject({
		...eventBase,
		event: z.literal("cross-referenced"),
		source: z.strictObject({
			type: z.enum(["issue", "pull_request"]),
			issue: issue.nullable(),
		}),
	}),
	z.strictObject({ ...eventBase, event: z.literal("head_ref_deleted") }),
	z.strictObject({
		...eventBase,
		event: z.literal(["ready_for_review", "convert_to_draft"]),
	}),
	z.strictObject({
		...eventBase,
		event: z.literal("renamed"),
		rename: z.strictObject({ from: z.string(), to: z.string() }),
	}),
	z.strictObject({
		...eventBase,
		event: z.literal(["labeled", "unlabeled"]),
		label: z.strictObject({ name: z.string(), color: z.string() }),
	}),
	z.strictObject({
		...eventBase,
		event: z.literal(["review_requested", "review_request_removed"]),
		review_requester: simpleUser,
		requested_reviewer: simpleUser,
	}),
	z.strictObject({
		...eventBase,
		event: z.literal(["milestoned", "demilestoned"]),
		milestone: z.strictObject({ title: z.string() }),
	}),
	z.strictObject({
		...eventBase,
		event: z.literal(["assigned", "unassigned"]),
		/** A partial user: the event records the login and name only. */
		assignee: z.strictObject({
			login: z.string(),
			name: z.string().nullable(),
			type: z.literal("User"),
		}),
	}),
]);

const href = z.strictObject({ href: url });

/** `GET …/pulls/{n}/requested_reviewers`: users and (not yet supported) teams. */
export const requestedReviewers = z.strictObject({
	users: z.array(simpleUser),
	teams: z.array(z.never()),
});

/** A submitted pull request review on the timeline (GitHub's `reviewed` item). */
export const reviewedItem = z.strictObject({
	event: z.literal("reviewed"),
	id: z.number().int(),
	user: simpleUser,
	body: z.string().nullable(),
	state: z.enum(["approved", "changes_requested", "commented"]),
	html_url: url,
	pull_request_url: url,
	author_association: z.enum(["OWNER", "COLLABORATOR", "NONE"]),
	_links: z.strictObject({ html: href, pull_request: href }),
	submitted_at: timestamp,
	commit_id: sha.nullable(),
});

/** A timeline item: an issue event, a comment as a `commented` event, or a review. */
export const timelineItem = z.union([
	issueEvent,
	z.strictObject({
		...issueComment.shape,
		event: z.literal("commented"),
		actor: simpleUser,
	}),
	reviewedItem,
]);

/** A commit author/committer; emails are a noreply placeholder. */
export const gitIdentity = z.strictObject({
	name: z.string(),
	email: z.string(),
	date: timestamp,
});

const parentRef = z.strictObject({ sha, url, html_url: url });

/** GitHub's `Commit` (`GET …/commits`, `…/pulls/{n}/commits`). */
export const commit = z.strictObject({
	sha,
	commit: z.strictObject({
		url,
		author: gitIdentity,
		committer: gitIdentity,
		message: z.string(),
		tree: z.strictObject({ sha, url }),
		comment_count: count,
	}),
	url,
	html_url: url,
	comments_url: url,
	/** Commits aren't linked to accounts (yet). */
	author: simpleUser.nullable(),
	committer: simpleUser.nullable(),
	parents: z.array(parentRef),
});

/** A changed file of a diff (pull request files, a commit, a comparison). */
export const diffEntry = z.strictObject({
	sha,
	filename: z.string(),
	status: z.enum([
		"added",
		"removed",
		"modified",
		"renamed",
		"copied",
		"changed",
		"unchanged",
	]),
	additions: count,
	deletions: count,
	changes: count,
	blob_url: url,
	raw_url: url,
	contents_url: url,
	/** Absent for binary, oversized and over-budget files. */
	patch: z.string().optional(),
});

/** `GET …/commits/{ref}`: the commit with its diff. */
export const commitDetail = z.strictObject({
	...commit.shape,
	stats: z.strictObject({ total: count, additions: count, deletions: count }),
	files: z.array(diffEntry),
});

export const comparison = z.strictObject({
	url,
	html_url: url,
	permalink_url: url,
	diff_url: url,
	patch_url: url,
	base_commit: commit,
	merge_base_commit: commit,
	status: z.enum(["identical", "ahead", "behind", "diverged"]),
	ahead_by: count,
	behind_by: count,
	total_commits: count,
	commits: z.array(commit),
	files: z.array(diffEntry),
});

const commitRef = z.strictObject({ sha, url });

export const shortBranch = z.strictObject({
	name: z.string(),
	commit: commitRef,
	protected: z.boolean(),
});

export const branch = z.strictObject({
	name: z.string(),
	commit,
	_links: z.strictObject({ self: url, html: url }),
	protected: z.boolean(),
});

export const tag = z.strictObject({ name: z.string(), commit: commitRef });

/** A file attached to a release. */
export const releaseAsset = z.strictObject({
	url,
	browser_download_url: url,
	id: z.number().int(),
	node_id: z.string(),
	name: z.string(),
	label: z.string().nullable(),
	state: z.enum(["uploaded", "open"]),
	content_type: z.string(),
	size: count,
	download_count: count,
	created_at: timestamp,
	updated_at: timestamp,
	uploader: simpleUser.nullable(),
});

export const release = z.strictObject({
	url,
	html_url: url,
	assets_url: url,
	upload_url: url,
	tarball_url: url.nullable(),
	zipball_url: url.nullable(),
	id: z.number().int(),
	node_id: z.string(),
	tag_name: z.string(),
	target_commitish: z.string(),
	name: z.string().nullable(),
	body: z.string().nullable(),
	draft: z.boolean(),
	prerelease: z.boolean(),
	created_at: timestamp,
	published_at: timestamp.nullable(),
	author: simpleUser,
	assets: z.array(releaseAsset),
});

/** `POST …/releases/generate-notes`. */
export const releaseNotes = z.strictObject({
	name: z.string(),
	body: z.string(),
});

const pullSide = z.strictObject({
	label: z.string(),
	ref: z.string(),
	sha,
	user: simpleUser,
	repo: repository.nullable(),
});

/** A pull request as lists return it. */
export const pullRequestSimple = z.strictObject({
	url,
	id: z.number().int(),
	node_id: z.string(),
	html_url: url,
	diff_url: url,
	patch_url: url,
	issue_url: url,
	commits_url: url,
	review_comments_url: url,
	review_comment_url: url,
	comments_url: url,
	statuses_url: url,
	number: z.number().int().positive(),
	state: issueState,
	locked: z.boolean(),
	title: z.string(),
	user: simpleUser,
	body: z.string().nullable(),
	labels: z.array(label),
	milestone: milestone.nullable(),
	active_lock_reason: z.string().nullable(),
	created_at: timestamp,
	updated_at: timestamp,
	closed_at: timestamp.nullable(),
	merged_at: timestamp.nullable(),
	merge_commit_sha: sha.nullable(),
	assignee: simpleUser.nullable(),
	assignees: z.array(simpleUser),
	requested_reviewers: z.array(simpleUser),
	requested_teams: z.array(z.never()),
	head: pullSide,
	base: pullSide,
	_links: z.strictObject({
		self: href,
		html: href,
		issue: href,
		comments: href,
		review_comments: href,
		review_comment: href,
		commits: href,
		statuses: href,
	}),
	auto_merge: z.null(),
	draft: z.boolean(),
});

/** A single pull request: the list shape plus merge state and counts. */
export const pullRequest = z.strictObject({
	...pullRequestSimple.shape,
	merged: z.boolean(),
	mergeable: z.boolean().nullable(),
	rebaseable: z.boolean().nullable(),
	mergeable_state: z.string(),
	merged_by: simpleUser.nullable(),
	comments: count,
	review_comments: count,
	maintainer_can_modify: z.boolean(),
	commits: count,
	additions: count,
	deletions: count,
	changed_files: count,
});

export const mergeResult = z.strictObject({
	sha,
	merged: z.boolean(),
	message: z.string(),
});

const rate = z.strictObject({
	limit: count,
	used: count,
	remaining: count,
	reset: count,
});

export const rateLimitOverview = z.strictObject({
	resources: z.strictObject({
		core: rate,
		git: rate,
		/** Authenticated callers only: their mutating-request bucket. */
		core_write: rate.optional(),
		/** Authenticated callers only (GraphQL requires a token): query-cost points. */
		graphql: rate.optional(),
	}),
	rate,
});

export const gitRef = z.strictObject({
	ref: z.string(),
	url,
	object: z.strictObject({ sha, type: z.enum(["commit", "tag"]), url }),
});

export const gitCommit = z.strictObject({
	sha,
	url,
	html_url: url,
	author: gitIdentity,
	committer: gitIdentity,
	tree: z.strictObject({ sha, url }),
	message: z.string(),
	parents: z.array(parentRef),
	verification: z.strictObject({
		verified: z.boolean(),
		reason: z.string(),
		signature: z.string().nullable(),
		payload: z.string().nullable(),
		verified_at: timestamp.nullable(),
	}),
});

export const gitTree = z.strictObject({
	sha,
	url,
	tree: z.array(
		z.strictObject({
			path: z.string(),
			mode: z.string(),
			type: z.enum(["blob", "tree", "commit"]),
			sha,
			/** Blobs only. */
			size: count.optional(),
			/** Blobs and trees. */
			url: url.optional(),
		}),
	),
	truncated: z.boolean(),
});

export const blob = z.strictObject({
	sha,
	size: count,
	url,
	content: z.string(),
	encoding: z.literal("base64"),
});

const contentBase = {
	size: count,
	name: z.string(),
	path: z.string(),
	sha,
	url,
	git_url: url.nullable(),
	html_url: url.nullable(),
	download_url: url.nullable(),
	_links: z.strictObject({
		self: url,
		git: url.nullable(),
		html: url.nullable(),
	}),
};

/** An entry of a directory listing. */
const contentEntry = z.strictObject({
	...contentBase,
	type: z.enum(["file", "dir", "symlink", "submodule"]),
});

/** `GET …/contents/{path}`: a directory listing or one file, symlink or submodule. */
export const contents = z.union([
	z.array(contentEntry),
	/** The `object` media type's directory: its entries inline. */
	z.strictObject({
		...contentBase,
		type: z.literal("dir"),
		entries: z.array(contentEntry),
	}),
	z.discriminatedUnion("type", [
		z.strictObject({
			...contentBase,
			type: z.literal("file"),
			/** Base64 (60-column lines), or `""` with `none` past the inline cap. */
			content: z.string(),
			encoding: z.enum(["base64", "none"]),
		}),
		z.strictObject({
			...contentBase,
			type: z.literal("symlink"),
			target: z.string().nullable(),
		}),
		z.strictObject({
			...contentBase,
			type: z.literal("submodule"),
			submodule_git_url: url.nullable(),
		}),
	]),
]);

/** `PUT`/`DELETE …/contents/{path}`: the file written (`null` once deleted) and its commit. */
export const fileCommit = z.strictObject({
	content: z
		.strictObject({ ...contentBase, type: z.literal("file") })
		.nullable(),
	commit: gitCommit,
});

/** A notification thread (`GET /notifications`). */
export const notificationThread = z.strictObject({
	/** A string, as on GitHub. */
	id: z.string(),
	repository,
	subject: z.strictObject({
		title: z.string(),
		url,
		latest_comment_url: url,
		type: z.enum(["Issue", "PullRequest"]),
	}),
	reason: z.enum([
		"assign",
		"author",
		"comment",
		"manual",
		"mention",
		"review_requested",
		"state_change",
		"subscribed",
	]),
	unread: z.boolean(),
	updated_at: timestamp,
	last_read_at: timestamp.nullable(),
	url,
	subscription_url: url,
});

/** The caller's subscription to a notification thread. */
export const threadSubscription = z.strictObject({
	subscribed: z.boolean(),
	ignored: z.boolean(),
	reason: z.string().nullable(),
	created_at: timestamp,
	url,
	thread_url: url,
});

/** The caller's subscription to a repository (watching or ignoring it). */
export const repositorySubscription = z.strictObject({
	subscribed: z.boolean(),
	ignored: z.boolean(),
	reason: z.string().nullable(),
	created_at: timestamp,
	url,
	repository_url: url,
});

/** `POST …/git/blobs`. */
export const createdBlob = z.strictObject({ sha, url });

/** An annotated tag object (`GET`/`POST …/git/tags`). */
export const gitTag = z.strictObject({
	sha,
	url,
	tag: z.string(),
	message: z.string(),
	tagger: gitIdentity,
	object: z.strictObject({
		sha,
		type: z.enum(["commit", "tree", "blob", "tag"]),
		url,
	}),
	verification: z.strictObject({
		verified: z.boolean(),
		reason: z.string(),
		signature: z.string().nullable(),
		payload: z.string().nullable(),
		verified_at: timestamp.nullable(),
	}),
});
