import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { endpoints, routes } from "../src";
import type { Schemas } from "../src/route";

const github = JSON.parse(
	readFileSync(
		new URL("./fixtures/github-operations.json", import.meta.url),
		"utf8",
	),
) as {
	operations: Record<string, { query: string[]; body: string[] }>;
	absentFromGitHub: string[];
};

/** The top-level keys a query or body schema declares (none when absent). */
function declared(schema: z.ZodType | undefined): string[] {
	const shape = (schema as { shape?: Record<string, unknown> } | undefined)
		?.shape;
	return Object.keys(shape ?? {}).sort();
}

/**
 * Served operations with no operation of the same id in GitHub's description,
 * and why each is served anyway. Any other id absent from the fixture fails.
 */
const NOT_ON_GITHUB: Record<string, string> = {
	"repos/create-release-asset-upload":
		"PushStack's two-step asset upload (create, then finish); GitHub takes asset bytes on uploads.github.com",
	"repos/finish-release-asset-upload": "the second step of the upload above",
	"git/list-refs":
		"GET /git/refs/{ref} is a PushStack extension; GitHub reads one ref at /git/ref/{ref} (git/get-ref) and lists by prefix at /git/matching-refs/{ref} (git/list-matching-refs)",
};

describe("GitHub parameters", () => {
	it("is vendored for every served operation, and names the absent ones", () => {
		expect(
			[...Object.keys(github.operations), ...github.absentFromGitHub].sort(),
		).toEqual(Object.keys(routes).sort());
		expect(github.absentFromGitHub.sort()).toEqual(
			Object.keys(NOT_ON_GITHUB).sort(),
		);
	});

	for (const id of Object.keys(github.operations)) {
		it(`declares every GitHub query and body parameter of ${id}`, () => {
			const endpoint = endpoints[id as keyof typeof endpoints] as Schemas;
			const gh = github.operations[id] as { query: string[]; body: string[] };
			const gotQuery = declared(endpoint.query);
			const gotBody = declared(endpoint.body);
			expect({
				query: gotQuery.filter((key) => !gh.query.includes(key)),
				body: gotBody.filter((key) => !gh.body.includes(key)),
			}).toEqual({ query: [], body: [] });
			expect({
				query: gh.query.filter((key) => !gotQuery.includes(key)),
				body: gh.body.filter((key) => !gotBody.includes(key)),
			}).toEqual({ query: [], body: [] });
		});
	}
});
