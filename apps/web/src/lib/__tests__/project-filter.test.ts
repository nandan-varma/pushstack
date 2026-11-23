import { describe, expect, it } from "vitest";
import { parseProjectFilter } from "@/lib/project-filter";

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
