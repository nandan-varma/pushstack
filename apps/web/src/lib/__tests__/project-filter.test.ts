import { describe, expect, it } from "vitest";
import {
	matchesProjectFilter,
	type ProjectFilterItem,
	parseProjectFilter,
} from "@/lib/project-filter";

const row = (over: Partial<ProjectFilterItem> = {}): ProjectFilterItem => ({
	title: "Ship the board",
	kind: "issue",
	values: { status: "Todo", notes: "Needs review" },
	...over,
});

describe("parseProjectFilter", () => {
	it("reads bare words as title terms", () => {
		expect(parseProjectFilter("board ship").terms).toEqual(["board", "ship"]);
		expect(parseProjectFilter("").terms).toEqual([]);
	});

	it("reads is: into kinds and unknown kinds back into terms", () => {
		const filter = parseProjectFilter("is:pr is:DRAFT is:whatever");
		expect(filter.kinds).toEqual(["pull_request", "draft"]);
		expect(filter.terms).toEqual(["is:whatever"]);
	});

	it("reads field values, quoted values and empty fields", () => {
		const filter = parseProjectFilter('status:"in progress" no:notes');
		expect(filter.values).toEqual([{ field: "status", value: "in progress" }]);
		expect(filter.empty).toEqual(["notes"]);
	});

	it("bounds the input and the token count", () => {
		const filter = parseProjectFilter(`a ${"word ".repeat(500)}`);
		expect(filter.terms.length).toBeLessThanOrEqual(20);
	});
});

describe("matchesProjectFilter", () => {
	it("matches every term, kind, value and empty field", () => {
		expect(matchesProjectFilter(row(), parseProjectFilter("board"))).toBe(true);
		expect(matchesProjectFilter(row(), parseProjectFilter("missing"))).toBe(
			false,
		);
		expect(matchesProjectFilter(row(), parseProjectFilter("is:issue"))).toBe(
			true,
		);
		expect(matchesProjectFilter(row(), parseProjectFilter("is:pr"))).toBe(
			false,
		);
		expect(matchesProjectFilter(row(), parseProjectFilter("status:todo"))).toBe(
			true,
		);
		expect(matchesProjectFilter(row(), parseProjectFilter("notes:other"))).toBe(
			false,
		);
		expect(matchesProjectFilter(row(), parseProjectFilter("no:status"))).toBe(
			false,
		);
		expect(
			matchesProjectFilter(
				row({ values: { status: null } }),
				parseProjectFilter("no:status"),
			),
		).toBe(true);
	});

	it("keeps drafts by their own kind and title", () => {
		const draft = row({ kind: "draft", title: "Draft plan", values: {} });
		expect(matchesProjectFilter(draft, parseProjectFilter("is:draft"))).toBe(
			true,
		);
		expect(matchesProjectFilter(draft, parseProjectFilter("draft"))).toBe(true);
		expect(matchesProjectFilter(draft, parseProjectFilter("no:status"))).toBe(
			true,
		);
	});
});
