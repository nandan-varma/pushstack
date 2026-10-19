import { afterEach, describe, expect, it, vi } from "vitest";
import {
	isPerfLogEnabled,
	PERF_LOG_STORAGE_KEY,
	setPerfLogEnabled,
} from "../perf-log";

describe("browser perf-log switch", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		window.localStorage.clear();
	});

	it("is on in dev regardless of storage", () => {
		vi.stubEnv("DEV", true);
		expect(isPerfLogEnabled()).toBe(true);
	});

	it("is off in production until the storage key is set", () => {
		vi.stubEnv("DEV", false);
		expect(isPerfLogEnabled()).toBe(false);
		setPerfLogEnabled(true);
		expect(window.localStorage.getItem(PERF_LOG_STORAGE_KEY)).toBe("1");
		expect(isPerfLogEnabled()).toBe(true);
		setPerfLogEnabled(false);
		expect(isPerfLogEnabled()).toBe(false);
	});
});
