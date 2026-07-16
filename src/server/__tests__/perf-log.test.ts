import { describe, expect, it, vi } from "vitest";
import {
	perfContext,
	perfNote,
	perfR2,
	perfStep,
	recordCacheHit,
	recordCacheMiss,
	recordR2Call,
} from "../perf-log";

describe("perfContext", () => {
	it("returns the value from the wrapped function", async () => {
		const result = await perfContext("test", async () => 42);
		expect(result).toBe(42);
	});

	it("propagates thrown errors", async () => {
		await expect(
			perfContext("fail", async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
	});

	it("logs start/done to console.log", async () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		await perfContext("label", async () => "ok");
		expect(spy).toHaveBeenCalled();
		const first = spy.mock.calls[0][0];
		expect(first).toContain("label");
		expect(first).toContain("start");
		const last = spy.mock.calls.at(-1)![0];
		expect(last).toContain("done");
		spy.mockRestore();
	});

	it("logs failure on error", async () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		await expect(
			perfContext("err", async () => {
				throw new Error("crash");
			}),
		).rejects.toThrow();
		const last = spy.mock.calls.at(-1)![0];
		expect(last).toContain("failed");
		expect(last).toContain("crash");
		spy.mockRestore();
	});
});

describe("perfStep", () => {
	it("returns the value and logs timing inside a perfContext", async () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		const result = await perfContext("outer", async () => {
			return perfStep("step-a", async () => 99);
		});
		expect(result).toBe(99);
		const stepLog = spy.mock.calls.find((c) => String(c[0]).includes("step-a"));
		expect(stepLog).toBeDefined();
		spy.mockRestore();
	});

	it("works outside a perfContext (no-op logging)", async () => {
		const result = await perfStep("orphan", async () => 1);
		expect(result).toBe(1);
	});

	it("re-throws errors from the step", async () => {
		await expect(
			perfContext("outer", async () => {
				return perfStep("bad", async () => {
					throw new Error("step failed");
				});
			}),
		).rejects.toThrow("step failed");
	});
});

describe("recordR2Call", () => {
	it("increments R2 call count inside a perfContext", async () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		await perfContext("r2-test", async () => {
			recordR2Call(10);
			recordR2Call(20);
		});
		const doneLine = spy.mock.calls.at(-1)![0] as string;
		expect(doneLine).toContain("r2: 2 calls");
		expect(doneLine).toContain("30.0ms");
		spy.mockRestore();
	});

	it("silently no-ops outside a perfContext", () => {
		expect(() => recordR2Call(5)).not.toThrow();
	});
});

describe("recordCacheHit / recordCacheMiss", () => {
	it("tallies hits and misses", async () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		await perfContext("cache-test", async () => {
			recordCacheHit();
			recordCacheHit();
			recordCacheMiss();
		});
		const doneLine = spy.mock.calls.at(-1)![0] as string;
		expect(doneLine).toContain("cache: 2 hit / 1 miss");
		spy.mockRestore();
	});

	it("no-ops outside a perfContext", () => {
		expect(() => recordCacheHit()).not.toThrow();
		expect(() => recordCacheMiss()).not.toThrow();
	});
});

describe("perfR2", () => {
	it("tallies an R2 call onto the context and logs it", async () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		await perfContext("r2-fn", async () => {
			const val = await perfR2("r2-read", async () => "data");
			expect(val).toBe("data");
		});
		const stepLine = spy.mock.calls
			.map((c) => String(c[0]))
			.find((l) => l.includes("r2-read"));
		expect(stepLine).toBeDefined();
		const doneLine = spy.mock.calls.at(-1)![0] as string;
		expect(doneLine).toContain("r2: 1 call");
		spy.mockRestore();
	});

	it("records a failed R2 call and still tallies it", async () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		await expect(
			perfContext("r2-fail", async () => {
				await perfR2("r2-err", async () => {
					throw new Error("network");
				});
			}),
		).rejects.toThrow("network");
		// On error, perfContext logs the failure line which includes r2 call stats
		const logLines = spy.mock.calls.map((c) => String(c[0]));
		const errorLine = logLines.find(
			(l) => l.includes("r2-fail") && l.includes("failed"),
		);
		expect(errorLine).toBeDefined();
		spy.mockRestore();
	});
});

describe("perfNote", () => {
	it("logs a note inside a perfContext", async () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		await perfContext("note-test", async () => {
			perfNote("something noteworthy");
		});
		const noteLine = spy.mock.calls
			.map((c) => String(c[0]))
			.find((l) => l.includes("something noteworthy"));
		expect(noteLine).toBeDefined();
		spy.mockRestore();
	});
});
