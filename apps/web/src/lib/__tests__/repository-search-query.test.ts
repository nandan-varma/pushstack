import { describe, expect, it } from "vitest";
import {
	parseRepositorySearchQuery,
	UnservedQuery,
} from "../repository-search-query";

describe("parseRepositorySearchQuery", () => {
	it("reads words, user:, is: and topic:", () => {
		expect(
			parseRepositorySearchQuery("hello world user:octo is:public topic:Rust"),
		).toEqual({
			terms: ["hello", "world"],
			owner: "octo",
			visibility: "public",
			topics: ["rust"],
			matchesNothing: false,
		});
	});

	it("keeps a quoted phrase as one term", () => {
		expect(parseRepositorySearchQuery('"hello world"').terms).toEqual([
			"hello world",
		]);
	});

	it("matches nothing for contradictory qualifiers", () => {
		expect(parseRepositorySearchQuery("user:a user:b").matchesNothing).toBe(
			true,
		);
		expect(
			parseRepositorySearchQuery("is:public is:private").matchesNothing,
		).toBe(true);
	});

	it.each([
		"language:go",
		"fork:true",
		"in:name",
		"stars:>10",
		"is:fork",
		"-user:octo",
		"user:",
		"http://example.test",
		"a:b",
	])("refuses %j rather than reading it as text", (query) => {
		expect(() => parseRepositorySearchQuery(query)).toThrow(UnservedQuery);
	});
});
