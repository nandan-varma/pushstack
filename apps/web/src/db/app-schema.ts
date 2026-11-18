import { sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	bigint,
	boolean,
	check,
	date,
	doublePrecision,
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
import type { DeviceCodeStatus } from "#/lib/device-flow";
import type { DiscussionStateReason } from "#/lib/discussions";
import type { NotificationReason } from "#/lib/notifications";
import type { ReactionContent } from "#/lib/reactions";
import type { ReviewSide, ReviewState } from "#/lib/review-types";
import type { ThreadKind } from "#/lib/thread-kind";
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
		/** Exactly one of `ownerId` and `organizationId` is set (the check below). */
		ownerId: text("owner_id").references(() => user.id, {
			onDelete: "cascade",
		}),
		organizationId: integer("organization_id").references(
			() => organizations.id,
			{ onDelete: "cascade" },
		),
		name: text("name").notNull(),
		description: text("description"),
		visibility: text("visibility")
			.$type<"public" | "private">()
			.notNull()
			.default("public"),
		defaultBranch: text("default_branch").notNull().default("main"),
		/** Read-only: pushes and every write (issues, comments, PRs) are refused. */
		archived: boolean("archived").notNull().default(false),
		homepage: text("homepage"),
		/** Lowercase, at most 20 (`MAX_REPO_TOPICS`). */
		topics: jsonb("topics").$type<string[]>().notNull().default([]),
		isTemplate: boolean("is_template").notNull().default(false),
		/**
		 * The repository this one was forked from (GitHub's `parent`). Null for a
		 * repository that is not a fork, or once its parent is deleted.
		 */
		forkOfId: integer("fork_of_id").references(
			(): AnyPgColumn => repositories.id,
			{ onDelete: "set null" },
		),
		/** GitHub's `fork`: stays true after the parent is deleted. */
		isFork: boolean("is_fork").notNull().default(false),
		hasIssues: boolean("has_issues").notNull().default(true),
		hasWiki: boolean("has_wiki").notNull().default(true),
		/** GitHub's "restrict editing to collaborators only". */
		wikiEditRestricted: boolean("wiki_edit_restricted")
			.notNull()
			.default(false),
		/** No projects exist yet, so they default off (GitHub: on). */
		hasProjects: boolean("has_projects").notNull().default(false),
		/** GitHub enables discussions on a new repository. */
		hasDiscussions: boolean("has_discussions").notNull().default(true),
		/**
		 * Which merge methods a pull request may use; all on by default. At least
		 * one stays on: `updateRepositorySettings` refuses a patch that leaves none.
		 */
		allowMergeCommit: boolean("allow_merge_commit").notNull().default(true),
		allowSquashMerge: boolean("allow_squash_merge").notNull().default(true),
		allowRebaseMerge: boolean("allow_rebase_merge").notNull().default(true),
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
		/** The next milestone `number` (its own per-repo sequence), claimed atomically. */
		nextMilestoneNumber: integer("next_milestone_number").notNull().default(1),
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
		orgNameIdx: uniqueIndex("repo_org_name_idx").on(
			table.organizationId,
			table.name,
		),
		nameIdx: index("repo_name_idx").on(table.name),
		visibilityIdx: index("repo_visibility_idx").on(table.visibility),
		forkOfIdx: index("repo_fork_of_idx").on(table.forkOfId),
		orgIdx: index("repo_org_idx").on(table.organizationId),
		singleOwner: check(
			"repositories_single_owner",
			sql`num_nonnulls(${table.ownerId}, ${table.organizationId}) = 1`,
		),
	}),
);

/**
 * The namespace registry both a user and an organization claim at creation,
 * written only in the same transaction as the row it names.
 * `lower(login)` is unique so `Alice` cannot be a second owner beside `alice`
 * (their storage keys would collide) and a login cannot belong to a user and
 * an organization at once.
 */
