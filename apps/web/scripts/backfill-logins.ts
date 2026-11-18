/**
 * `pnpm db:push`'s follow-up: drizzle-kit only changes the schema, and every
 * owner name must be in the `logins` registry before an organization can claim
 * one. Runs after the push, so a fresh database and an existing one both end
 * with one registry row per username.
 */
import { sql } from "drizzle-orm";
import { db } from "#/db";

await db.execute(sql`
	insert into logins (login, kind, ref_id)
	select u.username, 'user', u.id
	from "user" u
	where not exists (
		select 1 from logins l where lower(l.login) = lower(u.username)
	)
`);
