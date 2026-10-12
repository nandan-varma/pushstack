import { describe, expect, it, vi } from "vitest";

vi.mock("#/lib/perf-log", () => ({ isPerfLogEnabled: () => false }));

const { perfContext, perfNote, perfR2, perfStep } = await import("../perf-log");

describe("perf-log when disabled (production default)", () => {
	it("runs everything without logging", async () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		const result = await perfContext("quiet", async () => {
			perfNote("note");
			await perfR2("r2", async () => undefined);
			return perfStep("step", async () => 7);
		});
		expect(result).toBe(7);
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});
});
