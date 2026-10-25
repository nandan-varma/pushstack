import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isReservedName } from "../reserved-names";

const web = join(import.meta.dirname, "../../..");

describe("reserved top-level names", () => {
	it("covers every static top-level route and public file", () => {
		// A pathless layout (`_auth`) adds no segment: its children are top level.
		const routeDir = join(web, "src/routes");
		const entries = readdirSync(routeDir, { withFileTypes: true }).flatMap(
			(entry) =>
				entry.isDirectory() && /^_[^_]/.test(entry.name)
					? readdirSync(join(routeDir, entry.name))
					: /^_[^_]/.test(entry.name)
						? []
						: [entry.name],
		);
		const routes = entries
			.filter((entry) => !entry.startsWith("$") && !entry.startsWith("__"))
			// A trailing `_` escapes nesting (`settings_.developers.tsx` is /settings/developers).
			.map((entry) =>
				(entry.replace(/\.tsx?$/, "").split(".")[0] as string).replace(
					/_$/,
					"",
				),
			)
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
