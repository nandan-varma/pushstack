/**
 * @vitest-environment node
 *
 * The real `/api/v3` dispatcher's responses against `@pushstack/api-contract`:
 * one scenario touches every endpoint, and each success body is parsed with
 * its operation's response schema. Drift is listed in KNOWN_DRIFT until the
 * web side adopts the contract (#127, phase 2); a fix or new drift fails here.
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

const users = await createUsers("alice");

/** Operation id → the schema issues of its first mismatching response. */
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
 * Where the server disagrees with the contract today. Each entry is fixed by
 * making the serializer return the contract type (phase 2 of #127).
 */
const KNOWN_DRIFT: Record<string, RegExp> = {
	// `GET …/branches/{branch}`: the commit omits `comments_url`.
	"repos/get-branch": /comments_url/,
};

let alice: string;

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	const auth = asToken(alice);

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

	// Labels
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

	// Issues, comments, issue labels
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
	await check(`/repos/alice/proj/issues/comments/${comment.id}`, del(alice));
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

	// Pull requests
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
	await check("/repos/alice/proj/issues/2/timeline");

	// Contents, commits and git data
	await check("/repos/alice/proj/contents");
	await check("/repos/alice/proj/contents/b.txt");
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
