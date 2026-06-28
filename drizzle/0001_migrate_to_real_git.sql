-- Migration: Move to Real Git Implementation
-- This migration removes the custom git-like tables and updates the schema to use actual git repositories

-- Add new columns to repositories table for git path and backup info
ALTER TABLE repositories ADD COLUMN git_path TEXT;
ALTER TABLE repositories ADD COLUMN disk_usage BIGINT;
ALTER TABLE repositories ADD COLUMN last_backup_at TIMESTAMP;
ALTER TABLE repositories ADD COLUMN backup_r2_key TEXT;

-- Update pull_requests table to use branch names instead of foreign keys
ALTER TABLE pull_requests ADD COLUMN source_branch TEXT;
ALTER TABLE pull_requests ADD COLUMN target_branch TEXT;
ALTER TABLE pull_requests ADD COLUMN merge_commit_sha TEXT;

-- Migrate existing PR data (copy branch names before dropping foreign keys)
UPDATE pull_requests pr
SET source_branch = (SELECT name FROM branches WHERE id = pr.source_branch_id),
    target_branch = (SELECT name FROM branches WHERE id = pr.target_branch_id);

-- Make the new columns non-null if they have values
ALTER TABLE pull_requests ALTER COLUMN source_branch SET NOT NULL;
ALTER TABLE pull_requests ALTER COLUMN target_branch SET NOT NULL;

-- Drop old columns
ALTER TABLE pull_requests DROP COLUMN source_branch_id;
ALTER TABLE pull_requests DROP COLUMN target_branch_id;

-- Drop git-related tables (no longer needed - git handles these)
DROP TABLE IF EXISTS repository_files CASCADE;
DROP TABLE IF EXISTS commits CASCADE;
DROP TABLE IF EXISTS branches CASCADE;

-- Note: After running this migration, you need to:
-- 1. Initialize bare git repositories on filesystem for each repository
-- 2. Set the git_path column for each repository
-- 3. Optionally migrate any existing data into the git repositories
