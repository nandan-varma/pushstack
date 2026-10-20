import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isReservedName } from "../reserved-names";

const web = join(import.meta.dirname, "../../..");

describe("reserved top-level names", () => {
	it("covers every static top-level route and public file", () => {
		const routes = readdirSync(join(web, "src/routes"))
			.filter((entry) => !entry.startsWith("$") && !entry.startsWith("__"))
			.map((entry) => entry.replace(/\.tsx?$/, "").split(".")[0] as string)
			.filter((segment) => segment !== "index");
		const files = readdirSync(join(web, "public"));
		for (const name of [...routes, ...files])
			expect(isReservedName(name), name).toBe(true);
	});
	it("is case-insensitive and leaves ordinary names alone", () => {
		expect(isReservedName("Settings")).toBe(true);
		expect(isReservedName("alice")).toBe(false);
	});
});
