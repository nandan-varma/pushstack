/**
 * @vitest-environment node
 *
 * GitHub-style timeline events: mentions become cross-references on the
 * mentioned thread, status changes and merges are recorded, and a merge that
 * closes an issue says which pull request closed it.
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
const repositories = await import("../repositories");
const files = await import("../files");
const issues = await import("../issues");
const labelFns = await import("../labels");
const pulls = await import("../pull-requests");
const comments = await import("../comments");
const { getTimeline } = await import("../timeline");

const users = await createUsers("owner", "reader");
let repoId: number;

const events = async (number: number) =>
	(await getTimeline({ data: { repoId, number } })).map(
		({ id: _id, createdAt: _at, actor, ...event }) => ({
			...event,
			actor: actor.username,
		}),
	);

beforeAll(async () => {
	signIn(users.owner);
	repoId = (await repositories.createRepository({ data: { name: "t" } })).id;
	await files.uploadFile({
		data: {
			repoId,
			branchName: "main",
			path: "a.txt",
			content: btoa("a\n"),
			commitMessage: "Initial",
		},
	});
});

describe("timeline", () => {
	it("records a mention once per source thread, from bodies and comments", async () => {
		signIn(users.owner);
		const target = await issues.createIssue({ data: { repoId, title: "Bug" } });
		const source = await issues.createIssue({
			data: { repoId, title: "Related", body: `Like #${target.number}` },
		});
		signIn(users.reader);
		await comments.createComment({
			data: {
				issueId: source.id,
				body: `Again #${target.number}, and \`#${target.number}\``,
			},
		});

		expect(await events(target.number)).toEqual([
			{
				event: "cross-referenced",
				source: { kind: "issue", number: source.number, title: "Related" },
				actor: "owner",
			},
		]);
	});

	it("records closing and reopening by hand", async () => {
		signIn(users.owner);
		const issue = await issues.createIssue({
			data: { repoId, title: "Flaky" },
		});
		await issues.updateIssue({ data: { issueId: issue.id, status: "closed" } });
		await issues.updateIssue({ data: { issueId: issue.id, status: "open" } });

		expect((await events(issue.number)).map((e) => e.event)).toEqual([
			"closed",
			"reopened",
		]);
	});

	it("records a merge, and says which pull request closed each issue", async () => {
		signIn(users.owner);
		const issue = await issues.createIssue({ data: { repoId, title: "Typo" } });
		await files.createBranch({ data: { repoId, name: "fix" } });
		await files.uploadFile({
			data: {
				repoId,
				branchName: "fix",
				path: "a.txt",
				content: btoa("b\n"),
				commitMessage: "Fix",
			},
		});
		const pr = await pulls.createPullRequest({
			data: {
				repoId,
				title: "Fix typo",
				body: `Fixes #${issue.number}`,
				sourceBranchName: "fix",
				targetBranchName: "main",
			},
		});
		const { commitSha } = await pulls.mergePullRequest({
			data: { prId: pr.id },
		});

		await pulls.deletePullRequestBranch({ data: { prId: pr.id } });
		expect(await events(pr.number)).toEqual([
			{ event: "merged", commitSha, base: "main", actor: "owner" },
			{ event: "head_ref_deleted", branch: "fix", actor: "owner" },
		]);
		expect(
			(await files.getBranches({ data: { repoId } })).map((b) => b.name),
		).toEqual(["main"]);
		expect(await events(issue.number)).toEqual([
			{
				event: "cross-referenced",
				source: { kind: "pull_request", number: pr.number, title: "Fix typo" },
				actor: "owner",
			},
			{
				event: "closed",
				closer: { kind: "pull_request", number: pr.number, title: "Fix typo" },
				stateReason: "completed",
				actor: "owner",
			},
		]);
	});

	it("lets a non-collaborator open issues on a public repository, unlabeled", async () => {
		signIn(users.reader);
		const issue = await issues.createIssue({
			data: { repoId, title: "Question", labels: ["bug"] },
		});
		expect(issue.labels).toEqual([]);
		await expect(
			labelFns.setLabels({
				data: { repoId, number: issue.number, labels: ["bug"] },
			}),
		).rejects.toThrow();
	});
});
