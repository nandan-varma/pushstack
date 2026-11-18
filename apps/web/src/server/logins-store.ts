/**
 * The namespace registry behind `/api/v3` and `/{login}`: a login is claimed
 * once, by a user or an organization, and `lower(login)` is unique. Every
 * write that creates an owner inserts here in the same transaction as the row
 * it names (see organizations-store.ts and src/lib/auth.ts).
 */
import { sql } from "drizzle-orm";
import { db } from "#/db";
import { logins } from "#/db/app-schema";

export type LoginKind = (typeof logins.$inferSelect)["kind"];

/** Case-insensitive: `Alice` and `alice` are the same login. */
export async function loginTaken(login: string): Promise<boolean> {
	const [row] = await db
		.select({ one: sql`1` })
		.from(logins)
		.where(sql`lower(${logins.login}) = ${login.toLowerCase()}`)
		.limit(1);
	return Boolean(row);
}

export async function addLogin(login: {
	login: string;
	kind: LoginKind;
	refId: string;
}): Promise<void> {
	await db.insert(logins).values(login);
}
