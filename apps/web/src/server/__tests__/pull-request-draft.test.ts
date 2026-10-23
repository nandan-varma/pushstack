/**
 * @vitest-environment node
 *
 * Draft pull requests: opened as drafts over REST and the server functions,
 * unmergeable until marked ready, converted back, recorded on the timeline and
 * found by `draft:true`.
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
const files = await import("../files");
const pulls = await import("../pull-requests");
const repositories = await import("../repositories");

const users = await createUsers("alice", "bob");
const { asToken, call, mintToken, patch, post } = await import(
	"../../test/api-client"
);
const { parseSearchQuery } = await import("#/lib/search-query");

let alice: string;
let repoId: number;

async function branchWithCommit(branch: string) {
	signIn(users.alice);
	await files.createBranch({ data: { repoId, name: branch } });
	await files.uploadFile({
		data: {
			repoId,
			branchName: branch,
			path: `${branch}.txt`,
			content: btoa(branch),
			commitMessage: `Add ${branch}`,
		},
	});
}

async function openDraft(branch: string, draft: boolean | undefined) {
	await branchWithCommit(branch);
	return call(
		"/repos/alice/proj/pulls",
		post(alice, { title: branch, head: branch, base: "main", draft }),
	);
}

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	const created = await call(
		"/user/repos",
		post(alice, { name: "proj", auto_init: true }),
	);
	repoId = created.body.id;
	signIn(users.alice);
	await repositories.addCollaboratorByUsername({
		data: { repoId, username: "bob", role: "read" },
	});
});

describe("draft pull requests", () => {
	it("opens as a draft over REST, which cannot merge it (405)", async () => {
		const created = await openDraft("one", true);
		expect(created.status).toBe(201);
		expect(created.body.draft).toBe(true);
		const number = created.body.number;

		const merge = await call(`/repos/alice/proj/pulls/${number}/merge`, {
			...asToken(alice),
			method: "PUT",
			body: "{}",
		});
		expect(merge.status).toBe(405);
		expect(merge.body.message).toBe("Pull Request is still a draft");
		const got = await call(`/repos/alice/proj/pulls/${number}`);
		expect(got.body.draft).toBe(true);
		expect(got.body.mergeable_state).toBe("draft");
		expect(got.body.merged).toBe(false);
		const list = await call("/repos/alice/proj/pulls");
		expect(
			list.body.find((pull: { number: number }) => pull.number === number)
				.draft,
		).toBe(true);
	});

	it("defaults to a ready pull request and PATCH cannot change draft", async () => {
		const created = await openDraft("two", undefined);
		expect(created.body.draft).toBe(false);
		const updated = await call(
			`/repos/alice/proj/pulls/${created.body.number}`,
			patch(alice, { draft: true, title: "renamed" }),
		);
		expect(updated.status).toBe(200);
		expect(updated.body.draft).toBe(false);
	});

	it("marks ready, records ready_for_review, then merges", async () => {
		const created = await openDraft("three", true);
		const number = created.body.number;
		signIn(users.alice);
		const pr = await pulls.getPullRequestByNumber({
			data: { owner: "alice", name: "proj", number },
		});
		expect(pr.isDraft).toBe(true);
		await expect(
			pulls.mergePullRequest({ data: { prId: pr.id } }),
		).rejects.toThrow("Pull Request is still a draft");

		const ready = await pulls.setPullRequestDraftState({
			data: { prId: pr.id, draft: false },
		});
		expect(ready.isDraft).toBe(false);
		// Idempotent: marking a ready pull request ready records nothing more.
		await pulls.setPullRequestDraftState({
			data: { prId: pr.id, draft: false },
		});

		const events = await call(`/repos/alice/proj/issues/${number}/events`);
		expect(
			events.body
				.map((event: { event: string }) => event.event)
				.filter((name: string) => name.includes("ready")),
		).toEqual(["ready_for_review"]);

		const merge = await call(`/repos/alice/proj/pulls/${number}/merge`, {
			...asToken(alice),
			method: "PUT",
			body: "{}",
		});
		expect(merge.status).toBe(200);
	});

	it("converts back to a draft, recording convert_to_draft, and blocks the merge", async () => {
		const created = await openDraft("four", false);
		const number = created.body.number;
		signIn(users.alice);
		const pr = await pulls.getPullRequestByNumber({
			data: { owner: "alice", name: "proj", number },
		});
		const converted = await pulls.setPullRequestDraftState({
			data: { prId: pr.id, draft: true },
		});
		expect(converted.isDraft).toBe(true);
		const events = await call(`/repos/alice/proj/issues/${number}/events`);
		expect(events.body.at(-1).event).toBe("convert_to_draft");
		const merge = await call(`/repos/alice/proj/pulls/${number}/merge`, {
			...asToken(alice),
			method: "PUT",
			body: "{}",
		});
		expect(merge.status).toBe(405);
	});

	it("opens a draft from the web and filters with draft:true / draft:false", async () => {
		await branchWithCommit("five");
		signIn(users.alice);
		const web = await pulls.createPullRequest({
			data: {
				repoId,
				title: "five",
				sourceBranchName: "five",
				targetBranchName: "main",
				draft: true,
			},
		});
		expect(web.isDraft).toBe(true);

		const drafts = await pulls.getPullRequests({
			data: { repoId, query: "is:open draft:true" },
		});
		expect(drafts.map((pr) => pr.title)).toEqual(
			expect.arrayContaining(["one", "four", "five"]),
		);
		expect(drafts.every((pr) => pr.isDraft)).toBe(true);
		const ready = await pulls.getPullRequests({
			data: { repoId, query: "is:open draft:false" },
		});
		expect(ready.length).toBeGreaterThan(0);
		expect(ready.every((pr) => !pr.isDraft)).toBe(true);
		expect(ready.map((pr) => pr.title)).not.toContain("one");
	});

	it("limits who can change the state: the author or a writer, not a reader", async () => {
		signIn(users.alice);
		const pr = await pulls.getPullRequestByNumber({
			data: { owner: "alice", name: "proj", number: 1 },
		});
		signIn(users.bob);
		await expect(
			pulls.setPullRequestDraftState({ data: { prId: pr.id, draft: false } }),
		).rejects.toThrow("Access denied");
	});

	it("refuses to change a closed pull request", async () => {
		const created = await openDraft("six", true);
		const number = created.body.number;
		await call(
			`/repos/alice/proj/pulls/${number}`,
			patch(alice, { state: "closed" }),
		);
		signIn(users.alice);
		const pr = await pulls.getPullRequestByNumber({
			data: { owner: "alice", name: "proj", number },
		});
		await expect(
			pulls.setPullRequestDraftState({ data: { prId: pr.id, draft: false } }),
		).rejects.toThrow("Only an open pull request");
	});
});

describe("draft search qualifier", () => {
	it("parses draft:true and draft:false and rejects contradictions", () => {
		expect(parseSearchQuery("draft:true").draft).toBe(true);
		expect(parseSearchQuery("draft:false").draft).toBe(false);
		expect(parseSearchQuery("is:open").draft).toBeUndefined();
		expect(parseSearchQuery("draft:true draft:false").matchesNothing).toBe(
			true,
		);
		expect(parseSearchQuery("is:issue draft:true").matchesNothing).toBe(true);
	});
});
