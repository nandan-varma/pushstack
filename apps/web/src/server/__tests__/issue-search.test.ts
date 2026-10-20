/**
 * @vitest-environment node
 *
 * GitHub's issue/PR query syntax end to end: the server functions parse the
 * `?q=` string with `#/lib/search-query` and filter on it. Covers `is:`,
 * `label:`, `no:label`, `author:`, `assignee:`, `no:assignee`, `mentions:`,
 * free text, `sort:` and unknown qualifiers.
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
const pulls = await import("../pull-requests");
const assignees = await import("../assignees");
const comments = await import("../comments");

const users = await createUsers("owner", "alice", "bob", "carol", "carol2");
let repoId: number;
let crashId: number;
let featureId: number;

const issueTitles = async (query: string) =>
	(await issues.getIssues({ data: { repoId, query } })).map((i) => i.title);
const pullTitles = async (query: string) =>
	(await pulls.getPullRequests({ data: { repoId, query } })).map(
		(p) => p.title,
	);
const sorted = (values: string[]) =>
	[...values].sort((a, b) => a.localeCompare(b));

beforeAll(async () => {
	signIn(users.owner);
	repoId = (await repositories.createRepository({ data: { name: "search" } }))
		.id;
	await repositories.addCollaboratorByUsername({
		data: { repoId, username: users.alice.username, role: "write" },
	});
	await files.uploadFile({
		data: {
			repoId,
			branchName: "main",
			path: "a.txt",
			content: btoa("a\n"),
			commitMessage: "Initial",
		},
	});

	// Issues, oldest first: crash, feature, plain, alice's, bob's, carol2's.
	crashId = (
		await issues.createIssue({
			data: {
				repoId,
				title: "Crash on start",
				body: "The app crashes",
				labels: ["bug"],
			},
		})
	).id;
	featureId = (
		await issues.createIssue({
			data: {
				repoId,
				title: "Add search",
				body: "Search the issues",
				labels: ["enhancement"],
			},
		})
	).id;
	const plainId = (
		await issues.createIssue({
			data: {
				repoId,
				title: "Plain idea",
				body: "See http://example.com for context",
			},
		})
	).id;
	signIn(users.alice);
	await issues.createIssue({
		data: { repoId, title: "Alice report", body: "hello" },
	});
	signIn(users.bob);
	await issues.createIssue({
		data: { repoId, title: "Bob report", body: "cc @carol" },
	});
	await issues.createIssue({
		data: { repoId, title: "Carol2 report", body: "cc @carol2" },
	});

	// Assign one issue; comment on two (feature gets two, plain one).
	signIn(users.owner);
	await assignees.setIssueAssignees({
		data: { issueId: crashId, usernames: [users.alice.username] },
	});
	await comments.createComment({
		data: { issueId: featureId, body: "ping @carol" },
	});
	await comments.createComment({
		data: { issueId: featureId, body: "still here" },
	});
	await comments.createComment({ data: { issueId: plainId, body: "noted" } });

	// Close feature last, so it also has the newest `updatedAt`.
	await issues.updateIssue({ data: { issueId: featureId, status: "closed" } });

	// Pull requests: one merged, one open.
	await files.createBranch({ data: { repoId, name: "merged" } });
	await files.uploadFile({
		data: {
			repoId,
			branchName: "merged",
			path: "m.txt",
			content: btoa("m\n"),
			commitMessage: "Merged work",
		},
	});
	const merged = await pulls.createPullRequest({
		data: {
			repoId,
			title: "Merged PR",
			sourceBranchName: "merged",
			targetBranchName: "main",
		},
	});
	await pulls.mergePullRequest({ data: { prId: merged.id } });

	await files.createBranch({ data: { repoId, name: "open" } });
	await files.uploadFile({
		data: {
			repoId,
			branchName: "open",
			path: "o.txt",
			content: btoa("o\n"),
			commitMessage: "Open work",
		},
	});
	await pulls.createPullRequest({
		data: {
			repoId,
			title: "Open PR",
			sourceBranchName: "open",
			targetBranchName: "main",
		},
	});
});

describe("issue search", () => {
	it("selects by state and matches nothing on contradictory is: filters", async () => {
		expect(sorted(await issueTitles("is:open"))).toEqual(
			sorted([
				"Crash on start",
				"Plain idea",
				"Alice report",
				"Bob report",
				"Carol2 report",
			]),
		);
		expect(await issueTitles("is:closed")).toEqual(["Add search"]);
		expect(sorted(await issueTitles("is:all"))).toEqual(
			sorted([
				"Crash on start",
				"Add search",
				"Plain idea",
				"Alice report",
				"Bob report",
				"Carol2 report",
			]),
		);
		expect(await issueTitles("is:open is:closed")).toEqual([]);
		// A pull request is not an issue.
		expect(await issueTitles("is:pr")).toEqual([]);
	});

	it("filters by label (AND) and no:label", async () => {
		expect(await issueTitles("label:bug")).toEqual(["Crash on start"]);
		expect(await issueTitles("label:BUG")).toEqual(["Crash on start"]);
		expect(await issueTitles("label:bug label:enhancement")).toEqual([]);
		expect(sorted(await issueTitles("no:label"))).toEqual(
			sorted(["Plain idea", "Alice report", "Bob report", "Carol2 report"]),
		);
	});

	it("filters by author", async () => {
		expect(await issueTitles("author:alice")).toEqual(["Alice report"]);
		expect(sorted(await issueTitles("author:owner"))).toEqual(
			sorted(["Crash on start", "Plain idea"]),
		);
	});

	it("filters by assignee and no:assignee", async () => {
		expect(await issueTitles("assignee:alice")).toEqual(["Crash on start"]);
		expect(sorted(await issueTitles("no:assignee"))).toEqual(
			sorted(["Plain idea", "Alice report", "Bob report", "Carol2 report"]),
		);
	});

	it("filters by mentions in the body and in comments", async () => {
		expect(sorted(await issueTitles("is:all mentions:carol"))).toEqual(
			sorted(["Add search", "Bob report"]),
		);
		// `@carol2` is a different mention, not `@carol`.
		expect(await issueTitles("mentions:carol2")).toEqual(["Carol2 report"]);
	});

	it("searches free text over the title and body", async () => {
		expect(await issueTitles("crash")).toEqual(["Crash on start"]);
		expect(await issueTitles("app crashes")).toEqual(["Crash on start"]);
		expect(await issueTitles("zzzznomatch")).toEqual([]);
	});

	it("applies the requested sort order", async () => {
		expect(await issueTitles("is:all sort:created-asc")).toEqual([
			"Crash on start",
			"Add search",
			"Plain idea",
			"Alice report",
			"Bob report",
			"Carol2 report",
		]);
		expect(await issueTitles("is:all sort:created-desc")).toEqual([
			"Carol2 report",
			"Bob report",
			"Alice report",
			"Plain idea",
			"Add search",
			"Crash on start",
		]);
		const byComments = await issueTitles("is:all sort:comments-desc");
		expect(byComments[0]).toBe("Add search");
		expect((await issueTitles("is:all sort:comments-asc")).at(-1)).toBe(
			"Add search",
		);
		expect((await issueTitles("is:all sort:updated-desc"))[0]).toBe(
			"Add search",
		);
		expect((await issueTitles("is:all sort:updated-asc"))[0]).toBe(
			"Crash on start",
		);
	});

	it("searches an unknown qualifier as text instead of dropping it", async () => {
		// An unquoted URL is not a qualifier: it is searched for.
		expect(await issueTitles("http://example.com")).toEqual(["Plain idea"]);
		// A token that matches nothing filters the list; it does not silently
		// match everything.
		expect(await issueTitles("is:all milestone:v1")).toEqual([]);
	});
});

describe("pull request search", () => {
	it("selects the type and filters by state", async () => {
		expect(sorted(await pullTitles("is:all"))).toEqual(
			sorted(["Merged PR", "Open PR"]),
		);
		expect(await pullTitles("is:merged")).toEqual(["Merged PR"]);
		expect(await pullTitles("is:open")).toEqual(["Open PR"]);
		// An issue is not a pull request.
		expect(await pullTitles("is:issue")).toEqual([]);
	});

	it("filters pull requests by author", async () => {
		expect(sorted(await pullTitles("is:all author:owner"))).toEqual(
			sorted(["Merged PR", "Open PR"]),
		);
		expect(await pullTitles("is:all author:alice")).toEqual([]);
	});
});
