-- GitHub-style integer ids for /api/v3 clients. SQLite cannot auto-increment a
-- non-primary-key column, so a sequence table hands out the values (AUTOINCREMENT
-- never reuses one, even after the highest user is deleted) and a trigger
-- copies the next one onto each new user.
CREATE TABLE `user_api_id_seq` (
	`id` integer PRIMARY KEY AUTOINCREMENT
);
--> statement-breakpoint
CREATE TRIGGER `user_assign_api_id` AFTER INSERT ON `user`
BEGIN
	INSERT INTO `user_api_id_seq` DEFAULT VALUES;
	UPDATE `user` SET `apiId` = last_insert_rowid() WHERE `id` = NEW.`id`;
END;
