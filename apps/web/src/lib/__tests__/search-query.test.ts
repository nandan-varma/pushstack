import { describe, expect, it } from "vitest";
import {
	parseSearchQuery,
	withoutSearchAssignee,
	withSearchLabel,
	withSearchStatus,
} from "../search-query";

describe("parseSearchQuery", () => {
	it("defaults to no filters and created-desc", () => {
		expect(parseSearchQuery("")).toEqual({
			terms: [],
			status: undefined,
			type: undefined,
			matchesNothing: false,
			labels: [],
			noLabel: false,
			authors: [],
			assignees: [],
			noAssignee: false,
			mentions: [],
			reviewRequested: [],
			reviewedBy: [],
			sort: "created-desc",
		});
	});

	it("reads free text as ANDed terms", () => {
		expect(parseSearchQuery("  fix   the crash ").terms).toEqual([
			"fix",
			"the",
			"crash",
		]);
	});

	it("keeps a quoted phrase as one term", () => {
		expect(parseSearchQuery('"fix the crash" now').terms).toEqual([
			"fix the crash",
			"now",
		]);
	});

	it("parses is: status and type", () => {
		expect(parseSearchQuery("is:closed is:pr")).toMatchObject({
			status: "closed",
			type: "pr",
			matchesNothing: false,
		});
		expect(parseSearchQuery("is:all").status).toBe("all");
		expect(parseSearchQuery("is:merged").status).toBe("merged");
		expect(parseSearchQuery("IS:OPEN").status).toBe("open");
	});

	it("treats contradictory is: filters as matching nothing", () => {
		expect(parseSearchQuery("is:open is:closed")).toMatchObject({
			status: undefined,
			matchesNothing: true,
		});
		expect(parseSearchQuery("is:issue is:pr")).toMatchObject({
			type: undefined,
			matchesNothing: true,
		});
	});

	it("intersects is:closed is:merged to merged", () => {
		expect(parseSearchQuery("is:closed is:merged")).toMatchObject({
			status: "merged",
			matchesNothing: false,
		});
	});

	it("lets is:all win over other states", () => {
		expect(parseSearchQuery("is:open is:all")).toMatchObject({
			status: "all",
			matchesNothing: false,
		});
	});

	it("collects labels, quoted and repeated", () => {
		expect(parseSearchQuery('label:bug label:"help wanted"').labels).toEqual([
			"bug",
			"help wanted",
		]);
	});

	it("parses no:label and no:assignee", () => {
		expect(parseSearchQuery("no:label no:assignee")).toMatchObject({
			noLabel: true,
			noAssignee: true,
		});
	});

	it("parses author, assignee and mentions", () => {
		expect(
			parseSearchQuery("author:alice assignee:bob mentions:carol"),
		).toMatchObject({
			authors: ["alice"],
			assignees: ["bob"],
			mentions: ["carol"],
		});
	});

	it("parses sort and ignores unknown sorts", () => {
		expect(parseSearchQuery("sort:comments-asc").sort).toBe("comments-asc");
		expect(parseSearchQuery("sort:bogus").sort).toBe("created-desc");
	});

	it("treats an unknown qualifier as free text, not a dropped token", () => {
		expect(parseSearchQuery("http://x")).toMatchObject({ terms: ["http://x"] });
		expect(parseSearchQuery("a:b")).toMatchObject({ terms: ["a:b"] });
		expect(parseSearchQuery('"a:b"')).toMatchObject({ terms: ["a:b"] });
		expect(parseSearchQuery("label:x")).toMatchObject({
			terms: [],
			labels: ["x"],
		});
		expect(parseSearchQuery("milestone:v1 is:open")).toMatchObject({
			status: "open",
			terms: ["milestone:v1"],
		});
		// Negation is not supported: it is searched as text.
		expect(parseSearchQuery("-label:bug")).toMatchObject({
			terms: ["-label:bug"],
		});
	});

	it("dedupes repeated values ignoring case", () => {
		const query = parseSearchQuery("label:Bug label:bug author:Al author:al");
		expect(query.labels).toEqual(["Bug"]);
		expect(query.authors).toEqual(["Al"]);
	});

	it("survives empty and garbage input", () => {
		for (const input of [": ::: label: is: is:\" \" '''", "-", "\t\n"]) {
			expect(() => parseSearchQuery(input)).not.toThrow();
		}
		expect(parseSearchQuery("label: is: author:").labels).toEqual([]);
		expect(parseSearchQuery("label: is: author:").authors).toEqual([]);
	});
});

describe("query-string editing", () => {
	it("replaces the is: state but keeps is:pr and other qualifiers", () => {
		expect(withSearchStatus("is:open is:pr label:bug", "closed")).toBe(
			"is:pr label:bug is:closed",
		);
	});

	it("replaces every label: with one quoted label, or removes them", () => {
		expect(withSearchLabel("label:a label:b is:open", "help wanted")).toBe(
			'is:open label:"help wanted"',
		);
		expect(withSearchLabel("label:a is:open")).toBe("is:open");
	});

	it("removes assignee: and no:assignee only", () => {
		expect(
			withoutSearchAssignee("assignee:me no:assignee no:label is:open"),
		).toBe("no:label is:open");
	});
});
