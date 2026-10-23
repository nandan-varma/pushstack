/**
 * @vitest-environment node
 *
 * The real `/api/v3` dispatcher's responses against `@pushstack/api-contract`:
 * one scenario touches every endpoint, and each success body is parsed with
 * its operation's response schema. Every other API test validates its success
 * responses too (`test/api-client.ts`); this one guarantees full coverage.
 */
import { endpoints, type Method, matchRoute } from "@pushstack/api-contract";
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
const { asToken, call, mintToken, patch, post } = await import(
	"../../test/api-client"
);

const users = await createUsers("alice", "bob");

const drift = new Map<string, string>();
const covered = new Set<string>();

async function check(path: string, options: Parameters<typeof call>[1] = {}) {
	const method = (options.method ?? "GET") as Method;
	const result = await call(path, options);
	const match = matchRoute(method, new URL(path, "http://x").pathname);
	if (!match) throw new Error(`no contract operation for ${method} ${path}`);
	const endpoint = endpoints[match.id];
	expect(result.status, `${method} ${path}`).toBe(
		"status" in endpoint ? endpoint.status : 200,
	);
	covered.add(match.id);
	const parsed = endpoint.response.safeParse(result.body);
	if (!parsed.success && !drift.has(match.id)) {
		drift.set(
			match.id,
			parsed.error.issues
				.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
				.join("; "),
		);
	}
	return result.body;
}

const put = (token: string, body?: unknown) => ({
	...asToken(token),
	method: "PUT",
	body: body === undefined ? undefined : JSON.stringify(body),
});
const del = (token: string) => ({ ...asToken(token), method: "DELETE" });

/**
 * Where the server disagrees with the contract today. Serializers return the
 * contract's types, so new drift is usually a type error before it gets here.
 */
const KNOWN_DRIFT: Record<string, RegExp> = {};

