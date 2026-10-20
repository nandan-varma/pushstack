/**
 * A REST client for `/api/v3` tests: requests go straight to the real
 * dispatcher (no network), carrying real personal access tokens. Import it
 * after the test's `vi.mock` calls (with `await import`), like the server
 * modules it loads.
 */
import { expect } from "vitest";
import { handleApiRequest } from "../server/api";
import { createToken } from "../server/tokens";
import { signIn, type TestUser } from "./app-harness";

export const BASE = "http://localhost:3000/api/v3";

/** A fresh token for `who`, minted through the real tokens server function. */
export async function mintToken(
	who: TestUser,
	scopes: ("repo:read" | "repo:write")[],
): Promise<string> {
	signIn(who);
	return (
		await createToken({ data: { name: "t", scopes, lifetimeDays: null } })
	).token;
}

interface CallOptions {
	authorization?: string;
	method?: string;
	body?: string;
}

export async function call(path: string, options: CallOptions = {}) {
	const headers: Record<string, string> = {};
	if (options.authorization) headers.authorization = options.authorization;
	const response = await handleApiRequest(
		new Request(`${BASE}${path}`, {
			method: options.method ?? "GET",
			headers,
			body: options.body,
		}),
	);
	const text = await response.text();
	// No response may ever carry an account email (the fixtures' domain).
	expect(text).not.toContain("@example.com");
	return {
		status: response.status,
		headers: response.headers,
		// biome-ignore lint/suspicious/noExplicitAny: arbitrary JSON under test
		body: (text ? JSON.parse(text) : null) as any,
	};
}

export const asToken = (token: string) => ({
	authorization: `token ${token}`,
});

export const post = (token: string, body: unknown) => ({
	...asToken(token),
	method: "POST",
	body: JSON.stringify(body),
});

export const patch = (token: string, body: unknown) => ({
	...asToken(token),
	method: "PATCH",
	body: JSON.stringify(body),
});
