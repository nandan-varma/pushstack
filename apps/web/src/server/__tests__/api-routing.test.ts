/** @vitest-environment node */
import { type Method, routes } from "@pushstack/api-contract/client";
import { describe, expect, it } from "vitest";
import { matchApiRoute } from "../api/routing";

describe("contract-derived API routing", () => {
	it.each(Object.entries(routes))("dispatches %s", (id, route) => {
		const expected: Record<string, string> = {};
		const path = route.path.replace(/\{(\+?)([a-z_]+)\}/g, (_, plus, name) => {
			const value = plus ? "feature/a b" : `${name}-value`;
			expected[name] = value;
			return value.split("/").map(encodeURIComponent).join("/");
		});
		expect(matchApiRoute(route.method, path)).toMatchObject({
			id,
			params: expected,
		});
	});

	it.each([
		["/repos/a/b/contents", "repos/get-content"],
		["/repos/a/b/git/refs", "git/list-refs"],
		["/repos/a/b/git/matching-refs", "git/list-matching-refs"],
	])("matches optional reserved expansion %s", (path, id) => {
		expect(matchApiRoute("GET", path)?.id).toBe(id);
	});

	it("keeps literal comment routes ahead of issue numbers", () => {
		expect(
			matchApiRoute("GET", "/repos/a/b/issues/comments/123"),
		).toMatchObject({
			id: "issues/get-comment",
			params: { comment_id: "123" },
		});
	});

	it("decodes parameters exactly once", () => {
		expect(matchApiRoute("GET", "/repos/a/b/contents/a%252Fb")).toMatchObject({
			params: { path: "a%2Fb" },
		});
	});

	it.each(["/repos/a/b/contents/%zz", "/repos/a/b/contents/%FF"])(
		"rejects malformed encoding %s",
		(path) => {
			expect(matchApiRoute("GET", path)).toBeNull();
		},
	);

	it.each(["OPTIONS", "TRACE", "POST"])(
		"rejects an unsupported method %s",
		(method) => {
			expect(matchApiRoute(method as Method, "/rate_limit")).toBeNull();
		},
	);
});
