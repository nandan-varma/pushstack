/**
 * The one registry backfill `pnpm db:push` runs: every username must be in
 * `logins` before an organization can claim it. `on conflict do nothing` makes
 * a second run, or a login already recorded by signup, a no-op.
 */
export const BACKFILL_LOGINS_SQL = `
	insert into logins (login, kind, ref_id)
	select u.username, 'user', u.id
	from "user" u
	on conflict do nothing
`;
