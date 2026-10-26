/**
 * @vitest-environment node
 *
 * Listings past the skip bound (`MAX_LIST_SKIP`): the page is empty, the
 * request still answers 200 (never a 500 from the count query), and a search
 * reports the real total. Covers the repository listings that share the
 * repository-list helper: `/user/repos` (whose filter names the collaborator
 * row, so the count must join it too), `/users/{user}/repos` and
 * `/search/repositories`.
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

const { createUsers } = await import("../../test/app-harness");
const { call, mintToken, post } = await import("../../test/api-client");

const users = await createUsers("alice", "bob");
let alice: string;

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	for (const name of ["one", "two"]) {
		expect(
			(
				await call(
					"/user/repos",
					post(alice, { name, description: "Skip bound" }),
				)
			).status,
		).toBe(201);
	}
});

/** Page 102 of 100 is offset 10,100, past `MAX_LIST_SKIP`. */
const PAST = "page=102&per_page=100";

describe("repository listings past the skip bound", () => {
	it("answers 200 with an empty page for /user/repos, with and without affiliation", async () => {
		for (const query of [
			PAST,
			`${PAST}&affiliation=collaborator`,
			`${PAST}&affiliation=owner`,
		]) {
			const { status, body } = await call(`/user/repos?${query}`, {
				authorization: `token ${alice}`,
			});
			expect(status, query).toBe(200);
			expect(body, query).toEqual([]);
		}
	});

	it("answers 200 with an empty page for /users/{user}/repos", async () => {
		const { status, body } = await call(`/users/alice/repos?${PAST}`);
		expect(status).toBe(200);
		expect(body).toEqual([]);
	});

	it("reports the real total_count for /search/repositories past the bound", async () => {
		const { status, body } = await call(`/search/repositories?q=skip&${PAST}`);
		expect(status).toBe(200);
		expect(body).toEqual({
			total_count: 2,
			incomplete_results: false,
			items: [],
		});
	});

	it("still lists the first page of /user/repos in range", async () => {
		const { status, body } = await call("/user/repos?page=1&per_page=100", {
			authorization: `token ${alice}`,
		});
		expect(status).toBe(200);
		expect(body.map((repo: { name: string }) => repo.name).sort()).toEqual([
			"one",
			"two",
		]);
	});
});