export const logins = pgTable(
	"logins",
	{
		login: text("login").notNull(),
		kind: text("kind").$type<"user" | "organization">().notNull(),
		refId: text("ref_id").notNull(),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
	},
	(table) => ({
		loginIdx: uniqueIndex("logins_login_idx").on(sql`lower(${table.login})`),
		refIdx: uniqueIndex("logins_ref_idx").on(table.kind, table.refId),
	}),
);

/**
 * An organization is a repository owner beside a user. Its login is
 * immutable: it names the `repos/{login}/` storage prefix, and moving that is
 * a separate operation. Settings that belong to a profile are here; members
 * and their roles live in `org_memberships`.
 */
export const organizations = pgTable(
	"organizations",
	{
		id: serial("id").primaryKey(),
		login: text("login").notNull(),
		name: text("name"),
		description: text("description"),
		blog: text("blog"),
		location: text("location"),
		email: text("email"),
		twitterUsername: text("twitter_username"),
		defaultRepositoryPermission: text("default_repository_permission")
			.$type<"none" | "read" | "write" | "admin">()
			.notNull()
			.default("read"),
		membersCanCreateRepositories: boolean("members_can_create_repositories")
			.notNull()
			.default(true),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
		updatedAt: timestamptz("updated_at").notNull().defaultNow(),
	},
	(table) => ({
		loginIdx: uniqueIndex("org_login_idx").on(sql`lower(${table.login})`),
	}),
);

/**
 * A user's place in an organization: `state` is `pending` until an invitation
 * is accepted, and only `active` grants the organization's base permission.
 * `role` is organization administration, never repository ownership.
 */
export const orgMemberships = pgTable(
	"org_memberships",
	{
		orgId: integer("org_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		role: text("role").$type<"admin" | "member">().notNull().default("member"),
		state: text("state")
			.$type<"active" | "pending">()
			.notNull()
			.default("active"),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.orgId, table.userId] }),
		userIdx: index("org_membership_user_idx").on(table.userId),
	}),
);

/**
 * A team: a named group inside one organization, nestable under a parent team.
 * `slug` is derived from the name and unique per organization; a child team
 * inherits its ancestors' repository grants. `privacy` is `secret` (invisible
 * to non-members) or `closed` (visible to every member).
 */
export const teams = pgTable(
	"teams",
	{
		id: serial("id").primaryKey(),
		orgId: integer("org_id")
			.notNull()
			.references(() => organizations.id, { onDelete: "cascade" }),
		slug: text("slug").notNull(),
		name: text("name").notNull(),
		description: text("description"),
		privacy: text("privacy")
			.$type<"closed" | "secret">()
			.notNull()
			.default("closed"),
		parentTeamId: integer("parent_team_id").references(
			(): AnyPgColumn => teams.id,
			{ onDelete: "set null" },
		),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
		updatedAt: timestamptz("updated_at").notNull().defaultNow(),
	},
	(table) => ({
		/** Case-insensitive, so `Core` and `core` cannot be two teams. */
		slugIdx: uniqueIndex("team_org_slug_idx").on(
			table.orgId,
			sql`lower(${table.slug})`,
		),
		orgIdx: index("team_org_idx").on(table.orgId),
		parentIdx: index("team_parent_idx").on(table.parentTeamId),
	}),
);

/** A member of a team: `maintainer` may change the team's repositories. */
export const teamMemberships = pgTable(
	"team_memberships",
	{
		teamId: integer("team_id")
			.notNull()
			.references(() => teams.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		role: text("role")
			.$type<"member" | "maintainer">()
			.notNull()
			.default("member"),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.teamId, table.userId] }),
		userIdx: index("team_membership_user_idx").on(table.userId),
	}),
);

/** A team's grant on one repository, on the same ladder as a collaborator. */
export const teamRepositories = pgTable(
	"team_repositories",
	{
		teamId: integer("team_id")
			.notNull()
			.references(() => teams.id, { onDelete: "cascade" }),
		repoId: integer("repo_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		permission: text("permission")
			.$type<"read" | "triage" | "write" | "maintain" | "admin">()
			.notNull()
			.default("read"),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.teamId, table.repoId] }),
		repoIdx: index("team_repository_repo_idx").on(table.repoId),
	}),
);

