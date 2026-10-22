/** @vitest-environment node */
import { beforeAll, describe, expect, it, vi } from "vitest";

const { queries } = vi.hoisted(() => ({ queries: [] as string[] }));
vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb({
		onQuery: (query) => queries.push(query),
	}),
}));
vi.mock("@tanstack/react-start", () => import("../../test/server-test-utils"));
vi.mock(
	"#/server/session",
	async () => (await import("../../test/app-harness")).sessionModule,
);

const { createUsers } = await import("../../test/app-harness");
const { db } = await import("../../db");
const { issues } = await import("../../db/app-schema");
const { eq } = await import("drizzle-orm");
const { call, mintToken, post, asToken } = await import(
	"../../test/api-client"
);
const { openIssueCounts } = await import("../api/repos");
const users = await createUsers("alice");
let token: string;
let repoId: number;
let openPullId: number;

function countQueries() {
	return queries.filter(
		(query) =>
			query.includes('from "issues"') &&
			query.includes('group by "issues"."repo_id"'),
	);
}

beforeAll(async () => {
	token = await mintToken(users.alice, ["repo:write"]);
	for (const name of ["populated", "empty", "other"]) {
		const created = await call("/user/repos", post(token, { name }));
		expect(created.status).toBe(201);
		expect(created.body.open_issues_count).toBe(0);
		if (name === "empty") continue;
		const id = created.body.id;
		const rows = await db
			.insert(issues)
			.values(
				[false, false, true, true].map((isPullRequest, index) => ({
					repoId: id,
					number: index + 1,
					isPullRequest,
					authorId: users.alice.id,
					title: "thread",
					status: index % 2 === 0 ? ("open" as const) : ("closed" as const),
				})),
			)
			.returning();
		if (name === "populated") {
			repoId = id;
			openPullId = rows[2].id;
		}
	}
});

describe("repository open_issues_count", () => {
	it("includes open issues and pull requests, excludes closed threads, and reflects state changes", async () => {
		expect((await call("/repos/alice/populated")).body.open_issues_count).toBe(
			2,
		);
		await db
			.update(issues)
			.set({ status: "closed" })
			.where(eq(issues.id, openPullId));
		expect((await call("/repos/alice/populated")).body.open_issues_count).toBe(
			1,
		);
		await db
			.update(issues)
			.set({ status: "open" })
			.where(eq(issues.id, openPullId));
		expect((await call("/repos/alice/populated")).body.open_issues_count).toBe(
			2,
		);
		expect((await call("/repos/alice/empty")).body.open_issues_count).toBe(0);
	});

	it("uses one grouped count query per page for both repository listings", async () => {
		for (const path of ["/users/alice/repos", "/user/repos"]) {
			queries.length = 0;
			const response = await call(path, asToken(token));
			expect(response.status).toBe(200);
			expect(
				response.body.map(
					(repo: { name: string; open_issues_count: number }) => [
						repo.name,
						repo.open_issues_count,
					],
				),
			).toEqual([
				["empty", 0],
				["other", 2],
				["populated", 2],
			]);
			expect(countQueries()).toHaveLength(1);
			expect(countQueries()[0]).toContain('"issues"."repo_id" in ($1, $2, $3)');
		}
	});

	it("skips the count query on empty pages and counts only the requested repositories", async () => {
		queries.length = 0;
		expect((await call("/users/alice/repos?page=2")).body).toEqual([]);
		expect(countQueries()).toHaveLength(0);
		queries.length = 0;
		expect(await openIssueCounts([repoId])).toEqual(new Map([[repoId, 2]]));
		expect(countQueries()).toHaveLength(1);
	});
});
