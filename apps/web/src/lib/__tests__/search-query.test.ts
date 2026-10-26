import { describe, expect, it } from "vitest";
import {
	parseSearchQuery,
	splitScopeQualifiers,
	unservedQualifier,
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
			milestones: [],
			noMilestone: false,
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

	it("reads state: as an alias of is:", () => {
		expect(parseSearchQuery("state:open")).toMatchObject({ status: "open" });
		expect(parseSearchQuery("is:open state:closed").matchesNothing).toBe(true);
		expect(parseSearchQuery("state:bogus").status).toBeUndefined();
	});

	it("parses sort and ignores unknown sorts", () => {
		expect(parseSearchQuery("sort:comments-asc").sort).toBe("comments-asc");
		expect(parseSearchQuery("sort:bogus").sort).toBe("created-desc");
	});

	it("parses milestone: and no:milestone", () => {
		expect(parseSearchQuery('milestone:"v1 beta" no:milestone')).toMatchObject({
			milestones: ["v1 beta"],
			noMilestone: true,
			terms: [],
		});
	});

	it("treats an unknown qualifier as free text, not a dropped token", () => {
		expect(parseSearchQuery("http://x")).toMatchObject({ terms: ["http://x"] });
		expect(parseSearchQuery("a:b")).toMatchObject({ terms: ["a:b"] });
		expect(parseSearchQuery('"a:b"')).toMatchObject({ terms: ["a:b"] });
		expect(parseSearchQuery("label:x")).toMatchObject({
			terms: [],
			labels: ["x"],
		});
		expect(parseSearchQuery("project:v1 is:open")).toMatchObject({
			status: "open",
			terms: ["project:v1"],
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

	it("replaces a state: alias too", () => {
		expect(withSearchStatus("state:open is:pr", "closed")).toBe(
			"is:pr is:closed",
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

describe("splitScopeQualifiers", () => {
	it("takes user: owners out as well", () => {
		expect(splitScopeQualifiers("user:octo is:open repo:octo/x")).toEqual({
			repos: ["octo/x"],
			owners: ["octo"],
			rest: "is:open",
		});
	});

	it("takes repo: qualifiers out and keeps the rest verbatim", () => {
		expect(splitScopeQualifiers("is:pr repo:octo/hello author:octo")).toEqual({
			repos: ["octo/hello"],
			owners: [],
			rest: "is:pr author:octo",
		});
	});

	it("keeps a quoted repo: phrase as search text, not a qualifier", () => {
		expect(splitScopeQualifiers('"repo:octo/hello" crash')).toEqual({
			repos: [],
			owners: [],
			rest: '"repo:octo/hello" crash',
		});
	});

	it("returns every repo: value so the caller can refuse several", () => {
		expect(splitScopeQualifiers("repo:a/b repo:c/d").repos).toEqual([
			"a/b",
			"c/d",
		]);
	});
});

describe("unservedQualifier", () => {
	it("passes queries made of served qualifiers, quoted text and free text", () => {
		expect(
			unservedQualifier(
				'is:open is:pr label:"help wanted" no:assignee sort:updated-desc draft:true',
			),
		).toBeNull();
		expect(unservedQualifier('"in:title" broken')).toBeNull();
		expect(unservedQualifier("http:x")).toBe("http:x");
	});

	it("names the first unserved qualifier, unknown, negated, empty or unserved-valued", () => {
		expect(unservedQualifier("in:title broken")).toBe("in:title");
		expect(unservedQualifier("is:open comments:>3")).toBe("comments:>3");
		expect(unservedQualifier("-label:bug")).toBe("-label:bug");
		expect(unservedQualifier("label:")).toBe("label:");
		expect(unservedQualifier("is:locked")).toBe("is:locked");
		expect(unservedQualifier("no:project")).toBe("no:project");
		expect(unservedQualifier("draft:maybe")).toBe("draft:maybe");
		expect(unservedQualifier("sort:bogus")).toBe("sort:bogus");
	});
});
