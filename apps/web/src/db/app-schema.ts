import { sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	boolean,
	check,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	serial,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import type { ActivityMetadata, ActivityType } from "#/lib/activity-types";
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

/**
 * Every app timestamp is `timestamp with time zone`. A plain `timestamp`
 * filled by the database's `now()` stores the session's wall clock, which
 * reads back shifted unless that session happens to be UTC.
 */
const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const repositories = pgTable(
	"repositories",
	{
		id: serial("id").primaryKey(),
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
		/** The tree view's per-file "last commit" column — a history walk per view, so opt-in. */
		showLastCommitColumn: boolean("show_last_commit_column")
			.notNull()
			.default(false),
		autoRefreshPrDiffs: boolean("auto_refresh_pr_diffs")
			.notNull()
			.default(false),
		/**
		 * The next `#N` for an issue or PR — one shared sequence per repo
		 * (GitHub's model), claimed with an atomic increment.
		 */
		nextIssueNumber: integer("next_issue_number").notNull().default(1),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
		updatedAt: timestamptz("updated_at").notNull().defaultNow(),
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
	}),
);

/**
 * Every issue and pull request: GitHub's model, where a pull request *is* an
 * issue (one `#N` sequence, one set of comments, labels, assignees and
 * timeline events) and `pull_requests` holds only what a pull request adds,
 * 1:1 by issue id. `status` is the issue state; a merged pull request is
 * `closed` with `pull_requests.merged_at` set.
 */