/**
 * Every issue, pull request and discussion: GitHub's model, where a pull
 * request and a discussion *are* issues (one `#N` sequence, one set of
 * comments, labels, assignees and timeline events) and `pull_requests` /
 * `discussions` hold only what each kind adds, 1:1 by issue id. `status` is
 * the issue state; a merged pull request is `closed` with
 * `pull_requests.merged_at` set.
 */
export const issues = pgTable(
	"issues",
	{
		id: serial("id").primaryKey(),
		repoId: integer("repo_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		/** The repo-scoped `#N`, shared by every thread kind. */
		number: integer("number").notNull(),
		/** The thread kind: a pull request adds a `pull_requests` row, a discussion a `discussions` row. */
		kind: text("kind").$type<ThreadKind>().notNull().default("issue"),
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
		/** GitHub's `milestone`: at most one; deleting the milestone clears it. */
		milestoneId: integer("milestone_id").references(
			(): AnyPgColumn => milestones.id,
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
			table.kind,
			table.status,
			table.createdAt,
		),
		repoKindStateUpdatedIdx: index("issue_repo_kind_state_updated_idx").on(
			table.repoId,
			table.kind,
			table.status,
			table.updatedAt,
		),
	}),
);

/** A repository's milestones; `number` is a per-repo sequence separate from `#N`. */
export const milestones = pgTable(
	"milestones",
	{
		id: serial("id").primaryKey(),
		repoId: integer("repo_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		number: integer("number").notNull(),
		title: text("title").notNull(),
		description: text("description"),
		state: text("state").$type<"open" | "closed">().notNull().default("open"),
		dueOn: timestamptz("due_on"),
		creatorId: text("creator_id").references(() => user.id, {
			onDelete: "set null",
		}),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
		updatedAt: timestamptz("updated_at").notNull().defaultNow(),
		closedAt: timestamptz("closed_at"),
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
 * Users whose review is requested on a pull request (GitHub's
 * `requested_reviewers`). A submitted review or an explicit removal deletes the
 * row; requesting again re-adds it. Teams are not modelled yet.
 */
export const pullRequestReviewRequests = pgTable(
	"pull_request_review_requests",
	{
		id: serial("id").primaryKey(),
		issueId: integer("issue_id")
			.notNull()
			.references(() => issues.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		requesterId: text("requester_id").references(() => user.id, {
			onDelete: "set null",
		}),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
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
export const pullRequests = pgTable(
	"pull_requests",
	{
		issueId: integer("issue_id")
			.primaryKey()
			.references(() => issues.id, { onDelete: "cascade" }),
		/** The head branch: in this repository, or in the fork named by `headOwner`. */
		sourceBranch: text("source_branch").notNull(),
		targetBranch: text("target_branch").notNull(),
		/**
		 * The fork the head branch lives in (GitHub's `head.repo`). Null once that
		 * fork is deleted; the PR then keeps working from `refs/pull/<n>/head`.
		 */
		headRepoId: integer("head_repo_id").references(() => repositories.id, {
			onDelete: "set null",
		}),
		/**
		 * Owner of the head repository when it is not this one (the `owner` of
		 * `head.label`); null for a branch of this repository. Unlike
		 * `headRepoId` it outlives the fork, so it says the PR is cross-repository.
		 */
		headOwner: text("head_owner"),
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
		/**
		 * The discussion comment this one answers (one reply level): a reply's
		 * target must be a top-level comment.
		 */
		replyToId: integer("reply_to_id").references(
			(): AnyPgColumn => comments.id,
			{ onDelete: "cascade" },
		),
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
 * A repository's discussion categories. `format` drives GraphQL's
 * `isAnswerable` (`q_and_a`) and the write-access rule for announcements.
 */
export const discussionCategories = pgTable(
	"discussion_categories",
	{
		id: serial("id").primaryKey(),
		repoId: integer("repo_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		slug: text("slug").notNull(),
		emoji: text("emoji").notNull(),
		description: text("description"),
		format: text("format")
			.$type<"open" | "announcement" | "q_and_a">()
			.notNull()
			.default("open"),
		position: integer("position").notNull().default(0),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
	},
	(table) => ({
		repoSlugIdx: uniqueIndex("discussion_category_repo_slug_idx").on(
			table.repoId,
			table.slug,
		),
		repoNameIdx: uniqueIndex("discussion_category_repo_name_idx").on(
			table.repoId,
			sql`lower(${table.name})`,
		),
	}),
);

/**
 * What a discussion adds to its issue (1:1 by `issue_id`), as
 * `pull_requests` does for a pull request.
 */
export const discussions = pgTable(
	"discussions",
	{
		issueId: integer("issue_id")
			.primaryKey()
			.references(() => issues.id, { onDelete: "cascade" }),
		categoryId: integer("category_id")
			.notNull()
			.references(() => discussionCategories.id, { onDelete: "restrict" }),
		answerCommentId: integer("answer_comment_id").references(
			(): AnyPgColumn => comments.id,
			{ onDelete: "set null" },
		),
		answerChosenAt: timestamptz("answer_chosen_at"),
		answerChosenById: text("answer_chosen_by_id").references(() => user.id, {
			onDelete: "set null",
		}),
		locked: boolean("locked").notNull().default(false),
		pinnedAt: timestamptz("pinned_at"),
		/**
		 * GitHub's `DiscussionStateReason`, kept apart from an issue's: a
		 * discussion closes as resolved, outdated or duplicate, not completed.
		 */
		stateReason: text("state_reason").$type<DiscussionStateReason>(),
	},
	(table) => ({
		categoryPinnedIdx: index("discussion_category_pinned_idx").on(
			table.categoryId,
			table.pinnedAt,
		),
		answerIdx: index("discussion_answer_idx").on(table.answerCommentId),
	}),
);

/**
 * An upvote on a discussion or one of its comments. It is not a reaction:
 * GitHub counts `upvoteCount` separately from `reactionGroups`.
 */
export const discussionUpvotes = pgTable(
	"discussion_upvotes",
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
		createdAt: timestamptz("created_at").notNull().defaultNow(),
	},
	(table) => ({
		discussionUserIdx: uniqueIndex("discussion_upvote_discussion_idx")
			.on(table.issueId, table.userId)
			.where(sql`${table.commentId} is null`),
		commentUserIdx: uniqueIndex("discussion_upvote_comment_idx")
			.on(table.commentId, table.userId)
			.where(sql`${table.commentId} is not null`),
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
 * GitHub releases: a tag with notes and downloadable assets. `tag_name` is a
 * name, not a reference: deleting the tag keeps the release (it becomes a
 * draft, as on GitHub). Published releases are unique per tag; drafts may
 * repeat a tag. `make_latest` is GitHub's `true`/`false`/`legacy`.
 */
export const releases = pgTable(
	"releases",
	{
		id: serial("id").primaryKey(),
		repoId: integer("repo_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		tagName: text("tag_name").notNull(),
		targetCommitish: text("target_commitish").notNull(),
		name: text("name"),
		body: text("body"),
		draft: boolean("draft").notNull().default(false),
		prerelease: boolean("prerelease").notNull().default(false),
		makeLatest: text("make_latest")
			.$type<"true" | "false" | "legacy">()
			.notNull()
			.default("legacy"),
		authorId: text("author_id")
			.notNull()
			.references(() => user.id),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
		/** Null while a draft; set when it is published. */
		publishedAt: timestamptz("published_at"),
		updatedAt: timestamptz("updated_at").notNull().defaultNow(),
	},
	(table) => ({
		repoCreatedIdx: index("release_repo_created_idx").on(
			table.repoId,
			table.createdAt,
		),
		publishedTagIdx: uniqueIndex("release_published_tag_idx")
			.on(table.repoId, table.tagName)
			.where(sql`${table.draft} = false`),
	}),
);

/**
 * A file attached to a release. The bytes live in R2 at
 * `getReleaseAssetKey(owner, repo, id)`; `state` is `open` while a presigned
 * upload is pending and `uploaded` once the bytes are verified.
 */
export const releaseAssets = pgTable(
	"release_assets",
	{
		id: serial("id").primaryKey(),
		releaseId: integer("release_id")
			.notNull()
			.references(() => releases.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		label: text("label"),
		contentType: text("content_type").notNull(),
		size: bigint("size", { mode: "number" }).notNull(),
		state: text("state").$type<"open" | "uploaded">().notNull(),
		downloadCount: integer("download_count").notNull().default(0),
		uploaderId: text("uploader_id")
			.notNull()
			.references(() => user.id),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
		updatedAt: timestamptz("updated_at").notNull().defaultNow(),
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

/**
 * A repository webhook (GitHub's `Repository` hook). The secret is sealed
 * with AES-256-GCM (webhook-secret.ts) and never read back by the API; the
 * delivery state is denormalized onto the row so listing hooks is one read.
 */
export const webhooks = pgTable(
	"webhooks",
	{
		id: serial("id").primaryKey(),
		repoId: integer("repo_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		url: text("url").notNull(),
		contentType: text("content_type")
			.$type<"json" | "form">()
			.notNull()
			.default("form"),
		secretSealed: text("secret_sealed"),
		events: jsonb("events").$type<string[]>().notNull().default(["push"]),
		active: boolean("active").notNull().default(true),
		lastStatusCode: integer("last_status_code"),
		lastStatus: text("last_status"),
		lastMessage: text("last_message"),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
		updatedAt: timestamptz("updated_at").notNull().defaultNow(),
	},
	(table) => ({
		repoIdx: index("webhook_repo_idx").on(table.repoId),
	}),
);

/** One outbound delivery attempt; only the newest per hook are kept. */
export const webhookDeliveries = pgTable(
	"webhook_deliveries",
	{
		id: serial("id").primaryKey(),
		webhookId: integer("webhook_id")
			.notNull()
			.references(() => webhooks.id, { onDelete: "cascade" }),
		guid: text("guid").notNull(),
		event: text("event").notNull(),
		action: text("action"),
		requestHeaders: jsonb("request_headers")
			.$type<Record<string, string>>()
			.notNull(),
		requestPayload: text("request_payload"),
		status: text("status").$type<"success" | "failure">().notNull(),
		statusCode: integer("status_code"),
		responseHeaders: jsonb("response_headers").$type<Record<
			string,
			string
		> | null>(),
		responsePayload: text("response_payload"),
		durationMs: integer("duration_ms").notNull(),
		redelivery: boolean("redelivery").notNull().default(false),
		deliveredAt: timestamptz("delivered_at").notNull().defaultNow(),
	},
	(table) => ({
		webhookIdx: index("webhook_delivery_webhook_idx").on(
			table.webhookId,
			table.id,
		),
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
			.$type<"read" | "triage" | "write" | "maintain" | "admin">()
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

/**
 * Classic branch protection: one rule per `fnmatch` branch pattern per
 * repository, and the oldest rule whose pattern matches a branch wins (a
 * branch has at most one rule, as on GitHub). `required_status_checks_strict`
 * null is GitHub's `required_status_checks: null`.
 */
export const branchProtectionRules = pgTable(
	"branch_protection_rules",
	{
		id: serial("id").primaryKey(),
		repoId: integer("repo_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		pattern: text("pattern").notNull(),
		requiresPullRequest: boolean("requires_pull_request")
			.notNull()
			.default(false),
		requiredApprovingReviewCount: integer("required_approving_review_count")
			.notNull()
			.default(0),
		dismissStaleReviews: boolean("dismiss_stale_reviews")
			.notNull()
			.default(false),
		requireCodeOwnerReviews: boolean("require_code_owner_reviews")
			.notNull()
			.default(false),
		requiredStatusChecksStrict: boolean("required_status_checks_strict"),
		enforceAdmins: boolean("enforce_admins").notNull().default(false),
		allowForcePushes: boolean("allow_force_pushes").notNull().default(false),
		allowDeletions: boolean("allow_deletions").notNull().default(false),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
		updatedAt: timestamptz("updated_at").notNull().defaultNow(),
	},
	(table) => ({
		repoPatternIdx: uniqueIndex("branch_protection_repo_pattern_idx").on(
			table.repoId,
			table.pattern,
		),
		repoCreatedIdx: index("branch_protection_repo_created_idx").on(
			table.repoId,
			table.createdAt,
		),
	}),
);

/**
 * A context a rule requires; `app_id` null means any app, as on GitHub.
 * `(rule_id, context)` is also the read order the REST object returns.
 */
export const branchProtectionStatusChecks = pgTable(
	"branch_protection_status_checks",
	{
		ruleId: integer("rule_id")
			.notNull()
			.references(() => branchProtectionRules.id, { onDelete: "cascade" }),
		context: text("context").notNull(),
		appId: integer("app_id"),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.ruleId, table.context] }),
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
		/** Set on tokens issued through an OAuth app's authorization code flow. */
		oauthAppId: integer("oauth_app_id").references(() => oauthApps.id, {
			onDelete: "cascade",
		}),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
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
export const oauthApps = pgTable(
	"oauth_apps",
	{
		id: serial("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		/** The one redirect URI an authorization may send the user back to. */
		callbackUrl: text("callback_url").notNull(),
		clientId: text("client_id").notNull().unique(),
		clientSecretHash: text("client_secret_hash").notNull(),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
	},
	(table) => ({
		userIdx: index("oauth_app_user_idx").on(table.userId),
	}),
);

/**
 * Authorization codes from /login/oauth/authorize, exchanged once at
 * /login/oauth/access_token. Only the SHA-256 of the code is stored.
 */
export const oauthCodes = pgTable(
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
		scopes: jsonb("scopes").$type<TokenScope[]>().notNull(),
		expiresAt: timestamptz("expires_at").notNull(),
		consumedAt: timestamptz("consumed_at"),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
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
export const deviceCodes = pgTable(
	"device_codes",
	{
		id: serial("id").primaryKey(),
		deviceCodeHash: text("device_code_hash").notNull().unique(),
		/** Canonical `XXXX-XXXX` form. */
		userCode: text("user_code").notNull().unique(),
		clientId: text("client_id").notNull(),
		scopes: jsonb("scopes").$type<TokenScope[]>().notNull(),
		status: text("status").$type<DeviceCodeStatus>().notNull(),
		/** Set on approval or denial. */
		userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
		/** Seconds the client must wait between polls; grows on slow_down. */
		interval: integer("interval").notNull(),
		lastPolledAt: timestamptz("last_polled_at"),
		expiresAt: timestamptz("expires_at").notNull(),
		consumedAt: timestamptz("consumed_at"),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
	},
	(table) => ({
		expiresIdx: index("device_code_expires_idx").on(table.expiresAt),
	}),
);

/**
 * Named leases (`git-repo-lock.ts`), since serverless instances share no memory.
 * `repo_key` is `${ownerKey}/${repoName}` for a git write and
 * `caps/<repoId>/lock` for a per-repository capacity check; the two-slash shape
 * keeps the namespaces apart (a git key has exactly one slash).
 */
export const repoLocks = pgTable("repo_locks", {
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

/**
 * A user's OpenPGP public key, added through `POST /user/gpg_keys`. Only
 * public keys are stored; `key_ids` holds the primary and subkey ids
 * (uppercase hex) so a signature's issuer is matched without re-parsing every
 * key on every commit read.
 */
export const gpgKeys = pgTable(
	"gpg_keys",
	{
		id: serial("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		primaryKeyId: text("primary_key_id").notNull(),
		keyIds: jsonb("key_ids").$type<string[]>().notNull(),
		publicKey: text("public_key").notNull(),
		emails: jsonb("emails").$type<string[]>().notNull().default([]),
		canSign: boolean("can_sign").notNull().default(true),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
		expiresAt: timestamptz("expires_at"),
	},
	(table) => ({
		userIdx: index("gpg_key_user_idx").on(table.userId),
	}),
);

/**
 * A user's SSH signing key (`ssh-ed25519 AAAA… comment`), added through
 * `POST /user/ssh_signing_keys`. The fingerprint is OpenSSH's SHA256 form:
 * it is shown to the user and matched against an SSHSIG signature's key.
 */
export const sshSigningKeys = pgTable(
	"ssh_signing_keys",
	{
		id: serial("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		title: text("title").notNull(),
		key: text("key").notNull(),
		fingerprint: text("fingerprint").notNull(),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
	},
	(table) => ({
		userIdx: index("ssh_signing_key_user_idx").on(table.userId),
	}),
);

export type Repository = typeof repositories.$inferSelect;
export type Organization = typeof organizations.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type TeamMembership = typeof teamMemberships.$inferSelect;
export type TeamRepository = typeof teamRepositories.$inferSelect;
export type Login = typeof logins.$inferSelect;
export type OrgMembership = typeof orgMemberships.$inferSelect;
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

/**
 * A gist: a small git repository with an id, not a `repositories` row (it
 * would surface in repository lists and collide with `(owner_id, name)`).
 * Secret means unlisted, not private: anyone holding the id reads it. Its git
 * bytes live at `gists/{id}/git` in R2.
 */
export const gists = pgTable(
	"gists",
	{
		/** 32 lowercase hex (GitHub's shape); the id is also the storage segment. */
		id: text("id").primaryKey(),
		ownerId: text("owner_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		description: text("description"),
		visibility: text("visibility")
			.$type<"public" | "secret">()
			.notNull()
			.default("public"),
		/** The gist this one was forked from; null once the parent is deleted. */
		forkOfId: text("fork_of_id").references((): AnyPgColumn => gists.id, {
			onDelete: "set null",
		}),
		/** GitHub's `fork`: stays true after the parent is deleted. */
		isFork: boolean("is_fork").notNull().default(false),
		/** Last REST update or push (GitHub's `pushed_at`). */
		pushedAt: timestamptz("pushed_at").notNull().defaultNow(),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
		updatedAt: timestamptz("updated_at").notNull().defaultNow(),
	},
	(table) => ({
		ownerCreatedIdx: index("gist_owner_created_idx").on(
			table.ownerId,
			table.createdAt,
		),
		visibilityUpdatedIdx: index("gist_visibility_updated_idx").on(
			table.visibility,
			table.updatedAt,
		),
		forkOfIdx: index("gist_fork_of_idx").on(table.forkOfId),
	}),
);

export const gistStars = pgTable(
	"gist_stars",
	{
		gistId: text("gist_id")
			.notNull()
			.references(() => gists.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.gistId, table.userId] }),
		userIdx: index("gist_star_user_idx").on(table.userId),
	}),
);

export const gistComments = pgTable(
	"gist_comments",
	{
		id: serial("id").primaryKey(),
		gistId: text("gist_id")
			.notNull()
			.references(() => gists.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		body: text("body").notNull(),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
		updatedAt: timestamptz("updated_at").notNull().defaultNow(),
	},
	(table) => ({
		gistCreatedIdx: index("gist_comment_gist_created_idx").on(
			table.gistId,
			table.createdAt,
		),
		userIdx: index("gist_comment_user_idx").on(table.userId),
	}),
);

/**
 * Projects v2 owned by a user. `number` is a per-owner sequence, claimed from
 * `users.next_project_number` with one atomic UPDATE.
 */
export const projectV2 = pgTable(
	"project_v2",
	{
		id: serial("id").primaryKey(),
		ownerId: text("owner_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		number: integer("number").notNull(),
		title: text("title").notNull(),
		shortDescription: text("short_description"),
		readme: text("readme"),
		public: boolean("public").notNull().default(false),
		closed: boolean("closed").notNull().default(false),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
		updatedAt: timestamptz("updated_at").notNull().defaultNow(),
		closedAt: timestamptz("closed_at"),
	},
	(table) => ({
		ownerNumberIdx: uniqueIndex("project_v2_owner_number_idx").on(
			table.ownerId,
			table.number,
		),
	}),
);

/** A project's fields: the built-in `Status` plus the custom ones. */
export const projectV2Fields = pgTable(
	"project_v2_fields",
	{
		id: serial("id").primaryKey(),
		projectId: integer("project_id")
			.notNull()
			.references(() => projectV2.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		dataType: text("data_type")
			.$type<"TEXT" | "NUMBER" | "DATE" | "SINGLE_SELECT">()
			.notNull(),
		position: integer("position").notNull(),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
		updatedAt: timestamptz("updated_at").notNull().defaultNow(),
	},
	(table) => ({
		projectNameIdx: uniqueIndex("project_v2_field_name_idx").on(
			table.projectId,
			sql`lower(${table.name})`,
		),
	}),
);

export const projectV2SingleSelectOptions = pgTable(
	"project_v2_single_select_options",
	{
		id: serial("id").primaryKey(),
		fieldId: integer("field_id")
			.notNull()
			.references(() => projectV2Fields.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		color: text("color").notNull(),
		position: integer("position").notNull(),
	},
	(table) => ({
		fieldNameIdx: uniqueIndex("project_v2_option_name_idx").on(
			table.fieldId,
			sql`lower(${table.name})`,
		),
	}),
);

/**
 * An item's content is either an issue or pull request (`issueId`) or draft
 * text; the check keeps exactly one set.
 */
export const projectV2Items = pgTable(
	"project_v2_items",
	{
		id: serial("id").primaryKey(),
		projectId: integer("project_id")
			.notNull()
			.references(() => projectV2.id, { onDelete: "cascade" }),
		issueId: integer("issue_id").references(() => issues.id, {
			onDelete: "cascade",
		}),
		draftTitle: text("draft_title"),
		draftBody: text("draft_body"),
		archived: boolean("archived").notNull().default(false),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
		updatedAt: timestamptz("updated_at").notNull().defaultNow(),
	},
	(table) => ({
		projectIssueIdx: uniqueIndex("project_v2_item_issue_idx").on(
			table.projectId,
			table.issueId,
		),
		projectCreatedIdx: index("project_v2_item_created_idx").on(
			table.projectId,
			table.createdAt,
		),
		oneContent: check(
			"project_v2_item_content",
			sql`(${table.issueId} is null) <> (${table.draftTitle} is null)`,
		),
	}),
);

/** One value per item and field; the store sets the column matching the field's type. */
export const projectV2ItemFieldValues = pgTable(
	"project_v2_item_field_values",
	{
		id: serial("id").primaryKey(),
		itemId: integer("item_id")
			.notNull()
			.references(() => projectV2Items.id, { onDelete: "cascade" }),
		fieldId: integer("field_id")
			.notNull()
			.references(() => projectV2Fields.id, { onDelete: "cascade" }),
		valueText: text("value_text"),
		valueNumber: doublePrecision("value_number"),
		valueDate: date("value_date", { mode: "string" }),
		optionId: integer("option_id").references(
			() => projectV2SingleSelectOptions.id,
			{ onDelete: "cascade" },
		),
		updatedAt: timestamptz("updated_at").notNull().defaultNow(),
	},
	(table) => ({
		itemFieldIdx: uniqueIndex("project_v2_value_item_field_idx").on(
			table.itemId,
			table.fieldId,
		),
	}),
);
