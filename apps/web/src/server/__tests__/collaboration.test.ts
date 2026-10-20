/**
 * @vitest-environment node
 *
 * Issues, pull requests, comments, search, profiles and git auth, end to end:
 * real Postgres (pglite), real git over git-fs.ts's in-memory store; only the
 * session is faked.
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

const { createUsers, rejectsNotFound, signIn, signOut } = await import(
	"../../test/app-harness"
);
const repositories = await import("../repositories");
const files = await import("../files");
const issues = await import("../issues");
const pulls = await import("../pull-requests");
const comments = await import("../comments");
const search = await import("../search");
const { getUserProfile } = await import("../users");
const tokens = await import("../tokens");
const { authorizeGitRequest } = await import("../git-auth");
const { findRepositoryByName } = await import("../repository-lookup");
const { getClosingIssueNumbers } = await import("../../lib/issue-references");

const users = await createUsers("maintainer", "contributor", "visitor");
let repoId: number;

beforeAll(async () => {
	signIn(users.maintainer);
	repoId = (await repositories.createRepository({ data: { name: "proj" } })).id;
	await repositories.addCollaboratorByUsername({
		data: { repoId, username: "contributor", role: "write" },
	});
	await files.uploadFile({
		data: {
			repoId,
			branchName: "main",
			path: "app.txt",
			content: btoa("one\ntwo\nthree\n"),
			commitMessage: "Initial",
		},
	});
});

describe("issues and pull requests", () => {
	it("share one #N sequence per repository", async () => {
		signIn(users.contributor);
		const issue = await issues.createIssue({
			data: { repoId, title: "Bug" },
		});
		await files.createBranch({ data: { repoId, name: "fix" } });
		await files.uploadFile({
			data: {
				repoId,
				branchName: "fix",
				path: "app.txt",
				content: btoa("one\nTWO\nthree\n"),
				commitMessage: "Fix two",
			},
		});
		const pr = await pulls.createPullRequest({
			data: {
				repoId,
				title: "Fix the bug",
				body: `Closes #${issue.number}`,
				sourceBranchName: "fix",
				targetBranchName: "main",
			},
		});
		expect([issue.number, pr.number]).toEqual([1, 2]);

		signOut();
		const byNumber = await pulls.getPullRequestByNumber({
			data: { owner: "maintainer", name: "proj", number: 2 },
		});
		expect(byNumber.author.username).toBe("contributor");
		expect(JSON.stringify(byNumber)).not.toContain("@example.com");
	});

	it("refuses a PR whose branches don't exist, or that targets itself", async () => {
		signIn(users.contributor);
		await expect(
			pulls.createPullRequest({
				data: {
					repoId,
					title: "x",
					sourceBranchName: "ghost",
					targetBranchName: "main",
				},
			}),
		).rejects.toThrow("Both branches must exist");
		await expect(
			pulls.createPullRequest({
				data: {
					repoId,
					title: "x",
					sourceBranchName: "main",
					targetBranchName: "main",
				},
			}),
		).rejects.toThrow("two different branches");
	});

	it("merges, closes the referenced issue, and is idempotent", async () => {
		signIn(users.maintainer);
		const pr = await pulls.getPullRequestByNumber({
			data: { owner: "maintainer", name: "proj", number: 2 },
		});
		const { commitSha } = await pulls.mergePullRequest({
			data: { prId: pr.id },
		});
		expect(commitSha).toMatch(/^[0-9a-f]{40}$/);

		const merged = await pulls.getPullRequestByNumber({
			data: { owner: "maintainer", name: "proj", number: 2 },
		});
		expect(merged).toMatchObject({
			status: "merged",
			mergeCommitSha: commitSha,
		});
		const issue = await issues.getIssueByNumber({
			data: { owner: "maintainer", name: "proj", number: 1 },
		});
		expect(issue.status).toBe("closed");
		const view = await files.getFile({
			data: { repoId, branchName: "main", path: "app.txt" },
		});
		expect(view).toMatchObject({ content: "one\nTWO\nthree\n" });

		await expect(
			pulls.mergePullRequest({ data: { prId: pr.id } }),
		).rejects.toThrow("not open");
		await expect(
			pulls.updatePullRequest({ data: { prId: pr.id, status: "open" } }),
		).rejects.toThrow("merged pull request");
	});

	it("only the author or a writer edits an issue", async () => {
		signIn(users.visitor);
		const issue = await issues.getIssueByNumber({
			data: { owner: "maintainer", name: "proj", number: 1 },
		});
		await expect(
			issues.updateIssue({ data: { issueId: issue.id, title: "hijack" } }),
		).rejects.toThrow("Access denied");
		signIn(users.contributor);
		const reopened = await issues.updateIssue({
			data: { issueId: issue.id, status: "open" },
		});
		expect(reopened).toMatchObject({ status: "open", closedAt: null });
	});
});

describe("comments", () => {
	it("attaches to one thread, lets any signed-in reader comment, and hides author emails", async () => {
		signIn(users.contributor);
		const issue = await issues.getIssueByNumber({
			data: { owner: "maintainer", name: "proj", number: 1 },
		});
		await comments.createComment({
			data: { issueId: issue.id, body: "On it" },
		});
		signOut();
		const list = await comments.getComments({ data: { issueId: issue.id } });
		expect(list.map((c) => [c.author.username, c.body])).toEqual([
			["contributor", "On it"],
		]);
		expect(JSON.stringify(list)).not.toContain("@example.com");

		signIn(users.visitor);
		await comments.createComment({
			data: { issueId: issue.id, body: "Same here" },
		});

		signIn(users.maintainer);
		const secret = await repositories.createRepository({
			data: { name: "secret", visibility: "private" },
		});
		const hidden = await issues.createIssue({
			data: { repoId: secret.id, title: "Internal" },
		});
		signIn(users.visitor);
		await expect(
			comments.createComment({ data: { issueId: hidden.id, body: "hi" } }),
		).rejects.toThrow();
		expect(
			await rejectsNotFound(
				comments.getComments({ data: { issueId: 999_999 } }),
			),
		).toBe(true);
	});

	it("rejects naming both an issue and a pull request", async () => {
		signIn(users.contributor);
		await expect(
			comments.createComment({
				data: { issueId: 1, pullRequestId: 1, body: "x" } as never,
			}),
		).rejects.toThrow();
	});
});

describe("search, activity and profiles", () => {
	it("finds repositories and users without leaking private data", async () => {
		signOut();
		const repos = await search.searchRepositories({ data: { query: "pro" } });
		expect(repos.map((r) => r.name)).toEqual(["proj"]);
		const found = await search.searchUsers({ data: { query: "contrib" } });
		expect(found).toEqual([
			{
				id: users.contributor.id,
				apiId: expect.any(Number),
				username: "contributor",
				name: "Contributor",
				image: null,
			},
		]);
	});

	it("treats LIKE wildcards in a query literally", async () => {
		signOut();
		expect(await search.searchRepositories({ data: { query: "%" } })).toEqual(
			[],
		);
	});

	it("links activity to the thread it happened on", async () => {
		signOut();
		const profile = await getUserProfile({ data: { username: "contributor" } });
		const types = profile.activities.map((a) => a.type);
		expect(types).toEqual(
			expect.arrayContaining(["issue", "pr", "comment", "commit"]),
		);
		const comment = profile.activities.find((a) => a.type === "comment");
		expect(comment?.metadata).toEqual({ on: "issue", number: 1 });
		expect(comment?.repository?.owner.username).toBe("maintainer");
	});
});

describe("git over HTTP auth (personal access tokens)", () => {
	const basic = (token: string) =>
		new Request("http://x/", {
			headers: { authorization: `Basic ${btoa(`git:${token}`)}` },
		});

	it("authorizes by token scope and repository role", async () => {
		const repo = await findRepositoryByName("maintainer", "proj");
		if (!repo) throw new Error("repo");
		signIn(users.contributor);
		const read = await tokens.createToken({
			data: { name: "read", scopes: ["repo:read"], lifetimeDays: null },
		});
		const write = await tokens.createToken({
			data: { name: "write", scopes: ["repo:write"], lifetimeDays: 30 },
		});

		await expect(
			authorizeGitRequest(basic(read.token), repo, false),
		).resolves.toMatchObject({
			userId: users.contributor.id,
			canWrite: false,
		});
		await expect(
			authorizeGitRequest(basic(read.token), repo, true),
		).rejects.toMatchObject({
			statusCode: 403,
		});
		await expect(
			authorizeGitRequest(basic(write.token), repo, true),
		).resolves.toMatchObject({
			canWrite: true,
		});
	});

	it("401s bad or missing credentials, and never accepts a password", async () => {
		const repo = await findRepositoryByName("maintainer", "proj");
		if (!repo) throw new Error("repo");
		await expect(
			authorizeGitRequest(basic("pst_nope"), repo, false),
		).rejects.toMatchObject({
			statusCode: 401,
		});
		await expect(
			authorizeGitRequest(basic("hunter2"), repo, false),
		).rejects.toMatchObject({
			statusCode: 401,
		});
		await expect(
			authorizeGitRequest(new Request("http://x/"), repo, true),
		).rejects.toMatchObject({
			statusCode: 401,
		});
		await expect(
			authorizeGitRequest(new Request("http://x/"), repo, false),
		).resolves.toMatchObject({ userId: null, canRead: true });
	});
});

describe("getClosingIssueNumbers", () => {
	it("extracts explicit closing references without duplicates", () => {
		expect(
			getClosingIssueNumbers("Fixes #2, closes issue #3, and resolves #2."),
		).toEqual([2, 3]);
	});

	it("ignores ordinary references", () => {
		expect(getClosingIssueNumbers("Related to #2.")).toEqual([]);
		expect(getClosingIssueNumbers(null)).toEqual([]);
	});
});

describe("browsing a repository nobody has pushed to", () => {
	it("returns an empty tree page instead of a 404 for the default branch", async () => {
		signIn(users.maintainer);
		const empty = await repositories.createRepository({
			data: { name: "fresh" },
		});
		const page = await files.getTreePageData({
			data: { repoId: empty.id, branchName: "main", path: "" },
		});
		expect(page).toEqual({ branches: [], files: [], latestCommit: undefined });
	});

	it("still 404s a missing branch once the repository has commits", async () => {
		signIn(users.maintainer);
		await rejectsNotFound(
			files.getTreePageData({
				data: { repoId, branchName: "no-such-branch", path: "" },
			}),
		);
	});
});

describe("tags", () => {
	it("lists tags and browses a tag like a branch", async () => {
		const git = (await import("isomorphic-git")).default;
		const { repoFor } = await import("../git-repo");
		signIn(users.maintainer);
		const repo = repoFor("maintainer", "proj");
		const head = await git.resolveRef({ ...repo, ref: "refs/heads/main" });
		await git.tag({ ...repo, ref: "v1.0", object: head });

		const tags = await files.getTags({ data: { repoId } });
		expect(tags).toEqual([{ name: "v1.0", commit: head }]);

		const page = await files.getTreePageData({
			data: { repoId, branchName: "v1.0", path: "" },
		});
		expect(page.files.map((f) => f.path)).toContain("app.txt");
	});
});

describe("commit pages", () => {
	it("resolve a branch, tag, HEAD or abbreviated sha to the same commit", async () => {
		const git = (await import("isomorphic-git")).default;
		const { repoFor } = await import("../git-repo");
		signIn(users.maintainer);
		const repo = repoFor("maintainer", "proj");
		const head = await git.resolveRef({ ...repo, ref: "refs/heads/main" });
		await git.tag({ ...repo, ref: "v-commit", object: head });

		for (const rev of ["main", "v-commit", "HEAD", head, head.slice(0, 7)]) {
			const commit = await files.getCommit({ data: { repoId, rev } });
			expect(commit.sha).toBe(head);
		}
		const diff = await files.getCommitDiff({
			data: { repoId, commitSha: head },
		});
		expect(diff.files.length).toBeGreaterThan(0);
	});

	it("404 a revision that names nothing or is unsafe", async () => {
		signIn(users.maintainer);
		for (const rev of [
			"no-such-branch",
			"0000000",
			"a..b",
			"refs/heads/main",
		]) {
			expect(
				await rejectsNotFound(files.getCommit({ data: { repoId, rev } })),
			).toBe(true);
		}
	});
});
