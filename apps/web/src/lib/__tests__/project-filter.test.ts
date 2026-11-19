import { describe, expect, it } from "vitest";
import {
	matchesProjectFilter,
	type ProjectFilterItem,
	parseProjectFilter,
	sortProjectItems,
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

describe("sortProjectItems", () => {
	const rows: (ProjectFilterItem & { updatedAt: string })[] = [
		{
			title: "Write docs",
			kind: "issue",
			updatedAt: "2026-03-01T00:00:00.000Z",
			values: { points: "5", due: "2026-05-02" },
		},
		{
			title: "Ship the board",
			kind: "issue",
			updatedAt: "2026-02-01T00:00:00.000Z",
			values: { points: "30", due: "2026-01-02" },
		},
		{
			title: "Add search",
			kind: "pull_request",
			updatedAt: "2026-04-01T00:00:00.000Z",
			values: { points: "6", due: "2026-01-10" },
		},
	];
	const titles = (sorted: { title: string }[]) =>
		sorted.map((entry) => entry.title);

	it("sorts by title and flips with the direction", () => {
		expect(
			titles(sortProjectItems([...rows], { field: "title", direction: "asc" })),
		).toEqual(["Add search", "Ship the board", "Write docs"]);
		expect(
			titles(
				sortProjectItems([...rows], { field: "title", direction: "desc" }),
			),
		).toEqual(["Write docs", "Ship the board", "Add search"]);
	});

	it("sorts by update time", () => {
		expect(
			titles(
				sortProjectItems([...rows], { field: "updated", direction: "desc" }),
			),
		).toEqual(["Add search", "Write docs", "Ship the board"]);
	});

	it("sorts a number field numerically, not lexically", () => {
		expect(
			titles(
				sortProjectItems([...rows], { field: "points", direction: "asc" }),
			),
		).toEqual(["Write docs", "Add search", "Ship the board"]);
	});

	it("sorts a date field chronologically", () => {
		expect(
			titles(sortProjectItems([...rows], { field: "due", direction: "asc" })),
		).toEqual(["Ship the board", "Add search", "Write docs"]);
	});
});
