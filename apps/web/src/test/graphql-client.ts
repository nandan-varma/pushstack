/**
 * A client for `/api/graphql` tests: requests go straight to the real
 * handler (no network) with real personal access tokens. Import it after the
 * test's `vi.mock` calls, like the server modules it loads.
 */
import { expect } from "vitest";
import { handleGraphqlRequest } from "../server/graphql";

export const GRAPHQL_URL = "http://localhost:3000/api/graphql";

export interface GraphqlResult {
	status: number;
	headers: Headers;
	// biome-ignore lint/suspicious/noExplicitAny: arbitrary JSON under test
	body: any;
}

export async function graphql(
	token: string | null,
	query: string,
	variables?: Record<string, unknown>,
	operationName?: string,
): Promise<GraphqlResult> {
	const headers: Record<string, string> = {
		"content-type": "application/json",
	};
	if (token) headers.authorization = `bearer ${token}`;
	const response = await handleGraphqlRequest(
		new Request(GRAPHQL_URL, {
			method: "POST",
			headers,
			body: JSON.stringify({ query, variables, operationName }),
		}),
	);
	const text = await response.text();
	// No response may ever carry an account email (the fixtures' domain).
	expect(text).not.toContain("@example.com");
	return {
		status: response.status,
		headers: response.headers,
		body: JSON.parse(text),
	};
}
