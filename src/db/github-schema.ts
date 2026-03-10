import { pgTable, serial, text, timestamp, integer, boolean, jsonb, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { user } from './schema';

// Repositories table - stores repository metadata
export const repositories = pgTable('repositories', {
  id: serial('id').primaryKey(),
  ownerId: text('owner_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  visibility: text('visibility').notNull().default('public'), // 'public' | 'private'
  defaultBranch: text('default_branch').notNull().default('main'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  ownerIdx: index('repo_owner_idx').on(table.ownerId),
  nameIdx: index('repo_name_idx').on(table.name),
}));

// Branches table - stores git branches
export const branches = pgTable('branches', {
  id: serial('id').primaryKey(),
  repoId: integer('repo_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  lastCommitId: integer('last_commit_id'),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  repoIdx: index('branch_repo_idx').on(table.repoId),
}));

// Commits table - stores commit metadata
export const commits = pgTable('commits', {
  id: serial('id').primaryKey(),
  repoId: integer('repo_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),
  branchId: integer('branch_id').notNull().references(() => branches.id, { onDelete: 'cascade' }),
  authorId: text('author_id').notNull().references(() => user.id),
  message: text('message').notNull(),
  filesChanged: jsonb('files_changed').notNull(), // Array of { path, action: 'added'|'modified'|'deleted', r2Key }
  parentCommitId: integer('parent_commit_id'), // Self-reference for commit history
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  repoIdx: index('commit_repo_idx').on(table.repoId),
  branchIdx: index('commit_branch_idx').on(table.branchId),
  authorIdx: index('commit_author_idx').on(table.authorId),
}));

// Repository files table - stores file metadata (actual content in R2)
export const repositoryFiles = pgTable('repository_files', {
  id: serial('id').primaryKey(),
  repoId: integer('repo_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),
  branchId: integer('branch_id').notNull().references(() => branches.id, { onDelete: 'cascade' }),
  path: text('path').notNull(), // Full file path e.g., 'src/index.ts'
  r2Key: text('r2_key').notNull(), // Key in R2 bucket
  size: integer('size').notNull(), // File size in bytes
  type: text('type').notNull().default('file'), // 'file' | 'directory'
  lastCommitId: integer('last_commit_id').references(() => commits.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  repoIdx: index('file_repo_idx').on(table.repoId),
  branchIdx: index('file_branch_idx').on(table.branchId),
  pathIdx: index('file_path_idx').on(table.path),
}));

// Issues table - stores repository issues
export const issues = pgTable('issues', {
  id: serial('id').primaryKey(),
  repoId: integer('repo_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),
  authorId: text('author_id').notNull().references(() => user.id),
  title: text('title').notNull(),
  body: text('body'),
  status: text('status').notNull().default('open'), // 'open' | 'closed'
  labels: jsonb('labels'), // Array of label strings
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  closedAt: timestamp('closed_at'),
}, (table) => ({
  repoIdx: index('issue_repo_idx').on(table.repoId),
  statusIdx: index('issue_status_idx').on(table.status),
}));

// Pull requests table - stores pull requests
export const pullRequests = pgTable('pull_requests', {
  id: serial('id').primaryKey(),
  repoId: integer('repo_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),
  authorId: text('author_id').notNull().references(() => user.id),
  title: text('title').notNull(),
  body: text('body'),
  sourceBranchId: integer('source_branch_id').notNull().references(() => branches.id),
  targetBranchId: integer('target_branch_id').notNull().references(() => branches.id),
  status: text('status').notNull().default('open'), // 'open' | 'closed' | 'merged'
  mergedAt: timestamp('merged_at'),
  mergedBy: text('merged_by').references(() => user.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  repoIdx: index('pr_repo_idx').on(table.repoId),
  statusIdx: index('pr_status_idx').on(table.status),
}));

// Comments table - stores comments on issues and PRs
export const comments = pgTable('comments', {
  id: serial('id').primaryKey(),
  repoId: integer('repo_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),
  issueId: integer('issue_id').references(() => issues.id, { onDelete: 'cascade' }),
  pullRequestId: integer('pull_request_id').references(() => pullRequests.id, { onDelete: 'cascade' }),
  authorId: text('author_id').notNull().references(() => user.id),
  body: text('body').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  issueIdx: index('comment_issue_idx').on(table.issueId),
  prIdx: index('comment_pr_idx').on(table.pullRequestId),
}));

// Stars table - stores repository stars
export const stars = pgTable('stars', {
  id: serial('id').primaryKey(),
  repoId: integer('repo_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  repoIdx: index('star_repo_idx').on(table.repoId),
  userIdx: index('star_user_idx').on(table.userId),
}));

// Repository collaborators table - stores access control
export const repositoryCollaborators = pgTable('repository_collaborators', {
  id: serial('id').primaryKey(),
  repoId: integer('repo_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('read'), // 'read' | 'write' | 'admin'
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  repoIdx: index('collab_repo_idx').on(table.repoId),
  userIdx: index('collab_user_idx').on(table.userId),
}));

// Activity feed table - stores user activity
export const activities = pgTable('activities', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  repoId: integer('repo_id').references(() => repositories.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // 'commit' | 'issue' | 'pr' | 'star' | 'fork' | 'comment'
  metadata: jsonb('metadata'), // Additional data specific to activity type
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  userIdx: index('activity_user_idx').on(table.userId),
  repoIdx: index('activity_repo_idx').on(table.repoId),
  typeIdx: index('activity_type_idx').on(table.type),
}));

// Relations
export const repositoriesRelations = relations(repositories, ({ one, many }) => ({
  owner: one(user, {
    fields: [repositories.ownerId],
    references: [user.id],
  }),
  branches: many(branches),
  commits: many(commits),
  files: many(repositoryFiles),
  issues: many(issues),
  pullRequests: many(pullRequests),
  stars: many(stars),
  collaborators: many(repositoryCollaborators),
  activities: many(activities),
}));

export const branchesRelations = relations(branches, ({ one, many }) => ({
  repository: one(repositories, {
    fields: [branches.repoId],
    references: [repositories.id],
  }),
  commits: many(commits),
  files: many(repositoryFiles),
}));

export const commitsRelations = relations(commits, ({ one }) => ({
  repository: one(repositories, {
    fields: [commits.repoId],
    references: [repositories.id],
  }),
  branch: one(branches, {
    fields: [commits.branchId],
    references: [branches.id],
  }),
  author: one(user, {
    fields: [commits.authorId],
    references: [user.id],
  }),
}));

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

export const pullRequestsRelations = relations(pullRequests, ({ one, many }) => ({
  repository: one(repositories, {
    fields: [pullRequests.repoId],
    references: [repositories.id],
  }),
  author: one(user, {
    fields: [pullRequests.authorId],
    references: [user.id],
  }),
  sourceBranch: one(branches, {
    fields: [pullRequests.sourceBranchId],
    references: [branches.id],
    relationName: 'sourceBranch',
  }),
  targetBranch: one(branches, {
    fields: [pullRequests.targetBranchId],
    references: [branches.id],
    relationName: 'targetBranch',
  }),
  comments: many(comments),
}));

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

export const repositoryCollaboratorsRelations = relations(repositoryCollaborators, ({ one }) => ({
  repository: one(repositories, {
    fields: [repositoryCollaborators.repoId],
    references: [repositories.id],
  }),
  user: one(user, {
    fields: [repositoryCollaborators.userId],
    references: [user.id],
  }),
}));

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
