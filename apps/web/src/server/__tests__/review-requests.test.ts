/**
 * @vitest-environment node
 *
 * Review requests end to end: the REST endpoints, `requested_reviewers` on the
 * pull request, timeline events, notifications, CODEOWNERS auto-requests, the
 * submit-clears rule and the `review-requested:` / `reviewed-by:` search.
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
const repositories = await import("../repositories");
const reviews = await import("../reviews");
const pullRequests = await import("../pull-requests");
const requests = await import("../review-requests");
const { BASE, asToken, call, mintToken, post } = await import(
	"../../test/api-client"
);

const users = await createUsers("alice", "bob", "dave", "erin", "frank");
const del = (token: string, body: unknown) => ({
	...asToken(token),
	method: "DELETE",
	body: JSON.stringify(body),
});

let alice: string;
let bob: string;
let dave: string;
let repoId: number;

async function upload(branch: string, path: string, content: string) {
	signIn(users.alice);
	await files.uploadFile({
		data: {
			repoId,
			branchName: branch,
			path,
			content: btoa(content),
			commitMessage: `Add ${path}`,
		},
	});
}

async function openPull(head: string, path: string, title = head) {
	signIn(users.alice);
	await files.createBranch({ data: { repoId, name: head } });
	await upload(head, path, "x\n");
	const { status, body } = await call(
		"/repos/alice/proj/pulls",
		post(alice, { title, head, base: "main" }),
	);
	expect(status).toBe(201);
	return body;
}

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	bob = await mintToken(users.bob, ["repo:write"]);
	dave = await mintToken(users.dave, ["repo:write"]);
	await mintToken(users.erin, ["repo:write"]);
	await call(
		"/user/repos",
		post(alice, { name: "proj", auto_init: true }),
	).then((r) => {
		repoId = r.body.id;
	});
	signIn(users.alice);
	await repositories.addCollaboratorByUsername({
		data: { repoId, username: "bob", role: "read" },
	});
	await repositories.addCollaboratorByUsername({
		data: { repoId, username: "dave", role: "write" },
	});
	await repositories.addCollaboratorByUsername({
		data: { repoId, username: "erin", role: "write" },
	});
});

describe("requesting reviewers over REST", () => {
	it("requests, lists, shows on the pull request and records events", async () => {
		const pr = await openPull("one", "one.md");
		expect(pr.requested_reviewers).toEqual([]);

		const requested = await call(
			"/repos/alice/proj/pulls/1/requested_reviewers",
			post(alice, { reviewers: ["bob", "Dave"] }),
		);
		expect(requested.status).toBe(201);
		expect(
			requested.body.requested_reviewers.map((u: { login: string }) => u.login),
		).toEqual(["bob", "dave"]);
		expect(requested.body.requested_teams).toEqual([]);

		const list = await call("/repos/alice/proj/pulls/1/requested_reviewers");
		expect(list.status).toBe(200);
		expect(list.body.users.map((u: { login: string }) => u.login)).toEqual([
			"bob",
			"dave",
		]);
		expect(list.body.teams).toEqual([]);

		const get = await call("/repos/alice/proj/pulls/1");
		expect(get.body.requested_reviewers).toHaveLength(2);
		const listed = await call("/repos/alice/proj/pulls");
		expect(listed.body[0].requested_reviewers).toHaveLength(2);

		const events = await call("/repos/alice/proj/issues/1/events");
		const reviewEvents = events.body.filter(
			(e: { event: string }) => e.event === "review_requested",
		);
		expect(reviewEvents).toHaveLength(2);
		expect(reviewEvents[0]).toMatchObject({
			review_requester: { login: "alice" },
			requested_reviewer: { login: "bob" },
			actor: { login: "alice" },
		});
		const timeline = await call("/repos/alice/proj/issues/1/timeline");
		expect(
			timeline.body.filter(
				(e: { event: string }) => e.event === "review_requested",
			),
		).toHaveLength(2);
	});

	it("is idempotent: asking again adds no event", async () => {
		await call(
			"/repos/alice/proj/pulls/1/requested_reviewers",
			post(alice, { reviewers: ["bob"] }),
		);
		const events = await call("/repos/alice/proj/issues/1/events");
		expect(
			events.body.filter(
				(e: { event: string }) => e.event === "review_requested",
			),
		).toHaveLength(2);
	});

	it("notifies the requested reviewer with reason review_requested", async () => {
		const inbox = await call("/notifications", asToken(dave));
		const entry = inbox.body.find(
			(n: { subject: { title: string } }) => n.subject.title === "one",
		);
		expect(entry?.reason).toBe("review_requested");
	});

	it("removes a request and records review_request_removed", async () => {
		const removed = await call(
			"/repos/alice/proj/pulls/1/requested_reviewers",
			del(alice, { reviewers: ["bob"] }),
		);
		expect(removed.status).toBe(200);
		expect(
			removed.body.requested_reviewers.map((u: { login: string }) => u.login),
		).toEqual(["dave"]);
		const events = await call("/repos/alice/proj/issues/1/events");
		expect(
			events.body.find(
				(e: { event: string }) => e.event === "review_request_removed",
			),
		).toMatchObject({ requested_reviewer: { login: "bob" } });
	});

	it("422s unknown users, strangers, the author, teams, empty and unrequested removals", async () => {
		const path = "/repos/alice/proj/pulls/1/requested_reviewers";
		for (const reviewers of [["nobody"], ["frank"]]) {
			const r = await call(path, post(alice, { reviewers }));
			expect(r.status).toBe(422);
			expect(r.body.message).toContain("not a collaborator of the alice/proj");
		}
		const self = await call(path, post(alice, { reviewers: ["alice"] }));
		expect(self.status).toBe(422);
		expect(self.body.message).toBe(
			"Review cannot be requested from pull request author.",
		);
		const team = await call(path, post(alice, { team_reviewers: ["core"] }));
		expect(team.status).toBe(422);
		const empty = await call(path, post(alice, {}));
		expect(empty.status).toBe(422);
		const unrequested = await call(path, del(alice, { reviewers: ["erin"] }));
		expect(unrequested.status).toBe(422);
	});

	it("limits who may manage requests: author or write access", async () => {
		const path = "/repos/alice/proj/pulls/1/requested_reviewers";
		const asReader = await call(path, post(bob, { reviewers: ["erin"] }));
		expect(asReader.status).toBe(403);
		const asWriter = await call(path, post(dave, { reviewers: ["erin"] }));
		expect(asWriter.status).toBe(201);
		const anonymous = await call(path, {
			method: "POST",
			body: JSON.stringify({ reviewers: ["bob"] }),
		});
		expect(anonymous.status).toBe(401);
		const missing = await call(
			"/repos/alice/proj/pulls/99/requested_reviewers",
			post(alice, { reviewers: ["bob"] }),
		);
		expect(missing.status).toBe(404);
	});
});

describe("submitting a review", () => {
	it("clears the reviewer's request, and a re-request is allowed", async () => {
		const prs = await call("/repos/alice/proj/pulls/1");
		const prId = (await pullRequests.getPullRequestByNumber({
			data: { owner: "alice", name: "proj", number: prs.body.number },
		})) as { id: number };
		signIn(users.dave);
		await reviews.submitReview({
			data: { prId: prId.id, event: "approve", body: "lgtm" },
		});
		const after = await call("/repos/alice/proj/pulls/1");
		expect(
			after.body.requested_reviewers.map((u: { login: string }) => u.login),
		).toEqual(["erin"]);

		const again = await call(
			"/repos/alice/proj/pulls/1/requested_reviewers",
			post(alice, { reviewers: ["dave"] }),
		);
		expect(again.status).toBe(201);
		expect(again.body.requested_reviewers).toHaveLength(2);
	});
});

describe("CODEOWNERS", () => {
	it("auto-requests owners of the changed paths when a pull request opens", async () => {
		await upload(
			"main",
			".github/CODEOWNERS",
			"# owners\n* @erin\n/docs/ @dave @frank @alice\n*.lock\n",
		);
		const touched = await openPull("owned", "docs/guide.md", "Docs");
		expect(
			touched.requested_reviewers.map((u: { login: string }) => u.login),
		).toEqual(["dave"]);
		// frank is no collaborator and alice is the author: both skipped.
		const events = await call(
			`/repos/alice/proj/issues/${touched.number}/events`,
		);
		expect(
			events.body.filter(
				(e: { event: string }) => e.event === "review_requested",
			),
		).toHaveLength(1);

		const other = await openPull("plain", "src.md", "Plain");
		expect(
			other.requested_reviewers.map((u: { login: string }) => u.login),
		).toEqual(["erin"]);

		const unowned = await openPull("locked", "yarn.lock", "Lock");
		expect(unowned.requested_reviewers).toEqual([]);
	});

	it("requests owners for pull requests opened from the web UI too", async () => {
		signIn(users.alice);
		await files.createBranch({ data: { repoId, name: "web" } });
		await upload("web", "docs/web.md", "w\n");
		const created = await pullRequests.createPullRequest({
			data: {
				repoId,
				title: "Web",
				sourceBranchName: "web",
				targetBranchName: "main",
			},
		});
		const view = await pullRequests.getPullRequestByNumber({
			data: { owner: "alice", name: "proj", number: created.number },
		});
		expect(view.requestedReviewers.map((u) => u.username)).toEqual(["dave"]);
	});

	it("waits for a draft to be marked ready for review", async () => {
		signIn(users.alice);
		await files.createBranch({ data: { repoId, name: "draft" } });
		await upload("draft", "docs/draft.md", "d\n");
		const created = await pullRequests.createPullRequest({
			data: {
				repoId,
				title: "Draft",
				sourceBranchName: "draft",
				targetBranchName: "main",
				draft: true,
			},
		});
		const read = () =>
			pullRequests.getPullRequestByNumber({
				data: { owner: "alice", name: "proj", number: created.number },
			});
		expect((await read()).requestedReviewers).toEqual([]);
		await pullRequests.setPullRequestDraftState({
			data: { prId: created.id, draft: false },
		});
		expect((await read()).requestedReviewers.map((u) => u.username)).toEqual([
			"dave",
		]);
	});

	it("reports a file's owners for the blob view", async () => {
		signIn(users.alice);
		const owners = await requests.getFileOwners({
			data: { repoId, branchName: "main", path: "docs/a.md" },
		});
		expect(owners).toMatchObject({
			file: ".github/CODEOWNERS",
			pattern: "/docs/",
			owners: ["dave", "frank", "alice"],
		});
		expect(
			await requests.getFileOwners({
				data: { repoId, branchName: "main", path: "x.lock" },
			}),
		).toMatchObject({ owners: [] });
	});
});

describe("review search", () => {
	it("filters pull requests by review-requested and reviewed-by, with @me", async () => {
		signIn(users.erin);
		const numbers = async (query: string) =>
			(await pullRequests.getPullRequests({ data: { repoId, query } })).map(
				(p) => p.number,
			);
		const mine = await numbers("is:open review-requested:@me");
		expect(mine).toContain(1);
		expect(await numbers("is:open review-requested:dave")).toContain(1);
		expect(await numbers("is:open reviewed-by:dave")).toEqual([1]);
		expect(await numbers("is:open reviewed-by:erin")).toEqual([]);
		signIn(users.frank);
		expect(await numbers("review-requested:@me")).toEqual([]);
	});
});

describe("the candidate list", () => {
	it("offers the owner and collaborators", async () => {
		signIn(users.alice);
		const candidates = await requests.getReviewerCandidates({
			data: { repoId },
		});
		expect(candidates.map((u) => u.username)).toEqual([
			"alice",
			"bob",
			"dave",
			"erin",
		]);
		expect(BASE).toBeTruthy();
	});
});
