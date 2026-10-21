import { afterEach, describe, expect, it, vi } from "vitest";
import { positiveInt } from "../config";

describe("positiveInt", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("uses the default when the variable is unset or empty", () => {
		expect(positiveInt("PUSHSTACK_TEST_KNOB", 7)).toBe(7);
		vi.stubEnv("PUSHSTACK_TEST_KNOB", "");
		expect(positiveInt("PUSHSTACK_TEST_KNOB", 7)).toBe(7);
	});

	it("reads a positive integer", () => {
		vi.stubEnv("PUSHSTACK_TEST_KNOB", "42");
		expect(positiveInt("PUSHSTACK_TEST_KNOB", 7)).toBe(42);
	});

	it.each(["abc", "0", "-3", "1.5", "12x"])("rejects %s", (raw) => {
		vi.stubEnv("PUSHSTACK_TEST_KNOB", raw);
		expect(() => positiveInt("PUSHSTACK_TEST_KNOB", 7)).toThrow(
			/PUSHSTACK_TEST_KNOB must be a positive integer/,
		);
	});
});
