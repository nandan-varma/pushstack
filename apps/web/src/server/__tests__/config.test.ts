import { afterEach, describe, expect, it, vi } from "vitest";
import { positiveInt } from "../config";

/** Any real tunable will do; the test stubs it and restores it after. */
const KNOB = "SLOW_REQUEST_MS";

describe("positiveInt", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("uses the default when the variable is unset or empty", () => {
		expect(positiveInt(KNOB, 7)).toBe(7);
		vi.stubEnv(KNOB, "");
		expect(positiveInt(KNOB, 7)).toBe(7);
	});

	it("reads a positive integer", () => {
		vi.stubEnv(KNOB, "42");
		expect(positiveInt(KNOB, 7)).toBe(42);
	});

	it.each(["abc", "0", "-3", "1.5", "12x"])("rejects %s", (raw) => {
		vi.stubEnv(KNOB, raw);
		expect(() => positiveInt(KNOB, 7)).toThrow(
			new RegExp(`${KNOB} must be a positive integer`),
		);
	});
});
