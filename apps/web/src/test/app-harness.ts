/**
 * Shared setup for behavior tests that run the real server functions against
 * real storage: pglite Postgres (the app's schema) and git-fs.ts's in-memory
 * object store. Only the session is faked — `signIn(user)` / `signOut()`
 * pick who's calling.
 *
 * Use with, at the top of a test file (vi.mock is hoisted, so these lines
 * must be literal):
 *
 *   vi.mock("#/db", async () => ({ db: await (await import("<rel>/test/pglite-db")).createTestDb() }));
 *   vi.mock("@tanstack/react-start", () => import("<rel>/test/server-test-utils"));
 *   vi.mock("#/server/session", () => import("<rel>/test/app-harness").then((h) => h.sessionModule));
 */
import { isNotFound } from "@tanstack/react-router";
import { db } from "#/db";
import { logins } from "#/db/app-schema";
import { user } from "#/db/schema";

export interface TestUser {
	id: string;
	kind: "user";
	username: string;
	/** The username, as a repository owner's storage key (users have no separate login). */
	login: string;
	name: string;
	email: string;
}

let current: TestUser | null = null;

export function signIn(who: TestUser): void {
	current = who;
}

export function signOut(): void {
	current = null;
}

export const sessionModule = {
	getCurrentUserOptional: async () => current,
	getCurrentUser: async () => {
		if (!current) throw new Error("Unauthorized");
		return current;
	},
};

export async function createUsers<N extends string>(
	...names: N[]
): Promise<Record<N, TestUser>> {
	const users = names.map((name) => ({
		kind: "user" as const,
		id: `${name}-id`,
		username: name,
		login: name,
		name: name[0]?.toUpperCase() + name.slice(1),
		email: `${name}@example.com`,
	}));
	const now = new Date();
	await db.insert(user).values(
		users.map((u) => ({
			id: u.id,
			username: u.username,
			name: u.name,
			email: u.email,
			emailVerified: true,
			createdAt: now,
			updatedAt: now,
		})),
	);
	// Signup claims the login in the same transaction (src/lib/auth.ts); tests
	// that create users directly get the same registry state.
	await db.insert(logins).values(
		users.map((u) => ({
			login: u.username,
			kind: "user" as const,
			refId: u.id,
		})),
	);
	return Object.fromEntries(users.map((u) => [u.username, u])) as Record<
		string,
		TestUser
	> as Record<N, TestUser>;
}

export async function rejectsNotFound(
	promise: Promise<unknown>,
): Promise<boolean> {
	try {
		await promise;
		return false;
	} catch (error) {
		return isNotFound(error);
	}
}
