import { relations } from "drizzle-orm";
import {
	bigint,
	index,
	integer,
	jsonb,
	pgTable,
	serial,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { user } from "./schema";

// Repositories table - stores repository metadata
// NOTE: Git operations (commits, branches, files) are now handled by actual git repositories on filesystem
// This table only stores metadata for discovery and permissions
export const repositories = pgTable(
	"repositories",
	{
		id: serial("id").primaryKey(),
		ownerId: text("owner_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		description: text("description"),
		visibility: text("visibility").notNull().default("public"), // 'public' | 'private'
		defaultBranch: text("default_branch").notNull().default("main"),
		gitPath: text("git_path"), // Filesystem path to bare git repository
		diskUsage: bigint("disk_usage", { mode: "number" }), // Repository size in bytes
		lastBackupAt: timestamp("last_backup_at"), // Last R2 backup timestamp
		backupR2Key: text("backup_r2_key"), // R2 key for latest backup
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
	},
	(table) => ({
		ownerIdx: index("repo_owner_idx").on(table.ownerId),
		nameIdx: index("repo_name_idx").on(table.name),
		ownerNameIdx: index("repo_owner_name_idx").on(table.ownerId, table.name),
	}),
);

// REMOVED: branches table - git refs handle branches
// REMOVED: commits table - git objects handle commits
// REMOVED: repositoryFiles table - git tree/blob objects handle files
// All git operations now use nodegit to interact with real git repositories

// Issues table - stores repository issues
export const issues = pgTable(
	"issues",
	{
		id: serial("id").primaryKey(),
		repoId: integer("repo_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		authorId: text("author_id")
			.notNull()
			.references(() => user.id),
		title: text("title").notNull(),
		body: text("body"),
		status: text("status").notNull().default("open"), // 'open' | 'closed'
		labels: jsonb("labels"), // Array of label strings
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
		closedAt: timestamp("closed_at"),
	},
	(table) => ({
		repoIdx: index("issue_repo_idx").on(table.repoId),
		statusIdx: index("issue_status_idx").on(table.status),
	}),
);

// Pull requests table - stores pull requests
// NOTE: sourceBranch and targetBranch are now text (branch names) instead of foreign keys
export const pullRequests = pgTable(
	"pull_requests",
	{
		id: serial("id").primaryKey(),
		repoId: integer("repo_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		authorId: text("author_id")
			.notNull()
			.references(() => user.id),
		title: text("title").notNull(),
		body: text("body"),
		sourceBranch: text("source_branch").notNull(), // Branch name (e.g., 'feature/new-feature')
		targetBranch: text("target_branch").notNull(), // Branch name (e.g., 'main')
		status: text("status").notNull().default("open"), // 'open' | 'closed' | 'merged'
		mergedAt: timestamp("merged_at"),
		mergedBy: text("merged_by").references(() => user.id),
		mergeCommitSha: text("merge_commit_sha"), // SHA of merge commit when merged
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
	},
	(table) => ({
		repoIdx: index("pr_repo_idx").on(table.repoId),
		statusIdx: index("pr_status_idx").on(table.status),
	}),
);

// Comments table - stores comments on issues and PRs
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

// Stars table - stores repository stars
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
		repoIdx: index("star_repo_idx").on(table.repoId),
		userIdx: index("star_user_idx").on(table.userId),
	}),
);

// Repository collaborators table - stores access control
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
		role: text("role").notNull().default("read"), // 'read' | 'write' | 'admin'
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(table) => ({
		repoIdx: index("collab_repo_idx").on(table.repoId),
		userIdx: index("collab_user_idx").on(table.userId),
		repoUserIdx: index("collab_repo_user_idx").on(table.repoId, table.userId),
	}),
);

// Activity feed table - stores user activity
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
		type: text("type").notNull(), // 'commit' | 'issue' | 'pr' | 'star' | 'fork' | 'comment'
		metadata: jsonb("metadata"), // Additional data specific to activity type
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(table) => ({
		userIdx: index("activity_user_idx").on(table.userId),
		repoIdx: index("activity_repo_idx").on(table.repoId),
		typeIdx: index("activity_type_idx").on(table.type),
	}),
);

// Relations
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
	author: one(user, {
		fields: [issues.authorId],
		references: [user.id],
	}),
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
	issue: one(issues, {
		fields: [comments.issueId],
		references: [issues.id],
	}),
	pullRequest: one(pullRequests, {
		fields: [comments.pullRequestId],
		references: [pullRequests.id],
	}),
	author: one(user, {
		fields: [comments.authorId],
		references: [user.id],
	}),
}));

export const starsRelations = relations(stars, ({ one }) => ({
	repository: one(repositories, {
		fields: [stars.repoId],
		references: [repositories.id],
	}),
	user: one(user, {
		fields: [stars.userId],
		references: [user.id],
	}),
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
	user: one(user, {
		fields: [activities.userId],
		references: [user.id],
	}),
	repository: one(repositories, {
		fields: [activities.repoId],
		references: [repositories.id],
	}),
}));

// Personal Access Tokens table - stores PATs for programmatic git access
export const tokens = pgTable(
	"tokens",
	{
		id: serial("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		name: text("name").notNull(), // User-friendly name for the token
		tokenHash: text("token_hash").notNull().unique(), // SHA-256 hash of the token
		scopes: jsonb("scopes").notNull(), // Array of permission scopes (e.g., ['repo:read', 'repo:write'])
		lastUsedAt: timestamp("last_used_at"),
		expiresAt: timestamp("expires_at"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(table) => ({
		userIdx: index("token_user_idx").on(table.userId),
		hashIdx: index("token_hash_idx").on(table.tokenHash),
	}),
);

// Git transactions table - tracks pending/abandoned transactions for cleanup
export const gitTransactions = pgTable(
	"git_transactions",
	{
		id: text("id").primaryKey(), // Transaction ID (e.g., 'txn_1234567890_abc123')
		status: text("status").notNull().default("pending"), // 'pending' | 'committed' | 'rolled_back'
		objectKeys: jsonb("object_keys").notNull(), // Array of R2 keys written in this transaction
		metadata: jsonb("metadata"), // Additional transaction metadata
		createdAt: timestamp("created_at").notNull().defaultNow(),
		completedAt: timestamp("completed_at"),
	},
	(table) => ({
		statusIdx: index("git_txn_status_idx").on(table.status),
		createdIdx: index("git_txn_created_idx").on(table.createdAt),
	}),
);

// Token relations
export const tokensRelations = relations(tokens, ({ one }) => ({
	user: one(user, {
		fields: [tokens.userId],
		references: [user.id],
	}),
}));
