DROP INDEX "repo_owner_name_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "repo_owner_name_idx" ON "repositories" USING btree ("owner_id","name");