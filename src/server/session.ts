import type { auth } from "@/lib/auth";
import { getSession } from "@/lib/auth-session";

type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>;
export type SessionUser = NonNullable<NonNullable<AuthSession>["user"]>;

export async function getCurrentUserOptional(): Promise<SessionUser | null> {
	const session = await getSession();

	return session?.user ?? null;
}

export async function getCurrentUser(): Promise<SessionUser> {
	const user = await getCurrentUserOptional();

	if (!user?.id) {
		throw new Error("Unauthorized");
	}

	return user;
}
