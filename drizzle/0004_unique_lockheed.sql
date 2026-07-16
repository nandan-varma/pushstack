ALTER TABLE "repositories" ADD COLUMN "show_last_commit_column" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "auto_refresh_pr_diffs" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "issue_repo_status_idx" ON "issues" USING btree ("repo_id","status");--> statement-breakpoint
CREATE INDEX "pr_repo_status_idx" ON "pull_requests" USING btree ("repo_id","status");--> statement-breakpoint
CREATE INDEX "star_repo_user_idx" ON "stars" USING btree ("repo_id","user_id");