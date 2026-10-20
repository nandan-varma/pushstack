/**
 * A REST client for `/api/v3` tests: requests go straight to the real
 * dispatcher (no network), carrying real personal access tokens. Import it
 * after the test's `vi.mock` calls (with `await import`), like the server
 * modules it loads.
 */
import { endpoints, type Method, matchRoute } from "@pushstack/api-contract";
import { expect } from "vitest";
import { handleApiRequest } from "../server/api";
import { createToken } from "../server/tokens";
import { signIn, type TestUser } from "./app-harness";

export const BASE = "http://localhost:3000/api/v3";

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
	// Web URLs use the same canonical paths as the page router. REST URLs
	// still retain `/api/v3/users` and `/api/v3/repos`.
	expect(text).not.toMatch(/http:\/\/localhost:3000\/(?:repo|users)\//);
	// biome-ignore lint/suspicious/noExplicitAny: arbitrary JSON under test
	const body = (text ? JSON.parse(text) : null) as any;
	expectContractResponse(options.method ?? "GET", path, response.status, body);
	return {
		status: response.status,
		headers: response.headers,
		body,
	};
}

/**
 * Every success response is checked against its operation's response schema
 * in `@pushstack/api-contract`, so any test that reaches an endpoint also
 * verifies the served shape. Error bodies are GitHub's `{ message }` shape,
 * checked by the tests that expect them.
 */
function expectContractResponse(
	method: string,
	path: string,
	status: number,
	body: unknown,
) {
	if (status < 200 || status >= 300) return;
	const match = matchRoute(
		method as Method,
		new URL(`${BASE}${path}`).pathname.slice(new URL(BASE).pathname.length),
	);
	if (!match) return;
	const parsed = endpoints[match.id].response.safeParse(body);
	expect(
		parsed.success ? [] : parsed.error.issues,
		`${method} ${path} (${match.id}) matches its contract response`,
	).toEqual([]);
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
