import type { auth } from "@/lib/auth";
import { getSession } from "@/lib/auth-session";

type AuthSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

/** The signed-in user. Sign-up requires a username (src/lib/auth.ts). */
export type SessionUser = AuthSession["user"] & { username: string };

export async function getCurrentUserOptional(): Promise<SessionUser | null> {
	const user = (await getSession())?.user;
	if (!user) return null;
	if (!user.username) throw new Error(`User ${user.id} has no username`);
	return { ...user, username: user.username };
}

export async function getCurrentUser(): Promise<SessionUser> {
	const user = await getCurrentUserOptional();
	if (!user) throw new Error("Unauthorized");
	return user;
}
