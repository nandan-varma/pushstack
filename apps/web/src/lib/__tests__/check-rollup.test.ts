import { describe, expect, it } from "vitest";
import {
	combinedStatusState,
	rollupState,
	suiteConclusion,
	suiteStatus,
} from "../check-rollup";

const run = (
	status: "queued" | "in_progress" | "completed",
	conclusion: "success" | "failure" | "skipped" | null = null,
) => ({ status, conclusion });

describe("check rollups", () => {
	it("combines statuses like GitHub", () => {
		expect(combinedStatusState([])).toBe("pending");
		expect(combinedStatusState([{ state: "success" }])).toBe("success");
		expect(
			combinedStatusState([{ state: "success" }, { state: "pending" }]),
		).toBe("pending");
		expect(
			combinedStatusState([{ state: "pending" }, { state: "error" }]),
		).toBe("failure");
	});

	it("computes a suite from its runs", () => {
		expect(suiteStatus([])).toBe("queued");
		expect(suiteStatus([run("queued")])).toBe("queued");
		expect(suiteStatus([run("queued"), run("completed", "success")])).toBe(
			"in_progress",
		);
		expect(suiteConclusion([run("completed", "success"), run("queued")])).toBe(
			null,
		);
		expect(
			suiteConclusion([
				run("completed", "success"),
				run("completed", "failure"),
			]),
		).toBe("failure");
		expect(
			suiteConclusion([
				run("completed", "success"),
				run("completed", "skipped"),
			]),
		).toBe("success");
	});

	it("rolls statuses and runs together, failure first", () => {
		expect(rollupState([], [])).toBeNull();
		expect(
			rollupState([{ state: "success" }], [run("completed", "skipped")]),
		).toBe("success");
		expect(rollupState([{ state: "success" }], [run("in_progress")])).toBe(
			"pending",
		);
		expect(
			rollupState([{ state: "pending" }], [run("completed", "failure")]),
		).toBe("failure");
	});
});
