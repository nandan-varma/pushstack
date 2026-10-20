import { describe, expect, expectTypeOf, it } from "vitest";
import {
	buildRequest,
	endpoints,
	type Input,
	type ListOperationId,
	matchEndpoint,
	matchPath,
	type Output,
	pathParamNames,
	requestFor,
} from "../src";
import type { Endpoint } from "../src/endpoint";

const table = Object.entries(endpoints) as [string, Endpoint][];

describe("the endpoint table", () => {
	it("has one definition per method and path", () => {
		const keys = table.map(([, e]) => `${e.method} ${e.path}`);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it("names every path param in its params schema, and nothing else", () => {
		for (const [id, endpoint] of table) {
			const names = pathParamNames(endpoint.path);
			const shape = (endpoint.params as { shape?: object } | undefined)?.shape;
			expect(Object.keys(shape ?? {}).sort(), id).toEqual([...names].sort());
		}
	});

	it("keeps rest params last and links GitHub's docs", () => {
		for (const [id, endpoint] of table) {
			expect(endpoint.path, id).toMatch(/^\/[^+]*(\{\+[a-z_]+\})?$/);
			expect(endpoint.docs, id).toMatch(/^https:\/\/docs\.github\.com\/rest\//);
			expect(id).toMatch(/^[a-z-]+\/[a-z-]+$/);
		}
	});

	it("routes every template back to its own operation", () => {
		for (const [id, endpoint] of table) {
			const sample = endpoint.path.replace(/\{\+?([a-z_]+)\}/g, "x1");
			expect(matchEndpoint(endpoint.method, sample)?.id, id).toBe(id);
		}
	});
});

describe("matchPath", () => {
	it("decodes single segments and keeps slashes in rest params", () => {
		expect(
			matchPath(
				"/repos/{owner}/{repo}/branches/{+branch}",
				"/repos/a/b%2Ec/branches/feat/x%20y",
			),
		).toEqual({ owner: "a", repo: "b.c", branch: "feat/x y" });
	});

	it("lets a rest param be empty", () => {
		expect(
			matchPath(
				"/repos/{owner}/{repo}/contents/{+path}",
				"/repos/a/b/contents",
			),
		).toEqual({ owner: "a", repo: "b", path: "" });
	});

	it("prefers literal routes listed first", () => {
		expect(matchEndpoint("GET", "/user/repos")?.id).toBe(
			"repos/list-for-authenticated-user",
		);
		expect(matchEndpoint("GET", "/user/7")?.id).toBe("users/get-by-id");
		expect(matchEndpoint("GET", "/repos/a/b/issues/comments/3")?.id).toBe(
			"issues/get-comment",
		);
	});

	it("rejects other lengths and malformed encoding", () => {
		expect(matchPath("/repos/{owner}/{repo}", "/repos/a")).toBeNull();
		expect(matchPath("/repos/{owner}/{repo}", "/repos/a/b/c")).toBeNull();
		expect(matchPath("/users/{username}", "/users/%E0%A4%A")).toBeNull();
	});
});

describe("requestFor", () => {
	it("fills the path and puts the rest in the query for reads", () => {
		expect(
			requestFor("issues/list-for-repo", {
				owner: "a b",
				repo: "r",
				state: "all",
				labels: ["bug", "ui"],
				per_page: 5,
				assignee: undefined,
			}),
		).toEqual({
			method: "GET",
			path: "/repos/a%20b/r/issues?state=all&labels=bug%2Cui&per_page=5",
		});
	});

	it("sends the rest as the JSON body for writes", () => {
		expect(
			requestFor("issues/update", {
				owner: "a",
				repo: "r",
				issue_number: 3,
				state: "closed",
			}),
		).toEqual({
			method: "PATCH",
			path: "/repos/a/r/issues/3",
			body: { state: "closed" },
		});
		expect(
			requestFor("pulls/merge", { owner: "a", repo: "r", pull_number: 1 }),
		).toEqual({ method: "PUT", path: "/repos/a/r/pulls/1/merge" });
	});

	it("encodes rest params per segment and drops an empty one", () => {
		expect(
			requestFor("repos/get-content", { owner: "a", repo: "r", path: "d/a b" })
				.path,
		).toBe("/repos/a/r/contents/d/a%20b");
		expect(
			requestFor("repos/get-content", { owner: "a", repo: "r" }).path,
		).toBe("/repos/a/r/contents");
	});

	it("refuses a missing path param", () => {
		expect(() => buildRequest(endpoints["repos/get"], { owner: "a" })).toThrow(
			/repo/,
		);
	});
});

describe("input schemas", () => {
	it("parse query strings with GitHub's fallbacks", () => {
		const query = endpoints["issues/list-for-repo"].query;
		expect(
			query.parse({ per_page: "500", page: "x", labels: "a, b,,", sort: "?" }),
		).toEqual({
			per_page: 100,
			page: undefined,
			state: "open",
			labels: ["a", "b"],
			sort: "created",
			direction: "desc",
		});
		expect(query.safeParse({ state: "bogus" }).success).toBe(false);
	});

	it("normalize label colors", () => {
		expect(
			endpoints["issues/create-label"].body.parse({
				name: " x ",
				color: "#ABCDEF",
			}),
		).toEqual({ name: "x", color: "abcdef" });
	});
});

it("types inputs and outputs from the schemas", () => {
	expectTypeOf<Input<"issues/get">>().toEqualTypeOf<{
		owner: string;
		repo: string;
		issue_number: number;
	}>();
	expectTypeOf<Output<"issues/get">["state"]>().toEqualTypeOf<
		"open" | "closed"
	>();
	expectTypeOf<Output<"issues/delete-label">>().toEqualTypeOf<null>();
	expectTypeOf<"pulls/list">().toExtend<ListOperationId>();
	expectTypeOf<"pulls/get">().not.toExtend<ListOperationId>();
});
