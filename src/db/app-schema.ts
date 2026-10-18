import { relations } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	serial,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import type { ActivityMetadata, ActivityType } from "#/lib/activity-types";
import type { TokenScope } from "#/lib/token-scopes";
import { user } from "./schema";

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
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
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
		labels: jsonb("labels").$type<string[]>().notNull().default([]),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
		closedAt: timestamp("closed_at"),
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
		mergedAt: timestamp("merged_at"),
		mergedBy: text("merged_by").references(() => user.id),
		mergeCommitSha: text("merge_commit_sha"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
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
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
	},
	(table) => ({
		issueIdx: index("comment_issue_idx").on(table.issueId),
		prIdx: index("comment_pr_idx").on(table.pullRequestId),
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
		createdAt: timestamp("created_at").notNull().defaultNow(),
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
		createdAt: timestamp("created_at").notNull().defaultNow(),
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
		createdAt: timestamp("created_at").notNull().defaultNow(),
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
		lastUsedAt: timestamp("last_used_at"),
		expiresAt: timestamp("expires_at"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
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
	expiresAt: timestamp("expires_at").notNull(),
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
		windowStartedAt: timestamp("window_started_at").notNull(),
	},
	(table) => ({
		// Supports the periodic expiry prune; without it every prune is a scan.
		windowIdx: index("rate_limit_window_idx").on(table.windowStartedAt),
	}),
);

export type Repository = typeof repositories.$inferSelect;
export type Issue = typeof issues.$inferSelect;
export type PullRequest = typeof pullRequests.$inferSelect;
export type CollaboratorRole =
	(typeof repositoryCollaborators.$inferSelect)["role"];

export const repositoriesRelations = relations(
	repositories,
	({ one, many }) => ({
		owner: one(user, {
			fields: [repositories.ownerId],
			references: [user.id],
		}),
		issues: many(issues),
		pullRequests: many(pullRequests),
		stars: many(stars),
		collaborators: many(repositoryCollaborators),
		activities: many(activities),
	}),
);

export const issuesRelations = relations(issues, ({ one, many }) => ({
	repository: one(repositories, {
		fields: [issues.repoId],
		references: [repositories.id],
	}),
	author: one(user, { fields: [issues.authorId], references: [user.id] }),
	comments: many(comments),
}));

export const pullRequestsRelations = relations(
	pullRequests,
	({ one, many }) => ({
		repository: one(repositories, {
			fields: [pullRequests.repoId],
			references: [repositories.id],
		}),
		author: one(user, {
			fields: [pullRequests.authorId],
			references: [user.id],
		}),
		comments: many(comments),
	}),
);

export const commentsRelations = relations(comments, ({ one }) => ({
	repository: one(repositories, {
		fields: [comments.repoId],
		references: [repositories.id],
	}),
	issue: one(issues, { fields: [comments.issueId], references: [issues.id] }),
	pullRequest: one(pullRequests, {
		fields: [comments.pullRequestId],
		references: [pullRequests.id],
	}),
	author: one(user, { fields: [comments.authorId], references: [user.id] }),
}));

export const starsRelations = relations(stars, ({ one }) => ({
	repository: one(repositories, {
		fields: [stars.repoId],
		references: [repositories.id],
	}),
	user: one(user, { fields: [stars.userId], references: [user.id] }),
}));

export const repositoryCollaboratorsRelations = relations(
	repositoryCollaborators,
	({ one }) => ({
		repository: one(repositories, {
			fields: [repositoryCollaborators.repoId],
			references: [repositories.id],
		}),
		user: one(user, {
			fields: [repositoryCollaborators.userId],
			references: [user.id],
		}),
	}),
);

export const activitiesRelations = relations(activities, ({ one }) => ({
	user: one(user, { fields: [activities.userId], references: [user.id] }),
	repository: one(repositories, {
		fields: [activities.repoId],
		references: [repositories.id],
	}),
}));

export const tokensRelations = relations(tokens, ({ one }) => ({
	user: one(user, { fields: [tokens.userId], references: [user.id] }),
}));