let alice: string;

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	const auth = asToken(alice);

	await check("/", auth);
	await check("/rate_limit", auth);
	const me = await check("/user", auth);
	await check(`/user/${me.id}`);
	await check("/users/alice");
	const repo = await check(
		"/user/repos",
		post(alice, { name: "proj", auto_init: true }),
	);
	await check("/user/repos", auth);
	await check("/users/alice/repos");
	await check("/repos/alice/proj", auth);

	// Watching and following.
	await check("/repos/alice/proj/subscription", auth);
	await check("/repos/alice/proj/subscription", put(alice, { ignored: true }));
	await check("/repos/alice/proj/subscribers");
	await check("/user/subscriptions", auth);
	await check("/users/alice/subscriptions");
	await check("/repos/alice/proj/subscription", del(alice));
	await check("/user/following/bob", put(alice));
	await check("/user/following/bob", auth);
	await check("/user/following", auth);
	await check("/user/followers", auth);
	await check("/users/alice/following");
	await check("/users/alice/followers");
	await check("/users/alice/following/bob");
	await check("/user/following/bob", del(alice));

	signIn(users.alice);
	await files.createBranch({ data: { repoId: repo.id, name: "topic" } });
	await files.uploadFile({
		data: {
			repoId: repo.id,
			branchName: "topic",
			path: "b.txt",
			content: btoa("b\n"),
			commitMessage: "Add b.txt",
		},
	});
	await check("/repos/alice/proj/branches");
	await check("/repos/alice/proj/branches/main");
	await check("/repos/alice/proj/tags");

	await check("/repos/alice/proj/labels");
	await check(
		"/repos/alice/proj/labels",
		post(alice, { name: "triage", color: "#00FF00" }),
	);
	await check("/repos/alice/proj/labels/triage");
	await check(
		"/repos/alice/proj/labels/triage",
		patch(alice, { description: "Needs a look" }),
	);

	await check(
		"/repos/alice/proj/issues",
		post(alice, { title: "Bug", body: "It breaks", labels: ["bug"] }),
	);
	await check("/repos/alice/proj/issues/1", auth);
	await check("/repos/alice/proj/issues/1", patch(alice, { title: "Bug!" }));
	const comment = await check(
		"/repos/alice/proj/issues/1/comments",
		post(alice, { body: "Seen" }),
	);
	await check("/repos/alice/proj/issues/1/comments");
	await check(`/repos/alice/proj/issues/comments/${comment.id}`);
	await check(
		`/repos/alice/proj/issues/comments/${comment.id}`,
		patch(alice, { body: "Seen twice" }),
	);
	const commentReactions = `/repos/alice/proj/issues/comments/${comment.id}/reactions`;
	const commentReaction = await check(
		commentReactions,
		post(alice, { content: "heart" }),
	);
	await check(commentReactions);
	await check(`${commentReactions}/${commentReaction.id}`, del(alice));
	await check(`/repos/alice/proj/issues/comments/${comment.id}`, del(alice));
	const issueReaction = await check(
		"/repos/alice/proj/issues/1/reactions",
		post(alice, { content: "+1" }),
	);
	await check("/repos/alice/proj/issues/1/reactions");
	await check(
		`/repos/alice/proj/issues/1/reactions/${issueReaction.id}`,
		del(alice),
	);
	await check(
		"/repos/alice/proj/issues/1/labels",
		post(alice, { labels: ["triage"] }),
	);
	await check(
		"/repos/alice/proj/issues/1/labels",
		put(alice, { labels: ["bug", "triage"] }),
	);
	await check("/repos/alice/proj/issues/1/labels");
	await check("/repos/alice/proj/issues/1/labels/bug", del(alice));
	await check("/repos/alice/proj/issues/1/labels", del(alice));
	await check(
		"/repos/alice/proj/issues/1",
		patch(alice, { state: "closed", state_reason: "not_planned" }),
	);
	await check("/repos/alice/proj/issues/1", patch(alice, { state: "open" }));
	await check("/repos/alice/proj/labels/triage", del(alice));

	await check(
		"/repos/alice/proj/milestones",
		post(alice, { title: "v1", due_on: "2030-01-31T00:00:00Z" }),
	);
	await check("/repos/alice/proj/milestones");
	await check("/repos/alice/proj/milestones/1");
	await check(
		"/repos/alice/proj/milestones/1",
		patch(alice, { description: "First release" }),
	);
	await check("/repos/alice/proj/issues/1", patch(alice, { milestone: 1 }));
	await check("/repos/alice/proj/issues?milestone=1");
	await check("/repos/alice/proj/issues/1/events");
	await check("/repos/alice/proj/issues/1/timeline");
	await check("/repos/alice/proj/issues/1", patch(alice, { milestone: null }));
	await check("/repos/alice/proj/milestones/1", del(alice));

	await check(
		"/repos/alice/proj/pulls",
		post(alice, {
			title: "Add b",
			body: "Closes #1",
			head: "topic",
			base: "main",
		}),
	);
	await check("/repos/alice/proj/pulls", auth);
	await check("/repos/alice/proj/pulls/2", auth);
	await check(
		"/repos/alice/proj/pulls/2",
		patch(alice, { body: "Closes #1." }),
	);
	await check("/repos/alice/proj/pulls/2/commits");
	await check("/repos/alice/proj/pulls/2/files");
	await check(
		"/repos/alice/proj/pulls/2/merge",
		put(alice, { merge_method: "merge" }),
	);
	await check("/repos/alice/proj/pulls/2/merge");
	await check("/repos/alice/proj/issues?state=all", auth);
	await check("/repos/alice/proj/issues/1/timeline");
	await check("/repos/alice/proj/issues/1/events");
	const pull = await check("/repos/alice/proj/issues/2", auth);
	signIn(users.alice);
	await (await import("../reviews")).submitReview({
		data: { prId: pull.id, event: "comment", body: "Looks good" },
	});
	const timeline = await check("/repos/alice/proj/issues/2/timeline");
	expect(timeline.map((item: { event: string }) => item.event)).toContain(
		"reviewed",
	);
	expect(timeline).not.toContain(null);

	await check("/repos/alice/proj/contents");
	await check("/repos/alice/proj/contents/b.txt");
	await check("/repos/alice/proj/zipball/main");
	await check("/repos/alice/proj/tarball/main");
	// Creating is a 201; the update is the route's documented 200.
	const created = await call(
		"/repos/alice/proj/contents/written.txt",
		put(alice, { message: "Write", content: btoa("w") }),
	);
	const written = await check(
		"/repos/alice/proj/contents/written.txt",
		put(alice, {
			message: "Rewrite",
			content: btoa("w2"),
			sha: created.body.content.sha,
		}),
	);
	await check("/repos/alice/proj/contents/written.txt", {
		...asToken(alice),
		method: "DELETE",
		body: JSON.stringify({ message: "Remove", sha: written.content.sha }),
	});
	const commits = await check("/repos/alice/proj/commits");
	const head = commits[0];
	await check(`/repos/alice/proj/commits/${head.sha}`);
	await check("/repos/alice/proj/compare/topic...main");
	await check("/repos/alice/proj/git/ref/heads/main");
	await check("/repos/alice/proj/git/refs");
	await check("/repos/alice/proj/git/refs/heads/main");
	await check("/repos/alice/proj/git/matching-refs/heads");
	await check(`/repos/alice/proj/git/commits/${head.sha}`);
	const tree = await check(
		`/repos/alice/proj/git/trees/${head.sha}?recursive=1`,
	);
	const file = tree.tree.find(
		(entry: { type: string }) => entry.type === "blob",
	);
	await check(`/repos/alice/proj/git/blobs/${file.sha}`);

	// Bob comments on issue 1, which notifies alice (its author).
	const bob = await mintToken(users.bob, ["repo:write"]);
	await call("/repos/alice/proj/issues/1/comments", post(bob, { body: "Hi" }));
	const [thread] = await check("/notifications", auth);
	await check("/repos/alice/proj/notifications", auth);
	const threadPath = `/notifications/threads/${thread.id}`;
	await check(threadPath, auth);
	await check(`${threadPath}/subscription`, auth);
	await check(`${threadPath}/subscription`, put(alice, { ignored: false }));
	await check(`${threadPath}/subscription`, del(alice));
	await check(threadPath, patch(alice, {}));
	await check(threadPath, del(alice));
	await check("/notifications", put(alice, {}));
	await check("/repos/alice/proj/notifications", put(alice, {}));
	const commitComment = await check(
		`/repos/alice/proj/commits/${head.sha}/comments`,
		post(alice, { body: "Nice commit" }),
	);
	await check(`/repos/alice/proj/commits/${head.sha}/comments`);
	await check("/repos/alice/proj/comments");
	await check(`/repos/alice/proj/comments/${commitComment.id}`);
	await check(
		`/repos/alice/proj/comments/${commitComment.id}`,
		patch(alice, { body: "Nicer commit" }),
	);
	await check(`/repos/alice/proj/comments/${commitComment.id}`, del(alice));
	const newBlob = await check(
		"/repos/alice/proj/git/blobs",
		post(alice, { content: "new" }),
	);
	const newTree = await check(
		"/repos/alice/proj/git/trees",
		post(alice, {
			base_tree: tree.sha,
			tree: [
				{ path: "new.txt", mode: "100644", type: "blob", sha: newBlob.sha },
			],
		}),
	);
	const newCommit = await check(
		"/repos/alice/proj/git/commits",
		post(alice, { message: "New", tree: newTree.sha, parents: [head.sha] }),
	);
	await check(
		"/repos/alice/proj/git/refs",
		post(alice, { ref: "refs/heads/api", sha: head.sha }),
	);
	await check(
		"/repos/alice/proj/git/refs/heads/api",
		patch(alice, { sha: newCommit.sha }),
	);
	const tagObject = await check(
		"/repos/alice/proj/git/tags",
		post(alice, { tag: "v0", message: "v0", object: head.sha, type: "commit" }),
	);
	await check(`/repos/alice/proj/git/tags/${tagObject.sha}`);
	await check("/repos/alice/proj/git/refs/heads/topic", del(alice));
});

describe("the dispatcher against the contract", () => {
	it("exercises every served operation", () => {
		const unserved = Object.keys(endpoints).filter((id) => !covered.has(id));
		expect(unserved).toEqual([]);
	});

	it("drifts only where KNOWN_DRIFT says", () => {
		expect(Object.fromEntries(drift)).toEqual(
			Object.fromEntries(
				Object.entries(KNOWN_DRIFT).map(([id, pattern]) => [
					id,
					expect.stringMatching(pattern),
				]),
			),
		);
	});
});
