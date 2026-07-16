import { describe, expect, it } from "vitest";
import { cn } from "../utils";

describe("cn", () => {
	it("merges class names", () => {
		expect(cn("foo", "bar")).toBe("foo bar");
	});

	it("resolves tailwind conflicts", () => {
		expect(cn("px-4", "px-8")).toBe("px-8");
	});

	it("handles conditional classes", () => {
		expect(cn("base", false && "hidden", "extra")).toBe("base extra");
	});

	it("handles empty input", () => {
		expect(cn()).toBe("");
	});

	it("merges duplicate classes via twMerge", () => {
		expect(cn("px-4", "px-4")).toBe("px-4");
	});
});
