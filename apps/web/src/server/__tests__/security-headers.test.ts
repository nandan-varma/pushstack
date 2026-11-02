import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SECURITY_HEADERS } from "../security-headers";

/** The header lines `public/_headers` applies to every static asset. */
function staticAssetHeaders(): Record<string, string> {
	const file = readFileSync(
		path.resolve(import.meta.dirname, "../../../public/_headers"),
		"utf8",
	);
	const block = file.split(/^(?=\S)/m).find((b) => b.startsWith("/*"));
	const headers: Record<string, string> = {};
	for (const line of (block ?? "").split("\n").slice(1)) {
		const [name, ...value] = line.trim().split(":");
		if (name) headers[name] = value.join(":").trim();
	}
	return headers;
}

describe("security headers", () => {
	it("serves the same headers on static assets as on dynamic responses", () => {
		expect(staticAssetHeaders()).toEqual(SECURITY_HEADERS);
	});
});
