CREATE TABLE "git_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"object_keys" jsonb NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"last_used_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "notes" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "todos" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "notes" CASCADE;--> statement-breakpoint
DROP TABLE "todos" CASCADE;--> statement-breakpoint
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "git_txn_status_idx" ON "git_transactions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "git_txn_created_idx" ON "git_transactions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "token_user_idx" ON "tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "token_hash_idx" ON "tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "activity_user_created_idx" ON "activities" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "activity_user_repo_idx" ON "activities" USING btree ("user_id","repo_id");--> statement-breakpoint
CREATE INDEX "repo_owner_name_idx" ON "repositories" USING btree ("owner_id","name");--> statement-breakpoint
CREATE INDEX "collab_repo_user_idx" ON "repository_collaborators" USING btree ("repo_id","user_id");