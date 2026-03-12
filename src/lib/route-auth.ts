import type { QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
import { getSession } from "@/lib/auth-session";

export async function requireUserSession(_queryClient: QueryClient) {
	const session = await getSession();

	if (!session?.user) {
		throw redirect({ to: "/auth/login" });
	}

	return session;
}

export async function redirectAuthenticatedUser(_queryClient: QueryClient) {
	const session = await getSession();

	if (session?.user) {
		throw redirect({ to: "/dashboard" });
	}

	return session;
}
