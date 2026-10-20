/**
 * @vitest-environment node
 *
 * The REST dispatcher's tests call `handleApiRequest` directly, so a method
 * missing from the `/api/v3/$` file route's handlers would pass them all while
 * every real request with that method fell through to the app's HTML 200.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));

const { API_METHODS } = await import("../api");
const { Route } = await import("../../routes/api/v3.$");

describe("/api/v3 file route", () => {
	it("serves every method the route table uses", () => {
		const handlers = Object.keys(Route.options.server?.handlers ?? {});
		for (const method of API_METHODS) expect(handlers).toContain(method);
	});
});
