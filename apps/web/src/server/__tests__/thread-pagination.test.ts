/**
 * @vitest-environment node
 *
 * A thread's comments and timeline are read a bounded page at a time: a thread
 * full of maximum-size comments must not outgrow one function response.
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

const { createUsers, signIn } = await import("../../test/app-harness");
const { MAX_THREAD_PAGE_SIZE, THREAD_PAGE_SIZE } = await import("#/lib/limits");
const repositories = await import("../repositories");
const issues = await import("../issues");
const comments = await import("../comments");
const { getTimeline } = await import("../timeline");

const users = await createUsers("owner");
const COMMENTS = THREAD_PAGE_SIZE + 5;
let repoId: number;
let issue: Awaited<ReturnType<typeof issues.createIssue>>;

beforeAll(async () => {
	signIn(users.owner);
	repoId = (await repositories.createRepository({ data: { name: "t" } })).id;
	issue = await issues.createIssue({ data: { repoId, title: "Busy" } });
	for (let i = 1; i <= COMMENTS; i++) {
		await comments.createComment({
			data: { issueId: issue.id, body: `comment ${i}` },
		});
	}
});

describe("getComments", () => {
	it("returns the first page by default and the rest by skip, oldest first", async () => {
		const first = await comments.getComments({ data: { issueId: issue.id } });
		expect(first).toHaveLength(THREAD_PAGE_SIZE);
		expect(first[0]?.body).toBe("comment 1");
		const rest = await comments.getComments({
			data: { issueId: issue.id, skip: THREAD_PAGE_SIZE },
		});
		expect(rest.map((c) => c.body)).toEqual(
			Array.from(
				{ length: COMMENTS - THREAD_PAGE_SIZE },
				(_, i) => `comment ${THREAD_PAGE_SIZE + i + 1}`,
			),
		);
	});

	it("rejects a page larger than the response budget allows", async () => {
		await expect(
			comments.getComments({
				data: { issueId: issue.id, limit: MAX_THREAD_PAGE_SIZE + 1 },
			}),
		).rejects.toThrow();
	});
});

describe("getTimeline", () => {
	it("pages events with limit and skip", async () => {
		const number = issue.number;
		for (let i = 0; i < 3; i++) {
			await issues.updateIssue({
				data: { issueId: issue.id, status: i % 2 === 0 ? "closed" : "open" },
			});
		}
		const all = await getTimeline({ data: { repoId, number } });
		expect(all.length).toBeGreaterThanOrEqual(3);
		const page = await getTimeline({
			data: { repoId, number, limit: 1, skip: 1 },
		});
		expect(page.map((e) => e.id)).toEqual([all[1]?.id]);
		await expect(
			getTimeline({
				data: { repoId, number, limit: MAX_THREAD_PAGE_SIZE + 1 },
			}),
		).rejects.toThrow();
	});
});