export const issues = pgTable(
	"issues",
	{
		id: serial("id").primaryKey(),
		repoId: integer("repo_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		/** The repo-scoped `#N`, shared by issues and pull requests. */
		number: integer("number").notNull(),
		/** A pull request (its `pull_requests` row carries the branches). */
		isPullRequest: boolean("is_pull_request").notNull().default(false),
		authorId: text("author_id")
			.notNull()
			.references(() => user.id),
		title: text("title").notNull(),
		body: text("body"),
		status: text("status").$type<"open" | "closed">().notNull().default("open"),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
		/** When the body was last edited by hand (the "edited" marker); null if never. */
		editedAt: timestamptz("edited_at"),
		updatedAt: timestamptz("updated_at").notNull().defaultNow(),
		closedAt: timestamptz("closed_at"),
		/** GitHub's `closed_by`: who closed it (or merged it); null while open. */
		closedById: text("closed_by_id").references(() => user.id, {
			onDelete: "set null",
		}),
		/** GitHub's `state_reason` (issues only); null until first closed. */
		stateReason: text("state_reason").$type<IssueStateReason>(),
	},
	(table) => ({
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

export const labels = pgTable(
	"labels",
	{
		id: serial("id").primaryKey(),
		repoId: integer("repo_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		/** Lowercase hex without `#`, as the REST API returns it. */
		color: text("color").notNull(),
		description: text("description"),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
	},
	(table) => ({
		repoNameIdx: uniqueIndex("label_repo_name_idx").on(
			table.repoId,
			sql`lower(${table.name})`,
		),
	}),
);

export const threadLabels = pgTable(
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
export const threadAssignees = pgTable(
	"thread_assignees",
	{
		id: serial("id").primaryKey(),
		issueId: integer("issue_id")
			.notNull()
			.references(() => issues.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
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
 * What a pull request adds to its issue (1:1 by `issue_id`): the branches,
 * and once merged, who merged it, when, and the exact commit range.
 */
export const pullRequests = pgTable(
	"pull_requests",
	{
		issueId: integer("issue_id")
			.primaryKey()
			.references(() => issues.id, { onDelete: "cascade" }),
		sourceBranch: text("source_branch").notNull(),
		targetBranch: text("target_branch").notNull(),
		mergedAt: timestamptz("merged_at"),
		mergedBy: text("merged_by").references(() => user.id),
		mergeCommitSha: text("merge_commit_sha"),
		/** A draft can't be merged until it is marked ready for review. */
		isDraft: boolean("is_draft").notNull().default(false),
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

export const comments = pgTable(
	"comments",
	{
		id: serial("id").primaryKey(),
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
		createdAt: timestamptz("created_at").notNull().defaultNow(),
		/** When the body was last edited by hand (the "edited" marker); null if never. */
		editedAt: timestamptz("edited_at"),
		updatedAt: timestamptz("updated_at").notNull().defaultNow(),
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
export const commitComments = pgTable(
	"commit_comments",
	{
		id: serial("id").primaryKey(),
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
		createdAt: timestamptz("created_at").notNull().defaultNow(),
		editedAt: timestamptz("edited_at"),
		updatedAt: timestamptz("updated_at").notNull().defaultNow(),
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
export const commitStatuses = pgTable(
	"commit_statuses",
	{
		id: serial("id").primaryKey(),
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
		createdAt: timestamptz("created_at").notNull().defaultNow(),
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
export const checkSuites = pgTable(
	"check_suites",
	{
		id: serial("id").primaryKey(),
		repoId: integer("repo_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		/** The full 40-character commit sha, lowercase. */
		headSha: text("head_sha").notNull(),
		/** The branch the caller named when creating the suite, if any. */
		headBranch: text("head_branch"),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
		updatedAt: timestamptz("updated_at").notNull().defaultNow(),
	},
	(table) => ({
		repoShaIdx: uniqueIndex("check_suite_repo_sha_idx").on(
			table.repoId,
			table.headSha,
		),
	}),
);

/** A check run (GitHub's checks API) reported by an external CI. */
export const checkRuns = pgTable(
	"check_runs",
	{
		id: serial("id").primaryKey(),
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
		startedAt: timestamptz("started_at"),
		completedAt: timestamptz("completed_at"),
		outputTitle: text("output_title"),
		outputSummary: text("output_summary"),
		outputText: text("output_text"),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
		updatedAt: timestamptz("updated_at").notNull().defaultNow(),
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
 * A user's reaction (GitHub's `content`: `+1`, `heart`, …) to an issue or pull
 * request (`comment_id` null) or to one of its comments. `issue_id` is always
 * the thread, so a thread's rollups are one indexed read. One row per user,
 * subject and content.
 */
export const reactions = pgTable(
	"reactions",
	{
		id: serial("id").primaryKey(),
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
		createdAt: timestamptz("created_at").notNull().defaultNow(),
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
export const threadSubscriptions = pgTable(
	"thread_subscriptions",
	{
		issueId: integer("issue_id")
			.notNull()
			.references(() => issues.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		subscribed: boolean("subscribed").notNull().default(true),
		reason: text("reason").$type<NotificationReason>().notNull(),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
		updatedAt: timestamptz("updated_at").notNull().defaultNow(),
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
export const notifications = pgTable(
	"notifications",
	{
		id: serial("id").primaryKey(),
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
		unread: boolean("unread").notNull().default(true),
		lastReadAt: timestamptz("last_read_at"),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
		updatedAt: timestamptz("updated_at").notNull().defaultNow(),
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
			.where(sql`${table.unread}`),
		issueIdx: index("notification_issue_idx").on(table.issueId),
	}),
);

/**
 * A pull request review (src/server/reviews.ts). A `pending` review is the
 * reviewer's unsubmitted draft; submitting sets one of the other states and
 * `submittedAt`. At most one pending review per reviewer per pull request.
 */
export const pullRequestReviews = pgTable(
	"pull_request_reviews",
	{
		id: serial("id").primaryKey(),
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
		submittedAt: timestamptz("submitted_at"),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
		updatedAt: timestamptz("updated_at").notNull().defaultNow(),
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
export const pullRequestReviewComments = pgTable(
	"pull_request_review_comments",
	{
		id: serial("id").primaryKey(),
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
			(): AnyPgColumn => pullRequestReviewComments.id,
			{ onDelete: "cascade" },
		),
		/** Thread resolution, set on the root comment only. */
		resolvedAt: timestamptz("resolved_at"),
		resolvedById: text("resolved_by_id").references(() => user.id),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
		updatedAt: timestamptz("updated_at").notNull().defaultNow(),
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

export const stars = pgTable(
	"stars",
	{
		id: serial("id").primaryKey(),
		repoId: integer("repo_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
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
export const repositorySubscriptions = pgTable(
	"repository_subscriptions",
	{
		repoId: integer("repo_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		ignored: boolean("ignored").notNull().default(false),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.repoId, table.userId] }),
		userIdx: index("repository_subscription_user_idx").on(table.userId),
	}),
);

/** `follower_id` follows `followee_id` (never themselves). */
export const follows = pgTable(
	"follows",
	{
		followerId: text("follower_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		followeeId: text("followee_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
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

export const repositoryCollaborators = pgTable(
	"repository_collaborators",
	{
		id: serial("id").primaryKey(),
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
		createdAt: timestamptz("created_at").notNull().defaultNow(),
	},
	(table) => ({
		repoUserIdx: uniqueIndex("collab_repo_user_idx").on(
			table.repoId,
			table.userId,
		),
		userIdx: index("collab_user_idx").on(table.userId),
	}),
);

export const activities = pgTable(
	"activities",
	{
		id: serial("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		repoId: integer("repo_id").references(() => repositories.id, {
			onDelete: "cascade",
		}),
		/** With `metadata`, one ActivityEvent — written only via recordActivity. */
		type: text("type").$type<ActivityType>().notNull(),
		metadata: jsonb("metadata").$type<ActivityMetadata>(),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
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
export const tokens = pgTable(
	"tokens",
	{
		id: serial("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		tokenHash: text("token_hash").notNull().unique(),
		scopes: jsonb("scopes").$type<TokenScope[]>().notNull(),
		lastUsedAt: timestamptz("last_used_at"),
		expiresAt: timestamptz("expires_at"),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
	},
	(table) => ({
		userIdx: index("token_user_idx").on(table.userId),
	}),
);

export const repoLocks = pgTable("repo_locks", {
	/** `${ownerKey}/${repoName}` */
	repoKey: text("repo_key").primaryKey(),
	holder: text("holder").notNull(),
	expiresAt: timestamptz("expires_at").notNull(),
});

/**
 * Fixed-window request counters for Better Auth's rate limiter
 * (src/server/rate-limit.ts). One small row per rate-limited caller per
 * window; `key` is Better Auth's own limiter key (client IP + route).
 */
export const rateLimits = pgTable(
	"rate_limits",
	{
		key: text("key").primaryKey(),
		count: integer("count").notNull(),
		windowStartedAt: timestamptz("window_started_at").notNull(),
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
export const timelineEvents = pgTable(
	"timeline_events",
	{
		id: serial("id").primaryKey(),
		issueId: integer("issue_id")
			.notNull()
			.references(() => issues.id, { onDelete: "cascade" }),
		actorId: text("actor_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		event: text("event").$type<TimelineEventType>().notNull(),
		payload: jsonb("payload")
			.$type<Omit<TimelineEvent, "event">>()
			.notNull()
			.default({}),
		/** For cross-references, the mentioning thread: one event per pair. */
		sourceIssueId: integer("source_issue_id").references(() => issues.id, {
			onDelete: "cascade",
		}),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
	},
	(table) => ({
		issueIdx: index("timeline_issue_idx").on(table.issueId, table.createdAt),
		crossReferenceIdx: uniqueIndex("timeline_cross_reference_idx")
			.on(table.issueId, table.sourceIssueId)
			.where(sql`${table.event} = 'cross-referenced'`),
	}),
);
