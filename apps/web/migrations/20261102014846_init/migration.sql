CREATE TABLE `account` (
	`id` text PRIMARY KEY,
	`accountId` text NOT NULL,
	`providerId` text NOT NULL,
	`userId` text NOT NULL,
	`accessToken` text,
	`refreshToken` text,
	`idToken` text,
	`accessTokenExpiresAt` integer,
	`refreshTokenExpiresAt` integer,
	`scope` text,
	`password` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	CONSTRAINT `fk_account_userId_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY,
	`expiresAt` integer NOT NULL,
	`token` text NOT NULL UNIQUE,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`ipAddress` text,
	`userAgent` text,
	`userId` text NOT NULL,
	CONSTRAINT `fk_session_userId_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`email` text NOT NULL UNIQUE,
	`emailVerified` integer NOT NULL,
	`image` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`username` text NOT NULL UNIQUE,
	`displayUsername` text,
	`apiId` integer DEFAULT 0 NOT NULL UNIQUE
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer,
	`updatedAt` integer
);
--> statement-breakpoint
CREATE TABLE `activities` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`user_id` text NOT NULL,
	`repo_id` integer,
	`type` text NOT NULL,
	`metadata` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `fk_activities_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_activities_repo_id_repositories_id_fk` FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `check_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`repo_id` integer NOT NULL,
	`suite_id` integer NOT NULL,
	`head_sha` text NOT NULL,
	`name` text NOT NULL,
	`external_id` text,
	`details_url` text,
	`status` text NOT NULL,
	`conclusion` text,
	`started_at` integer,
	`completed_at` integer,
	`output_title` text,
	`output_summary` text,
	`output_text` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `fk_check_runs_repo_id_repositories_id_fk` FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_check_runs_suite_id_check_suites_id_fk` FOREIGN KEY (`suite_id`) REFERENCES `check_suites`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `check_suites` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`repo_id` integer NOT NULL,
	`head_sha` text NOT NULL,
	`head_branch` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `fk_check_suites_repo_id_repositories_id_fk` FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`repo_id` integer NOT NULL,
	`issue_id` integer NOT NULL,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`edited_at` integer,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `fk_comments_repo_id_repositories_id_fk` FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_comments_issue_id_issues_id_fk` FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_comments_author_id_user_id_fk` FOREIGN KEY (`author_id`) REFERENCES `user`(`id`)
);
--> statement-breakpoint
CREATE TABLE `commit_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`repo_id` integer NOT NULL,
	`commit_sha` text NOT NULL,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`path` text,
	`position` integer,
	`line` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`edited_at` integer,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `fk_commit_comments_repo_id_repositories_id_fk` FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_commit_comments_author_id_user_id_fk` FOREIGN KEY (`author_id`) REFERENCES `user`(`id`)
);
--> statement-breakpoint
CREATE TABLE `commit_statuses` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`repo_id` integer NOT NULL,
	`sha` text NOT NULL,
	`context` text NOT NULL,
	`state` text NOT NULL,
	`target_url` text,
	`description` text,
	`creator_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `fk_commit_statuses_repo_id_repositories_id_fk` FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_commit_statuses_creator_id_user_id_fk` FOREIGN KEY (`creator_id`) REFERENCES `user`(`id`)
);
--> statement-breakpoint
CREATE TABLE `device_codes` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`device_code_hash` text NOT NULL UNIQUE,
	`user_code` text NOT NULL UNIQUE,
	`client_id` text NOT NULL,
	`scopes` text NOT NULL,
	`status` text NOT NULL,
	`user_id` text,
	`interval` integer NOT NULL,
	`last_polled_at` integer,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `fk_device_codes_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `follows` (
	`follower_id` text NOT NULL,
	`followee_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `follows_pk` PRIMARY KEY(`follower_id`, `followee_id`),
	CONSTRAINT `fk_follows_follower_id_user_id_fk` FOREIGN KEY (`follower_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_follows_followee_id_user_id_fk` FOREIGN KEY (`followee_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT "follow_not_self" CHECK("follower_id" <> "followee_id")
);
--> statement-breakpoint
CREATE TABLE `issues` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`repo_id` integer NOT NULL,
	`number` integer NOT NULL,
	`is_pull_request` integer DEFAULT false NOT NULL,
	`author_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`edited_at` integer,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`closed_at` integer,
	`closed_by_id` text,
	`state_reason` text,
	`milestone_id` integer,
	CONSTRAINT `fk_issues_repo_id_repositories_id_fk` FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_issues_author_id_user_id_fk` FOREIGN KEY (`author_id`) REFERENCES `user`(`id`),
	CONSTRAINT `fk_issues_closed_by_id_user_id_fk` FOREIGN KEY (`closed_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_issues_milestone_id_milestones_id_fk` FOREIGN KEY (`milestone_id`) REFERENCES `milestones`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `labels` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`repo_id` integer NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`description` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `fk_labels_repo_id_repositories_id_fk` FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `milestones` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`repo_id` integer NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`state` text DEFAULT 'open' NOT NULL,
	`due_on` integer,
	`creator_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`closed_at` integer,
	CONSTRAINT `fk_milestones_repo_id_repositories_id_fk` FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_milestones_creator_id_user_id_fk` FOREIGN KEY (`creator_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`user_id` text NOT NULL,
	`repo_id` integer NOT NULL,
	`issue_id` integer NOT NULL,
	`reason` text NOT NULL,
	`unread` integer DEFAULT true NOT NULL,
	`last_read_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `fk_notifications_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_notifications_repo_id_repositories_id_fk` FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_notifications_issue_id_issues_id_fk` FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `oauth_apps` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`callback_url` text NOT NULL,
	`client_id` text NOT NULL UNIQUE,
	`client_secret_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `fk_oauth_apps_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `oauth_codes` (
	`code_hash` text PRIMARY KEY,
	`app_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`scopes` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `fk_oauth_codes_app_id_oauth_apps_id_fk` FOREIGN KEY (`app_id`) REFERENCES `oauth_apps`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_oauth_codes_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `pull_request_review_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`repo_id` integer NOT NULL,
	`pull_request_id` integer NOT NULL,
	`review_id` integer NOT NULL,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`path` text NOT NULL,
	`side` text DEFAULT 'RIGHT' NOT NULL,
	`line` integer NOT NULL,
	`commit_sha` text,
	`in_reply_to_id` integer,
	`resolved_at` integer,
	`resolved_by_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `fk_pull_request_review_comments_repo_id_repositories_id_fk` FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_pull_request_review_comments_pull_request_id_pull_requests_issue_id_fk` FOREIGN KEY (`pull_request_id`) REFERENCES `pull_requests`(`issue_id`) ON DELETE CASCADE,
	CONSTRAINT `fk_pull_request_review_comments_review_id_pull_request_reviews_id_fk` FOREIGN KEY (`review_id`) REFERENCES `pull_request_reviews`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_pull_request_review_comments_author_id_user_id_fk` FOREIGN KEY (`author_id`) REFERENCES `user`(`id`),
	CONSTRAINT `fk_pull_request_review_comments_in_reply_to_id_pull_request_review_comments_id_fk` FOREIGN KEY (`in_reply_to_id`) REFERENCES `pull_request_review_comments`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_pull_request_review_comments_resolved_by_id_user_id_fk` FOREIGN KEY (`resolved_by_id`) REFERENCES `user`(`id`)
);
--> statement-breakpoint
CREATE TABLE `pull_request_review_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`issue_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`requester_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `fk_pull_request_review_requests_issue_id_issues_id_fk` FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_pull_request_review_requests_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_pull_request_review_requests_requester_id_user_id_fk` FOREIGN KEY (`requester_id`) REFERENCES `user`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `pull_request_reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`repo_id` integer NOT NULL,
	`pull_request_id` integer NOT NULL,
	`author_id` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`body` text,
	`commit_sha` text,
	`submitted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `fk_pull_request_reviews_repo_id_repositories_id_fk` FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_pull_request_reviews_pull_request_id_pull_requests_issue_id_fk` FOREIGN KEY (`pull_request_id`) REFERENCES `pull_requests`(`issue_id`) ON DELETE CASCADE,
	CONSTRAINT `fk_pull_request_reviews_author_id_user_id_fk` FOREIGN KEY (`author_id`) REFERENCES `user`(`id`)
);
--> statement-breakpoint
CREATE TABLE `pull_requests` (
	`issue_id` integer PRIMARY KEY,
	`source_branch` text NOT NULL,
	`target_branch` text NOT NULL,
	`merged_at` integer,
	`merged_by` text,
	`merge_commit_sha` text,
	`is_draft` integer DEFAULT false NOT NULL,
	`base_sha` text,
	`head_sha` text,
	CONSTRAINT `fk_pull_requests_issue_id_issues_id_fk` FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_pull_requests_merged_by_user_id_fk` FOREIGN KEY (`merged_by`) REFERENCES `user`(`id`)
);
--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY,
	`count` integer NOT NULL,
	`window_started_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`issue_id` integer NOT NULL,
	`comment_id` integer,
	`user_id` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `fk_reactions_issue_id_issues_id_fk` FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_reactions_comment_id_comments_id_fk` FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_reactions_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `release_assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`release_id` integer NOT NULL,
	`name` text NOT NULL,
	`label` text,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`state` text NOT NULL,
	`download_count` integer DEFAULT 0 NOT NULL,
	`uploader_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `fk_release_assets_release_id_releases_id_fk` FOREIGN KEY (`release_id`) REFERENCES `releases`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_release_assets_uploader_id_user_id_fk` FOREIGN KEY (`uploader_id`) REFERENCES `user`(`id`)
);
--> statement-breakpoint
CREATE TABLE `releases` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`repo_id` integer NOT NULL,
	`tag_name` text NOT NULL,
	`target_commitish` text NOT NULL,
	`name` text,
	`body` text,
	`draft` integer DEFAULT false NOT NULL,
	`prerelease` integer DEFAULT false NOT NULL,
	`make_latest` text DEFAULT 'legacy' NOT NULL,
	`author_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`published_at` integer,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `fk_releases_repo_id_repositories_id_fk` FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_releases_author_id_user_id_fk` FOREIGN KEY (`author_id`) REFERENCES `user`(`id`)
);
--> statement-breakpoint
CREATE TABLE `repo_locks` (
	`repo_key` text PRIMARY KEY,
	`holder` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `repositories` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`visibility` text DEFAULT 'public' NOT NULL,
	`default_branch` text DEFAULT 'main' NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`homepage` text,
	`topics` text DEFAULT '[]' NOT NULL,
	`is_template` integer DEFAULT false NOT NULL,
	`fork_of_id` integer,
	`is_fork` integer DEFAULT false NOT NULL,
	`has_issues` integer DEFAULT true NOT NULL,
	`has_wiki` integer DEFAULT false NOT NULL,
	`has_projects` integer DEFAULT false NOT NULL,
	`allow_merge_commit` integer DEFAULT true NOT NULL,
	`allow_squash_merge` integer DEFAULT true NOT NULL,
	`allow_rebase_merge` integer DEFAULT true NOT NULL,
	`show_last_commit_column` integer DEFAULT false NOT NULL,
	`auto_refresh_pr_diffs` integer DEFAULT false NOT NULL,
	`next_issue_number` integer DEFAULT 1 NOT NULL,
	`next_milestone_number` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `fk_repositories_owner_id_user_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_repositories_fork_of_id_repositories_id_fk` FOREIGN KEY (`fork_of_id`) REFERENCES `repositories`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `repository_collaborators` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`repo_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'read' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `fk_repository_collaborators_repo_id_repositories_id_fk` FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_repository_collaborators_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `repository_subscriptions` (
	`repo_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`ignored` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `repository_subscriptions_pk` PRIMARY KEY(`repo_id`, `user_id`),
	CONSTRAINT `fk_repository_subscriptions_repo_id_repositories_id_fk` FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_repository_subscriptions_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `stars` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`repo_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `fk_stars_repo_id_repositories_id_fk` FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_stars_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `thread_assignees` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`issue_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `fk_thread_assignees_issue_id_issues_id_fk` FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_thread_assignees_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `thread_labels` (
	`issue_id` integer NOT NULL,
	`label_id` integer NOT NULL,
	CONSTRAINT `thread_labels_pk` PRIMARY KEY(`issue_id`, `label_id`),
	CONSTRAINT `fk_thread_labels_issue_id_issues_id_fk` FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_thread_labels_label_id_labels_id_fk` FOREIGN KEY (`label_id`) REFERENCES `labels`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `thread_subscriptions` (
	`issue_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`subscribed` integer DEFAULT true NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `thread_subscriptions_pk` PRIMARY KEY(`issue_id`, `user_id`),
	CONSTRAINT `fk_thread_subscriptions_issue_id_issues_id_fk` FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_thread_subscriptions_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `timeline_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`issue_id` integer NOT NULL,
	`actor_id` text NOT NULL,
	`event` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`source_issue_id` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `fk_timeline_events_issue_id_issues_id_fk` FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_timeline_events_actor_id_user_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_timeline_events_source_issue_id_issues_id_fk` FOREIGN KEY (`source_issue_id`) REFERENCES `issues`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL UNIQUE,
	`scopes` text NOT NULL,
	`last_used_at` integer,
	`expires_at` integer,
	`oauth_app_id` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `fk_tokens_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_tokens_oauth_app_id_oauth_apps_id_fk` FOREIGN KEY (`oauth_app_id`) REFERENCES `oauth_apps`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `account_user_idx` ON `account` (`userId`);--> statement-breakpoint
CREATE INDEX `session_user_idx` ON `session` (`userId`);--> statement-breakpoint
CREATE INDEX `activity_user_created_idx` ON `activities` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activity_repo_created_idx` ON `activities` (`repo_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `check_run_repo_sha_idx` ON `check_runs` (`repo_id`,`head_sha`,`id`);--> statement-breakpoint
CREATE INDEX `check_run_suite_idx` ON `check_runs` (`suite_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `check_suite_repo_sha_idx` ON `check_suites` (`repo_id`,`head_sha`);--> statement-breakpoint
CREATE INDEX `comment_issue_created_idx` ON `comments` (`issue_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `commit_comment_repo_commit_idx` ON `commit_comments` (`repo_id`,`commit_sha`,`created_at`);--> statement-breakpoint
CREATE INDEX `commit_comment_repo_created_idx` ON `commit_comments` (`repo_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `commit_status_repo_sha_context_idx` ON `commit_statuses` (`repo_id`,`sha`,`context`,`id`);--> statement-breakpoint
CREATE INDEX `device_code_expires_idx` ON `device_codes` (`expires_at`);--> statement-breakpoint
CREATE INDEX `follow_followee_idx` ON `follows` (`followee_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `issue_milestone_idx` ON `issues` (`milestone_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `issue_repo_number_idx` ON `issues` (`repo_id`,`number`);--> statement-breakpoint
CREATE INDEX `issue_repo_state_created_idx` ON `issues` (`repo_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `issue_repo_state_updated_idx` ON `issues` (`repo_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `issue_repo_kind_state_created_idx` ON `issues` (`repo_id`,`is_pull_request`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `issue_repo_kind_state_updated_idx` ON `issues` (`repo_id`,`is_pull_request`,`status`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `label_repo_name_idx` ON `labels` (`repo_id`,lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX `milestone_repo_number_idx` ON `milestones` (`repo_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `milestone_repo_title_idx` ON `milestones` (`repo_id`,lower("title"));--> statement-breakpoint
CREATE UNIQUE INDEX `notification_user_issue_idx` ON `notifications` (`user_id`,`issue_id`);--> statement-breakpoint
CREATE INDEX `notification_user_updated_idx` ON `notifications` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `notification_user_unread_idx` ON `notifications` (`user_id`,`updated_at`) WHERE "notifications"."unread" = 1;--> statement-breakpoint
CREATE INDEX `notification_issue_idx` ON `notifications` (`issue_id`);--> statement-breakpoint
CREATE INDEX `oauth_app_user_idx` ON `oauth_apps` (`user_id`);--> statement-breakpoint
CREATE INDEX `oauth_code_expires_idx` ON `oauth_codes` (`expires_at`);--> statement-breakpoint
CREATE INDEX `review_comment_pr_created_idx` ON `pull_request_review_comments` (`pull_request_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `review_comment_review_idx` ON `pull_request_review_comments` (`review_id`);--> statement-breakpoint
CREATE INDEX `review_comment_reply_idx` ON `pull_request_review_comments` (`in_reply_to_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `review_request_issue_user_idx` ON `pull_request_review_requests` (`issue_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `review_request_user_idx` ON `pull_request_review_requests` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `review_pending_idx` ON `pull_request_reviews` (`repo_id`,`pull_request_id`,`author_id`) WHERE "pull_request_reviews"."state" = 'pending';--> statement-breakpoint
CREATE INDEX `review_pr_created_idx` ON `pull_request_reviews` (`pull_request_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `review_author_idx` ON `pull_request_reviews` (`author_id`);--> statement-breakpoint
CREATE INDEX `pr_branches_idx` ON `pull_requests` (`source_branch`,`target_branch`);--> statement-breakpoint
CREATE INDEX `rate_limit_window_idx` ON `rate_limits` (`window_started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `reaction_issue_user_content_idx` ON `reactions` (`issue_id`,`user_id`,`content`) WHERE "reactions"."comment_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `reaction_comment_user_content_idx` ON `reactions` (`comment_id`,`user_id`,`content`) WHERE "reactions"."comment_id" is not null;--> statement-breakpoint
CREATE INDEX `reaction_user_idx` ON `reactions` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `release_asset_release_name_idx` ON `release_assets` (`release_id`,`name`);--> statement-breakpoint
CREATE INDEX `release_repo_created_idx` ON `releases` (`repo_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `release_published_tag_idx` ON `releases` (`repo_id`,`tag_name`) WHERE "releases"."draft" = 0;--> statement-breakpoint
CREATE UNIQUE INDEX `repo_owner_name_idx` ON `repositories` (`owner_id`,`name`);--> statement-breakpoint
CREATE INDEX `repo_name_idx` ON `repositories` (`name`);--> statement-breakpoint
CREATE INDEX `repo_visibility_idx` ON `repositories` (`visibility`);--> statement-breakpoint
CREATE INDEX `repo_fork_of_idx` ON `repositories` (`fork_of_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `collab_repo_user_idx` ON `repository_collaborators` (`repo_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `collab_user_idx` ON `repository_collaborators` (`user_id`);--> statement-breakpoint
CREATE INDEX `repository_subscription_user_idx` ON `repository_subscriptions` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `star_repo_user_idx` ON `stars` (`repo_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `star_user_idx` ON `stars` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `thread_assignee_issue_user_idx` ON `thread_assignees` (`issue_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `thread_assignee_user_idx` ON `thread_assignees` (`user_id`);--> statement-breakpoint
CREATE INDEX `thread_label_label_idx` ON `thread_labels` (`label_id`);--> statement-breakpoint
CREATE INDEX `thread_subscription_user_idx` ON `thread_subscriptions` (`user_id`);--> statement-breakpoint
CREATE INDEX `timeline_issue_idx` ON `timeline_events` (`issue_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `timeline_cross_reference_idx` ON `timeline_events` (`issue_id`,`source_issue_id`) WHERE "timeline_events"."event" = 'cross-referenced';--> statement-breakpoint
CREATE INDEX `token_user_idx` ON `tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `token_oauth_app_idx` ON `tokens` (`oauth_app_id`);