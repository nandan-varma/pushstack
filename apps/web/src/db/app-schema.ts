import { sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	boolean,
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

/**
 * Repository metadata; git data itself lives in R2 under
 * `repos/{ownerKey}/{name}/git` (src/server/git-storage-naming.ts).
 */
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
		/** Poll an open PR's diff instead of loading it once. */
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

export const issues = pgTable(
	"issues",
	{
		id: serial("id").primaryKey(),
		repoId: integer("repo_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		/** The repo-scoped `#N` (shared with pull requests). */
		number: integer("number").notNull(),
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
		/** GitHub's `state_reason`; null until the issue is first closed. */
		stateReason: text("state_reason").$type<IssueStateReason>(),
	},
	(table) => ({
		repoNumberIdx: uniqueIndex("issue_repo_number_idx").on(
			table.repoId,
			table.number,
		),
		repoStatusIdx: index("issue_repo_status_idx").on(
			table.repoId,
			table.status,
		),
	}),
);

/** A repository's label (name, 6-digit hex color, description). */
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
		// Label names are unique per repository, ignoring case.
		repoNameIdx: uniqueIndex("label_repo_name_idx").on(
			table.repoId,
			sql`lower(${table.name})`,
		),
	}),
);

/** A label applied to issue/PR `#number` (they share one number sequence). */
export const threadLabels = pgTable(
	"thread_labels",
	{
		repoId: integer("repo_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		number: integer("number").notNull(),
		labelId: integer("label_id")
			.notNull()
			.references(() => labels.id, { onDelete: "cascade" }),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.repoId, table.number, table.labelId] }),
		labelIdx: index("thread_label_label_idx").on(table.labelId),
	}),
);

/** Who an issue is assigned to (GitHub: up to 10, each with write access). */
export const issueAssignees = pgTable(
	"issue_assignees",
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
		issueUserIdx: uniqueIndex("issue_assignee_issue_user_idx").on(
			table.issueId,
			table.userId,
		),
		userIdx: index("issue_assignee_user_idx").on(table.userId),
	}),
);

export const pullRequests = pgTable(
	"pull_requests",
	{
		id: serial("id").primaryKey(),
		repoId: integer("repo_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		/** The repo-scoped `#N` (shared with issues). */
		number: integer("number").notNull(),
		authorId: text("author_id")
			.notNull()
			.references(() => user.id),
		title: text("title").notNull(),
		body: text("body"),
		sourceBranch: text("source_branch").notNull(),
		targetBranch: text("target_branch").notNull(),
		status: text("status")
			.$type<"open" | "closed" | "merged">()
			.notNull()
			.default("open"),
		mergedAt: timestamptz("merged_at"),
		mergedBy: text("merged_by").references(() => user.id),
		mergeCommitSha: text("merge_commit_sha"),
		/** The base and head tips that were merged: the PR's exact commit range. */
		baseSha: text("base_sha"),
		headSha: text("head_sha"),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
		/** When the body was last edited by hand (the "edited" marker); null if never. */
		editedAt: timestamptz("edited_at"),
		updatedAt: timestamptz("updated_at").notNull().defaultNow(),
	},
	(table) => ({
		repoNumberIdx: uniqueIndex("pr_repo_number_idx").on(
			table.repoId,
			table.number,
		),
		repoStatusIdx: index("pr_repo_status_idx").on(table.repoId, table.status),
	}),
);

/** A comment on exactly one issue or pull request. */
export const comments = pgTable(
	"comments",
	{
		id: serial("id").primaryKey(),
		repoId: integer("repo_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		issueId: integer("issue_id").references(() => issues.id, {
			onDelete: "cascade",
		}),
		pullRequestId: integer("pull_request_id").references(
			() => pullRequests.id,
			{ onDelete: "cascade" },
		),
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
		issueIdx: index("comment_issue_idx").on(table.issueId),
		prIdx: index("comment_pr_idx").on(table.pullRequestId),
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
			.references(() => pullRequests.id, { onDelete: "cascade" }),
		authorId: text("author_id")
			.notNull()
			.references(() => user.id),
		state: text("state").$type<ReviewState>().notNull().default("pending"),
		/** The summary shown above the comments; null until submitted. */
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
			.references(() => pullRequests.id, { onDelete: "cascade" }),
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

/** Per-repository write lease (src/server/git-repo-lock.ts). */
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
export type PullRequest = typeof pullRequests.$inferSelect;
export type PullRequestReview = typeof pullRequestReviews.$inferSelect;
export type PullRequestReviewComment =
	typeof pullRequestReviewComments.$inferSelect;
export type CollaboratorRole =
	(typeof repositoryCollaborators.$inferSelect)["role"];

/**
 * Issue/PR timeline events (src/lib/timeline-types.ts), written only through
 * src/server/timeline-store.ts. Issues and PRs share the `#N` sequence, so
 * `number` names the thread either way. `payload` is the event minus its
 * `event` name.
 */
export const timelineEvents = pgTable(
	"timeline_events",
	{
		id: serial("id").primaryKey(),
		repoId: integer("repo_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		number: integer("number").notNull(),
		actorId: text("actor_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		event: text("event").$type<TimelineEventType>().notNull(),
		payload: jsonb("payload")
			.$type<Omit<TimelineEvent, "event">>()
			.notNull()
			.default({}),
		/** For cross-references, the mentioning thread (`#M`): one event per pair. */
		sourceNumber: integer("source_number"),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
	},
	(table) => ({
		threadIdx: index("timeline_thread_idx").on(
			table.repoId,
			table.number,
			table.createdAt,
		),
		crossReferenceIdx: uniqueIndex("timeline_cross_reference_idx")
			.on(table.repoId, table.number, table.sourceNumber)
			.where(sql`${table.event} = 'cross-referenced'`),
	}),
);
