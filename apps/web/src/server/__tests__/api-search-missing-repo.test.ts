/**
 * @vitest-environment node
 *
 * A search result whose repository did not load is a failure, never a null
 * item: the repository lookup is stubbed empty, so every result is missing its
 * repository, and the search must answer 500, as the GraphQL search does.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));
vi.mock("@tanstack/react-start", () => import("../../test/server-test-utils"));
vi.mock(
	"#/server/session",
	async () => (await import("../../test/app-harness")).sessionModule,
);
vi.mock("../search-scope", async (importOriginal) => ({
	...(await importOriginal<typeof import("../search-scope")>()),
	repositoriesWithOwner: async () => new Map(),
}));

const { createUsers } = await import("../../test/app-harness");
const { call, mintToken, post } = await import("../../test/api-client");

const users = await createUsers("alice");
let alice: string;

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	expect(
		(await call("/user/repos", post(alice, { name: "proj" }))).status,
	).toBe(201);
	expect(
		(await call("/repos/alice/proj/issues", post(alice, { title: "Broken" })))
			.status,
	).toBe(201);
});

describe("GET /search/issues with a result whose repository is missing", () => {
	it("fails the request rather than returning a null item", async () => {
		const { status, body } = await call("/search/issues?q=state:open");
		expect(status).toBe(500);
		expect(JSON.stringify(body)).not.toContain("[null]");
		expect(body.items).toBeUndefined();
	});
});
