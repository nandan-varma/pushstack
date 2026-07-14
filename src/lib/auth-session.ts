import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { auth } from "@/lib/auth";

type Session = Awaited<ReturnType<typeof auth.api.getSession>>;

// A single repo/tree page load fires several server functions in parallel
// (getBranches/listFiles/getLastCommits/getCommits), and each independently calls
// getCurrentUserOptional -> getSession for the exact same request cookie. Single-flight
// by cookie value so those concurrent calls share one Better Auth session validation
// instead of each doing their own — cleared as soon as it resolves, so this never
// serves a result across separate requests, only coalesces a single request's burst.
const inFlight = new Map<string, Promise<Session>>();

export const getSession = createServerFn({ method: "GET" }).handler(
	async () => {
		const headers = getRequestHeaders();
		const cookie = headers.get("cookie") ?? "";

		const existing = inFlight.get(cookie);
		if (existing) return existing;

		const promise = auth.api.getSession({ headers }).finally(() => {
			if (inFlight.get(cookie) === promise) inFlight.delete(cookie);
		});
		inFlight.set(cookie, promise);
		return promise;
	},
);
