import { sql } from "drizzle-orm";
import {
	type AnySQLiteColumn,
	check,
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { ActivityMetadata, ActivityType } from "#/lib/activity-types";
import type { DeviceCodeStatus } from "#/lib/device-flow";
import type { NotificationReason } from "#/lib/notifications";
import type { ReactionContent } from "#/lib/reactions";
import type { ReviewSide, ReviewState } from "#/lib/review-types";
import type {
	IssueStateReason,
	TimelineEvent,
	TimelineEventType,
} from "#/lib/timeline-types";
import type { TokenScope } from "#/lib/token-scopes";
import { user } from "./schema";

const epochMs = (name: string) => integer(name, { mode: "timestamp_ms" });

export const repositories = sqliteTable(
	"repositories",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		ownerId: text("owner_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		description: text("description"),
		visibility: text("visibility")
			.$type<"public" | "private">()
			.notNull()
			.default("public"),
		defaultBranch: text("default_branch").notNull().default("main"),
		/** Read-only: pushes and every write (issues, comments, PRs) are refused. */
		archived: integer("archived", { mode: "boolean" }).notNull().default(false),
		homepage: text("homepage"),
		/** Lowercase, at most 20 (`MAX_REPO_TOPICS`). */
		topics: text("topics", { mode: "json" })
			.$type<string[]>()
			.notNull()
			.default([]),
		isTemplate: integer("is_template", { mode: "boolean" })
			.notNull()
			.default(false),
		/**
		 * The repository this one was forked from (GitHub's `parent`). Null for a
		 * repository that is not a fork, or once its parent is deleted.
		 */
		forkOfId: integer("fork_of_id").references(
			(): AnySQLiteColumn => repositories.id,
			{ onDelete: "set null" },
		),
		/** GitHub's `fork`: stays true after the parent is deleted. */
		isFork: integer("is_fork", { mode: "boolean" }).notNull().default(false),
		/** No wiki or projects exist yet, so these default off (GitHub: on). */
		hasIssues: integer("has_issues", { mode: "boolean" })
			.notNull()
			.default(true),
		hasWiki: integer("has_wiki", { mode: "boolean" }).notNull().default(false),
		hasProjects: integer("has_projects", { mode: "boolean" })
			.notNull()
			.default(false),
		/**
		 * Which merge methods a pull request may use; all on by default. At least
		 * one stays on: `updateRepositorySettings` refuses a patch that leaves none.
		 */
		allowMergeCommit: integer("allow_merge_commit", { mode: "boolean" })
			.notNull()
			.default(true),
		allowSquashMerge: integer("allow_squash_merge", { mode: "boolean" })
			.notNull()
			.default(true),
		allowRebaseMerge: integer("allow_rebase_merge", { mode: "boolean" })
			.notNull()
			.default(true),
		/** The tree view's per-file "last commit" column — a history walk per view, so opt-in. */
		showLastCommitColumn: integer("show_last_commit_column", {
			mode: "boolean",
		})
			.notNull()
			.default(false),
		autoRefreshPrDiffs: integer("auto_refresh_pr_diffs", { mode: "boolean" })
			.notNull()
			.default(false),
		/**
		 * The next `#N` for an issue or PR — one shared sequence per repo
		 * (GitHub's model), claimed with an atomic increment.
		 */
		nextIssueNumber: integer("next_issue_number").notNull().default(1),
		/** The next milestone `number` (its own per-repo sequence), claimed atomically. */
		nextMilestoneNumber: integer("next_milestone_number").notNull().default(1),
		createdAt: epochMs("created_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		updatedAt: epochMs("updated_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => ({
		// Unique: storage keys derive from (owner, name), so a duplicate would
		// share another repository's git data.
		ownerNameIdx: uniqueIndex("repo_owner_name_idx").on(
			table.ownerId,
			table.name,
		),
		nameIdx: index("repo_name_idx").on(table.name),
		visibilityIdx: index("repo_visibility_idx").on(table.visibility),
		forkOfIdx: index("repo_fork_of_idx").on(table.forkOfId),
	}),
);

/**
 * Every issue and pull request: GitHub's model, where a pull request *is* an
 * issue (one `#N` sequence, one set of comments, labels, assignees and
 * timeline events) and `pull_requests` holds only what a pull request adds,
 * 1:1 by issue id. `status` is the issue state; a merged pull request is
 * `closed` with `pull_requests.merged_at` set.
 */
export const issues = sqliteTable(
	"issues",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		repoId: integer("repo_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		/** The repo-scoped `#N`, shared by issues and pull requests. */
		number: integer("number").notNull(),
		/** A pull request (its `pull_requests` row carries the branches). */
		isPullRequest: integer("is_pull_request", { mode: "boolean" })
			.notNull()
			.default(false),
		authorId: text("author_id")
			.notNull()
			.references(() => user.id),
		title: text("title").notNull(),
		body: text("body"),
		status: text("status").$type<"open" | "closed">().notNull().default("open"),
		createdAt: epochMs("created_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		/** When the body was last edited by hand (the "edited" marker); null if never. */
		editedAt: epochMs("edited_at"),
		updatedAt: epochMs("updated_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		closedAt: epochMs("closed_at"),
		/** GitHub's `closed_by`: who closed it (or merged it); null while open. */
		closedById: text("closed_by_id").references(() => user.id, {
			onDelete: "set null",
		}),
		/** GitHub's `state_reason` (issues only); null until first closed. */
		stateReason: text("state_reason").$type<IssueStateReason>(),
		/** GitHub's `milestone`: at most one; deleting the milestone clears it. */
		milestoneId: integer("milestone_id").references(
			(): AnySQLiteColumn => milestones.id,
			{ onDelete: "set null" },
		),
	},
	(table) => ({
		milestoneIdx: index("issue_milestone_idx").on(table.milestoneId),
		repoNumberIdx: uniqueIndex("issue_repo_number_idx").on(
			table.repoId,
			table.number,
		),
		// The list sorts: both kinds together (the REST issues list) and one
		// kind (the web lists, the REST pulls list), by created and by updated.
		repoStateCreatedIdx: index("issue_repo_state_created_idx").on(
			table.repoId,
			table.status,
			table.createdAt,
		),
		repoStateUpdatedIdx: index("issue_repo_state_updated_idx").on(
			table.repoId,
			table.status,
			table.updatedAt,
		),
		repoKindStateCreatedIdx: index("issue_repo_kind_state_created_idx").on(
			table.repoId,
			table.isPullRequest,
			table.status,
			table.createdAt,
		),
		repoKindStateUpdatedIdx: index("issue_repo_kind_state_updated_idx").on(
			table.repoId,
			table.isPullRequest,
			table.status,
			table.updatedAt,
		),
	}),
);

/** A repository's milestones; `number` is a per-repo sequence separate from `#N`. */
export const milestones = sqliteTable(
	"milestones",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		repoId: integer("repo_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		number: integer("number").notNull(),
		title: text("title").notNull(),
		description: text("description"),
		state: text("state").$type<"open" | "closed">().notNull().default("open"),
		dueOn: epochMs("due_on"),
		creatorId: text("creator_id").references(() => user.id, {
			onDelete: "set null",
		}),
		createdAt: epochMs("created_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		updatedAt: epochMs("updated_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		closedAt: epochMs("closed_at"),
	},
	(table) => ({
		repoNumberIdx: uniqueIndex("milestone_repo_number_idx").on(
			table.repoId,
			table.number,
		),
		repoTitleIdx: uniqueIndex("milestone_repo_title_idx").on(
			table.repoId,
			sql`lower(${table.title})`,
		),
	}),
);

export const labels = sqliteTable(
	"labels",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		repoId: integer("repo_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		/** Lowercase hex without `#`, as the REST API returns it. */
		color: text("color").notNull(),
		description: text("description"),
		createdAt: epochMs("created_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => ({
		repoNameIdx: uniqueIndex("label_repo_name_idx").on(
			table.repoId,
			sql`lower(${table.name})`,
		),
	}),
);

export const threadLabels = sqliteTable(
	"thread_labels",
	{
		issueId: integer("issue_id")
			.notNull()
			.references(() => issues.id, { onDelete: "cascade" }),
		labelId: integer("label_id")
			.notNull()
			.references(() => labels.id, { onDelete: "cascade" }),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.issueId, table.labelId] }),
		labelIdx: index("thread_label_label_idx").on(table.labelId),
	}),
);

/** Who an issue or pull request is assigned to (GitHub: up to 10, each with write access). */
export const threadAssignees = sqliteTable(
	"thread_assignees",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		issueId: integer("issue_id")
			.notNull()
			.references(() => issues.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		createdAt: epochMs("created_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => ({
		issueUserIdx: uniqueIndex("thread_assignee_issue_user_idx").on(
			table.issueId,
			table.userId,
		),
		userIdx: index("thread_assignee_user_idx").on(table.userId),
	}),
);

/**
 * Users whose review is requested on a pull request (GitHub's
 * `requested_reviewers`). A submitted review or an explicit removal deletes the
 * row; requesting again re-adds it. Teams are not modelled yet.
 */
export const pullRequestReviewRequests = sqliteTable(
	"pull_request_review_requests",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		issueId: integer("issue_id")
			.notNull()
			.references(() => issues.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		requesterId: text("requester_id").references(() => user.id, {
			onDelete: "set null",
		}),
		createdAt: epochMs("created_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => ({
		issueUserIdx: uniqueIndex("review_request_issue_user_idx").on(
			table.issueId,
			table.userId,
		),
		userIdx: index("review_request_user_idx").on(table.userId),
	}),
);

/**
 * What a pull request adds to its issue (1:1 by `issue_id`): the branches,
 * and once merged, who merged it, when, and the exact commit range.
 */
export const pullRequests = sqliteTable(
	"pull_requests",
	{
		issueId: integer("issue_id")
			.primaryKey()
			.references(() => issues.id, { onDelete: "cascade" }),
		sourceBranch: text("source_branch").notNull(),
		targetBranch: text("target_branch").notNull(),
		mergedAt: epochMs("merged_at"),
		mergedBy: text("merged_by").references(() => user.id),
		mergeCommitSha: text("merge_commit_sha"),
		/** A draft can't be merged until it is marked ready for review. */
		isDraft: integer("is_draft", { mode: "boolean" }).notNull().default(false),
		/** The base and head tips that were merged: the PR's exact commit range. */
		baseSha: text("base_sha"),
		headSha: text("head_sha"),
	},
	(table) => ({
		// The REST list's `head`/`base` filters and the duplicate-PR check.
		branchesIdx: index("pr_branches_idx").on(
			table.sourceBranch,
			table.targetBranch,
		),
	}),
);

export const comments = sqliteTable(
	"comments",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		repoId: integer("repo_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		issueId: integer("issue_id")
			.notNull()
			.references(() => issues.id, { onDelete: "cascade" }),
		authorId: text("author_id")
			.notNull()
			.references(() => user.id),
		body: text("body").notNull(),
		createdAt: epochMs("created_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		/** When the body was last edited by hand (the "edited" marker); null if never. */
		editedAt: epochMs("edited_at"),
		updatedAt: epochMs("updated_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => ({
		issueCreatedIdx: index("comment_issue_created_idx").on(
			table.issueId,
			table.createdAt,
		),
	}),
);

/**
 * A comment on a commit (GitHub's commit comments): on the whole commit, or
 * anchored to a file (`path`) and a line of its diff (`position`, GitHub's
 * diff-relative index) or of the file (`line`).
 */
export const commitComments = sqliteTable(
	"commit_comments",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		repoId: integer("repo_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		/** The full 40-character commit sha, lowercase. */
		commitSha: text("commit_sha").notNull(),
		authorId: text("author_id")
			.notNull()
			.references(() => user.id),
		body: text("body").notNull(),
		path: text("path"),
		position: integer("position"),
		line: integer("line"),
		createdAt: epochMs("created_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		editedAt: epochMs("edited_at"),
		updatedAt: epochMs("updated_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => ({
		repoCommitIdx: index("commit_comment_repo_commit_idx").on(
			table.repoId,
			table.commitSha,
			table.createdAt,
		),
		repoCreatedIdx: index("commit_comment_repo_created_idx").on(
			table.repoId,
			table.createdAt,
		),
	}),
);

/**
 * A commit status (GitHub's `POST /repos/{o}/{r}/statuses/{sha}`): one report
 * of an external CI for a commit and `context`. Rows are append-only; the
 * current status of a context is its newest row (highest id).
 */
export const commitStatuses = sqliteTable(
	"commit_statuses",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		repoId: integer("repo_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		/** The full 40-character commit sha, lowercase. */
		sha: text("sha").notNull(),
		context: text("context").notNull(),
		state: text("state", {
			enum: ["error", "failure", "pending", "success"],
		}).notNull(),
		targetUrl: text("target_url"),
		description: text("description"),
		creatorId: text("creator_id")
			.notNull()
			.references(() => user.id),
		createdAt: epochMs("created_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => ({
		repoShaContextIdx: index("commit_status_repo_sha_context_idx").on(
			table.repoId,
			table.sha,
			table.context,
			table.id,
		),
	}),
);

/**
 * A check suite: the group of check runs reported for one commit. PushStack
 * has no GitHub Apps, so a commit has at most one suite (per repository).
 */
export const checkSuites = sqliteTable(
	"check_suites",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		repoId: integer("repo_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		/** The full 40-character commit sha, lowercase. */
		headSha: text("head_sha").notNull(),
		/** The branch the caller named when creating the suite, if any. */
		headBranch: text("head_branch"),
		createdAt: epochMs("created_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		updatedAt: epochMs("updated_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => ({
		repoShaIdx: uniqueIndex("check_suite_repo_sha_idx").on(
			table.repoId,
			table.headSha,
		),
	}),
);

/** A check run (GitHub's checks API) reported by an external CI. */
export const checkRuns = sqliteTable(
	"check_runs",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		repoId: integer("repo_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		suiteId: integer("suite_id")
			.notNull()
			.references(() => checkSuites.id, { onDelete: "cascade" }),
		/** The full 40-character commit sha, lowercase. */
		headSha: text("head_sha").notNull(),
		name: text("name").notNull(),
		externalId: text("external_id"),
		detailsUrl: text("details_url"),
		status: text("status", {
			enum: ["queued", "in_progress", "completed"],
		}).notNull(),
		conclusion: text("conclusion", {
			enum: [
				"action_required",
				"cancelled",
				"failure",
				"neutral",
				"success",
				"skipped",
				"stale",
				"timed_out",
			],
		}),
		startedAt: epochMs("started_at"),
		completedAt: epochMs("completed_at"),
		outputTitle: text("output_title"),
		outputSummary: text("output_summary"),
		outputText: text("output_text"),
		createdAt: epochMs("created_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		updatedAt: epochMs("updated_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => ({
		repoShaIdx: index("check_run_repo_sha_idx").on(
			table.repoId,
			table.headSha,
			table.id,
		),
		suiteIdx: index("check_run_suite_idx").on(table.suiteId, table.id),
	}),
);

/**
 * GitHub releases: a tag with notes and downloadable assets. `tag_name` is a
 * name, not a reference: deleting the tag keeps the release (it becomes a
 * draft, as on GitHub). Published releases are unique per tag; drafts may
 * repeat a tag. `make_latest` is GitHub's `true`/`false`/`legacy`.
 */
export const releases = sqliteTable(
	"releases",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		repoId: integer("repo_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		tagName: text("tag_name").notNull(),
		targetCommitish: text("target_commitish").notNull(),
		name: text("name"),
		body: text("body"),
		draft: integer("draft", { mode: "boolean" }).notNull().default(false),
		prerelease: integer("prerelease", { mode: "boolean" })
			.notNull()
			.default(false),
		makeLatest: text("make_latest")
			.$type<"true" | "false" | "legacy">()
			.notNull()
			.default("legacy"),
		authorId: text("author_id")
			.notNull()
			.references(() => user.id),
		createdAt: epochMs("created_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		/** Null while a draft; set when it is published. */
		publishedAt: epochMs("published_at"),
		updatedAt: epochMs("updated_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => ({
		repoCreatedIdx: index("release_repo_created_idx").on(
			table.repoId,
			table.createdAt,
		),
		publishedTagIdx: uniqueIndex("release_published_tag_idx")
			.on(table.repoId, table.tagName)
			.where(sql`${table.draft} = 0`),
	}),
);

/**
 * A file attached to a release. The bytes live in R2 at
 * `getReleaseAssetKey(owner, repo, id)`; `state` is `open` while a presigned
 * upload is pending and `uploaded` once the bytes are verified.
 */
export const releaseAssets = sqliteTable(
	"release_assets",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		releaseId: integer("release_id")
			.notNull()
			.references(() => releases.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		label: text("label"),
		contentType: text("content_type").notNull(),
		size: integer("size").notNull(),
		state: text("state").$type<"open" | "uploaded">().notNull(),
		downloadCount: integer("download_count").notNull().default(0),
		uploaderId: text("uploader_id")
			.notNull()
			.references(() => user.id),
		createdAt: epochMs("created_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		updatedAt: epochMs("updated_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => ({
		releaseNameIdx: uniqueIndex("release_asset_release_name_idx").on(
			table.releaseId,
			table.name,
		),
	}),
);

/**
 * A user's reaction (GitHub's `content`: `+1`, `heart`, …) to an issue or pull
 * request (`comment_id` null) or to one of its comments. `issue_id` is always
 * the thread, so a thread's rollups are one indexed read. One row per user,
 * subject and content.
 */
export const reactions = sqliteTable(
	"reactions",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		issueId: integer("issue_id")
			.notNull()
			.references(() => issues.id, { onDelete: "cascade" }),
		commentId: integer("comment_id").references(() => comments.id, {
			onDelete: "cascade",
		}),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		content: text("content").$type<ReactionContent>().notNull(),
		createdAt: epochMs("created_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => ({
		issueUserContentIdx: uniqueIndex("reaction_issue_user_content_idx")
			.on(table.issueId, table.userId, table.content)
			.where(sql`${table.commentId} is null`),
		commentUserContentIdx: uniqueIndex("reaction_comment_user_content_idx")
			.on(table.commentId, table.userId, table.content)
			.where(sql`${table.commentId} is not null`),
		userIdx: index("reaction_user_idx").on(table.userId),
	}),
);

/**
 * A user's subscription to an issue or pull request thread (GitHub's thread
 * subscription). Written when they open, comment on, are mentioned in or
 * assigned to the thread, or subscribe by hand; `subscribed = false` is an
 * explicit unsubscribe, which later activity must not overwrite. Subscribers
 * are notified of new activity (src/server/notification-store.ts).
 */
export const threadSubscriptions = sqliteTable(
	"thread_subscriptions",
	{
		issueId: integer("issue_id")
			.notNull()
			.references(() => issues.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		subscribed: integer("subscribed", { mode: "boolean" })
			.notNull()
			.default(true),
		reason: text("reason").$type<NotificationReason>().notNull(),
		createdAt: epochMs("created_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		updatedAt: epochMs("updated_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.issueId, table.userId] }),
		userIdx: index("thread_subscription_user_idx").on(table.userId),
	}),
);

/**
 * One notification thread per user and issue/PR (GitHub's model): new
 * activity bumps `updated_at`, marks it unread and sets the latest `reason`.
 * The inbox reads `(user_id, updated_at)`, the unread badge and filter the
 * partial `(user_id, updated_at) where unread`.
 */
export const notifications = sqliteTable(
	"notifications",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		repoId: integer("repo_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		issueId: integer("issue_id")
			.notNull()
			.references(() => issues.id, { onDelete: "cascade" }),
		reason: text("reason").$type<NotificationReason>().notNull(),
		unread: integer("unread", { mode: "boolean" }).notNull().default(true),
		lastReadAt: epochMs("last_read_at"),
		createdAt: epochMs("created_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		updatedAt: epochMs("updated_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => ({
		userIssueIdx: uniqueIndex("notification_user_issue_idx").on(
			table.userId,
			table.issueId,
		),
		userUpdatedIdx: index("notification_user_updated_idx").on(
			table.userId,
			table.updatedAt,
		),
		userUnreadIdx: index("notification_user_unread_idx")
			.on(table.userId, table.updatedAt)
			.where(sql`${table.unread} = 1`),
		issueIdx: index("notification_issue_idx").on(table.issueId),
	}),
);

/**
 * A pull request review (src/server/reviews.ts). A `pending` review is the
 * reviewer's unsubmitted draft; submitting sets one of the other states and
 * `submittedAt`. At most one pending review per reviewer per pull request.
 */
export const pullRequestReviews = sqliteTable(
	"pull_request_reviews",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		repoId: integer("repo_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		pullRequestId: integer("pull_request_id")
			.notNull()
			.references(() => pullRequests.issueId, { onDelete: "cascade" }),
		authorId: text("author_id")
			.notNull()
			.references(() => user.id),
		state: text("state").$type<ReviewState>().notNull().default("pending"),
		body: text("body"),
		/** The head tip the review was submitted against (GitHub's `commit_id`). */
		commitSha: text("commit_sha"),
		submittedAt: epochMs("submitted_at"),
		createdAt: epochMs("created_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		updatedAt: epochMs("updated_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => ({
		// One pending review per reviewer per pull request; submitted reviews
		// accumulate. The partial index is what makes "find or create" safe
		// under a concurrent double-click.
		pendingIdx: uniqueIndex("review_pending_idx")
			.on(table.repoId, table.pullRequestId, table.authorId)
			.where(sql`${table.state} = 'pending'`),
		prCreatedIdx: index("review_pr_created_idx").on(
			table.pullRequestId,
			table.createdAt,
		),
		authorIdx: index("review_author_idx").on(table.authorId),
	}),
);

/**
 * A line comment in a review. A thread is a root comment (`inReplyToId` null)
 * plus its replies; `resolvedAt`/`resolvedById` live on the root. The anchor is
 * `(path, side, line)`, validated against the pull request's diff when written.
 */
export const pullRequestReviewComments = sqliteTable(
	"pull_request_review_comments",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		repoId: integer("repo_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		pullRequestId: integer("pull_request_id")
			.notNull()
			.references(() => pullRequests.issueId, { onDelete: "cascade" }),
		reviewId: integer("review_id")
			.notNull()
			.references(() => pullRequestReviews.id, { onDelete: "cascade" }),
		authorId: text("author_id")
			.notNull()
			.references(() => user.id),
		body: text("body").notNull(),
		path: text("path").notNull(),
		side: text("side").$type<ReviewSide>().notNull().default("RIGHT"),
		line: integer("line").notNull(),
		/** The head tip the anchor was computed against. */
		commitSha: text("commit_sha"),
		/** The comment this replies to; null for a thread root. */
		inReplyToId: integer("in_reply_to_id").references(
			(): AnySQLiteColumn => pullRequestReviewComments.id,
			{ onDelete: "cascade" },
		),
		/** Thread resolution, set on the root comment only. */
		resolvedAt: epochMs("resolved_at"),
		resolvedById: text("resolved_by_id").references(() => user.id),
		createdAt: epochMs("created_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		updatedAt: epochMs("updated_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => ({
		prCreatedIdx: index("review_comment_pr_created_idx").on(
			table.pullRequestId,
			table.createdAt,
		),
		reviewIdx: index("review_comment_review_idx").on(table.reviewId),
		replyIdx: index("review_comment_reply_idx").on(table.inReplyToId),
	}),
);

export const stars = sqliteTable(
	"stars",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		repoId: integer("repo_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		createdAt: epochMs("created_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => ({
		repoUserIdx: uniqueIndex("star_repo_user_idx").on(
			table.repoId,
			table.userId,
		),
		userIdx: index("star_user_idx").on(table.userId),
	}),
);

/**
 * A user's watch of a repository (GitHub's repository subscription):
 * `ignored = false` is "all activity", `ignored = true` is "ignore". No row
 * is "participating and @mentions" (the default).
 */
export const repositorySubscriptions = sqliteTable(
	"repository_subscriptions",
	{
		repoId: integer("repo_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		ignored: integer("ignored", { mode: "boolean" }).notNull().default(false),
		createdAt: epochMs("created_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.repoId, table.userId] }),
		userIdx: index("repository_subscription_user_idx").on(table.userId),
	}),
);

/** `follower_id` follows `followee_id` (never themselves). */
export const follows = sqliteTable(
	"follows",
	{
		followerId: text("follower_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		followeeId: text("followee_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		createdAt: epochMs("created_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.followerId, table.followeeId] }),
		followeeIdx: index("follow_followee_idx").on(
			table.followeeId,
			table.createdAt,
		),
		notSelf: check(
			"follow_not_self",
			sql`${table.followerId} <> ${table.followeeId}`,
		),
	}),
);

export const repositoryCollaborators = sqliteTable(
	"repository_collaborators",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		repoId: integer("repo_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		role: text("role")
			.$type<"read" | "write" | "admin">()
			.notNull()
			.default("read"),
		createdAt: epochMs("created_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => ({
		repoUserIdx: uniqueIndex("collab_repo_user_idx").on(
			table.repoId,
			table.userId,
		),
		userIdx: index("collab_user_idx").on(table.userId),
	}),
);

export const activities = sqliteTable(
	"activities",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		repoId: integer("repo_id").references(() => repositories.id, {
			onDelete: "cascade",
		}),
		/** With `metadata`, one ActivityEvent — written only via recordActivity. */
		type: text("type").$type<ActivityType>().notNull(),
		metadata: text("metadata", { mode: "json" }).$type<ActivityMetadata>(),
		createdAt: epochMs("created_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => ({
		userCreatedIdx: index("activity_user_created_idx").on(
			table.userId,
			table.createdAt,
		),
		repoCreatedIdx: index("activity_repo_created_idx").on(
			table.repoId,
			table.createdAt,
		),
	}),
);

/** Personal access tokens for git over HTTPS; only the SHA-256 is stored. */
export const tokens = sqliteTable(
	"tokens",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		tokenHash: text("token_hash").notNull().unique(),
		scopes: text("scopes", { mode: "json" }).$type<TokenScope[]>().notNull(),
		lastUsedAt: epochMs("last_used_at"),
		expiresAt: epochMs("expires_at"),
		/** Set on tokens issued through an OAuth app's authorization code flow. */
		oauthAppId: integer("oauth_app_id").references(() => oauthApps.id, {
			onDelete: "cascade",
		}),
		createdAt: epochMs("created_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => ({
		userIdx: index("token_user_idx").on(table.userId),
		oauthAppIdx: index("token_oauth_app_idx").on(table.oauthAppId),
	}),
);

/**
 * OAuth apps a user registered at /settings/developers. The client secret is
 * shown once and only its SHA-256 is stored, like a token.
 */
export const oauthApps = sqliteTable(
	"oauth_apps",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		/** The one redirect URI an authorization may send the user back to. */
		callbackUrl: text("callback_url").notNull(),
		clientId: text("client_id").notNull().unique(),
		clientSecretHash: text("client_secret_hash").notNull(),
		createdAt: epochMs("created_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => ({
		userIdx: index("oauth_app_user_idx").on(table.userId),
	}),
);

/**
 * Authorization codes from /login/oauth/authorize, exchanged once at
 * /login/oauth/access_token. Only the SHA-256 of the code is stored.
 */
export const oauthCodes = sqliteTable(
	"oauth_codes",
	{
		codeHash: text("code_hash").primaryKey(),
		appId: integer("app_id")
			.notNull()
			.references(() => oauthApps.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		redirectUri: text("redirect_uri").notNull(),
		scopes: text("scopes", { mode: "json" }).$type<TokenScope[]>().notNull(),
		expiresAt: epochMs("expires_at").notNull(),
		consumedAt: epochMs("consumed_at"),
		createdAt: epochMs("created_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => ({
		expiresIdx: index("oauth_code_expires_idx").on(table.expiresAt),
	}),
);

/**
 * Device-flow authorizations (`gh auth login`). Only the SHA-256 of the device
 * code is stored; the user code is the short code typed on `/login/device`.
 * A row is single-use: `consumedAt` is set when its token is issued.
 */
export const deviceCodes = sqliteTable(
	"device_codes",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		deviceCodeHash: text("device_code_hash").notNull().unique(),
		/** Canonical `XXXX-XXXX` form. */
		userCode: text("user_code").notNull().unique(),
		clientId: text("client_id").notNull(),
		scopes: text("scopes", { mode: "json" }).$type<TokenScope[]>().notNull(),
		status: text("status").$type<DeviceCodeStatus>().notNull(),
		/** Set on approval or denial. */
		userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
		/** Seconds the client must wait between polls; grows on slow_down. */
		interval: integer("interval").notNull(),
		lastPolledAt: epochMs("last_polled_at"),
		expiresAt: epochMs("expires_at").notNull(),
		consumedAt: epochMs("consumed_at"),
		createdAt: epochMs("created_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => ({
		expiresIdx: index("device_code_expires_idx").on(table.expiresAt),
	}),
);

export const repoLocks = sqliteTable("repo_locks", {
	/** `${ownerKey}/${repoName}` */
	repoKey: text("repo_key").primaryKey(),
	holder: text("holder").notNull(),
	expiresAt: epochMs("expires_at").notNull(),
});

/**
 * Fixed-window request counters for Better Auth's rate limiter
 * (src/server/rate-limit.ts). One small row per rate-limited caller per
 * window; `key` is Better Auth's own limiter key (client IP + route).
 */
export const rateLimits = sqliteTable(
	"rate_limits",
	{
		key: text("key").primaryKey(),
		count: integer("count").notNull(),
		windowStartedAt: epochMs("window_started_at").notNull(),
	},
	(table) => ({
		// Supports the periodic expiry prune; without it every prune is a scan.
		windowIdx: index("rate_limit_window_idx").on(table.windowStartedAt),
	}),
);

export type Repository = typeof repositories.$inferSelect;
export type Issue = typeof issues.$inferSelect;
export type PullRequestReview = typeof pullRequestReviews.$inferSelect;
export type PullRequestReviewComment =
	typeof pullRequestReviewComments.$inferSelect;
export type CollaboratorRole =
	(typeof repositoryCollaborators.$inferSelect)["role"];

/**
 * Issue/PR timeline events (src/lib/timeline-types.ts), written only through
 * src/server/timeline-store.ts, on the issue (or pull request) `issue_id`.
 * `payload` is the event minus its `event` name.
 */
export const timelineEvents = sqliteTable(
	"timeline_events",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		issueId: integer("issue_id")
			.notNull()
			.references(() => issues.id, { onDelete: "cascade" }),
		actorId: text("actor_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		event: text("event").$type<TimelineEventType>().notNull(),
		payload: text("payload", { mode: "json" })
			.$type<Omit<TimelineEvent, "event">>()
			.notNull()
			.default({}),
		/** For cross-references, the mentioning thread: one event per pair. */
		sourceIssueId: integer("source_issue_id").references(() => issues.id, {
			onDelete: "cascade",
		}),
		createdAt: epochMs("created_at")
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => ({
		issueIdx: index("timeline_issue_idx").on(table.issueId, table.createdAt),
		crossReferenceIdx: uniqueIndex("timeline_cross_reference_idx")
			.on(table.issueId, table.sourceIssueId)
			.where(sql`${table.event} = 'cross-referenced'`),
	}),
);
