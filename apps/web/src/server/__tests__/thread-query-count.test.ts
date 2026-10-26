/**
 * @vitest-environment node
 *
 * Database round trips per issue/PR read: the lists and the detail views,
 * through both the web server functions and the REST API. Counted from the
 * logger every query passes through (the same SQL notes the perf tree
 * prints), so a regression to per-row or per-kind queries fails here.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

const queries = vi.hoisted(() => ({ count: 0 }));

vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb({
		onQuery: () => {
			queries.count++;
		},
	}),
}));
vi.mock("@tanstack/react-start", () => import("../../test/server-test-utils"));
vi.mock(
	"#/server/session",
	async () => (await import("../../test/app-harness")).sessionModule,
);

const { createUsers, signIn } = await import("../../test/app-harness");
const repositories = await import("../repositories");
const files = await import("../files");
const issues = await import("../issues");
const pulls = await import("../pull-requests");
const comments = await import("../comments");
const labels = await import("../labels");
const { call, mintToken } = await import("../../test/api-client");

const users = await createUsers("owner");
let repoId: number;
let token: string;
const THREADS = 12;

async function count(fn: () => Promise<unknown>): Promise<number> {
	const before = queries.count;
	await fn();
	return queries.count - before;
}

beforeAll(async () => {
	signIn(users.owner);
	repoId = (await repositories.createRepository({ data: { name: "q" } })).id;
	await files.uploadFile({
		data: {
			repoId,
			branchName: "main",
			path: "a.txt",
			content: btoa("a\n"),
			commitMessage: "Initial",
		},
	});
	for (let i = 0; i < THREADS; i++) {
		const issue = await issues.createIssue({
			data: { repoId, title: `Issue ${i}`, labels: ["bug"] },
		});
		await comments.createComment({ data: { issueId: issue.id, body: "hi" } });
		const branch = `b${i}`;
		await files.createBranch({ data: { repoId, name: branch } });
		await files.uploadFile({
			data: {
				repoId,
				branchName: branch,
				path: `${branch}.txt`,
				content: btoa(`${branch}\n`),
				commitMessage: branch,
			},
		});
		const pr = await pulls.createPullRequest({
			data: {
				repoId,
				title: `PR ${i}`,
				sourceBranchName: branch,
				targetBranchName: "main",
			},
		});
		await labels.setLabels({
			data: { repoId, number: pr.number, labels: ["enhancement"] },
		});
	}
	token = await mintToken(users.owner, ["repo:read"]);
});

describe("database queries per thread read", () => {
	it("is one thread query per read, however many threads a page holds", async () => {
		const auth = { authorization: `token ${token}` };
		const counts = {
			"web issues list": await count(() =>
				issues.getIssues({ data: { repoId } }),
			),
			"web pulls list": await count(() =>
				pulls.getPullRequests({ data: { repoId } }),
			),
			"web issue view": await count(() =>
				issues.getIssueByNumber({
					data: { owner: "owner", name: "q", number: 1 },
				}),
			),
			"web pull view": await count(() =>
				pulls.getPullRequestByNumber({
					data: { owner: "owner", name: "q", number: 2 },
				}),
			),
			"api issues list": await count(() => call("/repos/owner/q/issues", auth)),
			"api issues list page 2": await count(() =>
				call("/repos/owner/q/issues?per_page=5&page=2", auth),
			),
			"api pulls list": await count(() => call("/repos/owner/q/pulls", auth)),
			"api issue view": await count(() =>
				call("/repos/owner/q/issues/1", auth),
			),
			"api pull view": await count(() => call("/repos/owner/q/pulls/2", auth)),
		};
		console.log(`[db queries] ${JSON.stringify(counts, null, 2)}`);
		// One thread query per read (rows, labels, assignees, comment counts and
		// the total together); the rest is auth, access and the PR's extras (the
		// repository row, read once by the first list, is cached for the reads
		// after it, as on a page; writes never fill that cache). API
		// issue reads add one grouped query for the page's reaction rollups.
		// API pull reads also count the repository's open issues and PRs once,
		// for open_issues_count in the nested repository objects, and its
		// readable forks once, for forks_count (a fork's count is per viewer).
		expect(counts).toEqual({
			"web issues list": 2,
			"web pulls list": 1,
			"web issue view": 2,
			"web pull view": 2,
			"api issues list": 6,
			"api issues list page 2": 4,
			"api pulls list": 6,
			"api issue view": 4,
			"api pull view": 7,
		});
	});
});
