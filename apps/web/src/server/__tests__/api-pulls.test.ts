/**
 * @vitest-environment node
 *
 * The GitHub-compatible REST API's pull requests surface (`/api/v3`), end to
 * end: the real dispatcher over pglite and git-fs.ts's in-memory store.
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

const users = await createUsers("alice", "bob", "dave");
const { BASE, asToken, call, mintToken, patch, post } = await import(
	"../../test/api-client"
);

const put = (token: string, body?: unknown) => ({
	...asToken(token),
	method: "PUT",
	body: body === undefined ? undefined : JSON.stringify(body),
});

let alice: string;
let bob: string;
let dave: string;
let repoId: number;

async function commitFile(branch: string, path: string, content: string) {
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

async function branchFrom(name: string) {
	signIn(users.alice);
	await files.createBranch({ data: { repoId, name } });
}

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	bob = await mintToken(users.bob, ["repo:write"]);
	dave = await mintToken(users.dave, ["repo:write"]);
	const created = await call(
		"/user/repos",
		post(alice, { name: "proj", auto_init: true }),
	);
	repoId = created.body.id;
	signIn(users.alice);
	await repositories.addCollaboratorByUsername({
		data: { repoId, username: "bob", role: "read" },
	});
	await repositories.addCollaboratorByUsername({
		data: { repoId, username: "dave", role: "write" },
	});
	await branchFrom("topic");
	await commitFile("topic", "b.txt", "b\n");
});

describe("creating pull requests", () => {
	it("creates a pull request with GitHub's shape, 201 with Location", async () => {
		const { status, headers, body } = await call(
			"/repos/alice/proj/pulls",
			post(alice, {
				title: "Add b",
				body: "Please merge",
				head: "topic",
				base: "main",
			}),
		);
		expect(status).toBe(201);
		expect(headers.get("location")).toBe(`${BASE}/repos/alice/proj/pulls/1`);
		expect(body).toMatchObject({
			number: 1,
			state: "open",
			title: "Add b",
			body: "Please merge",
			user: { login: "alice" },
			locked: false,
			merged: false,
			merged_at: null,
			closed_at: null,
			draft: false,
			url: `${BASE}/repos/alice/proj/pulls/1`,
			html_url: "http://localhost:3000/repo/alice/proj/pulls/1",
			issue_url: `${BASE}/repos/alice/proj/issues/1`,
			commits_url: `${BASE}/repos/alice/proj/pulls/1/commits`,
			head: { label: "alice:topic", ref: "topic", user: { login: "alice" } },
			base: { label: "alice:main", ref: "main" },
			commits: 1,
			additions: 1,
			deletions: 0,
			changed_files: 1,
			comments: 0,
			review_comments: 0,
			merged_by: null,
		});
		expect(body.head.sha).toMatch(/^[0-9a-f]{40}$/);
		expect(body.head.repo.full_name).toBe("alice/proj");
		expect(body._links.self.href).toBe(`${BASE}/repos/alice/proj/pulls/1`);
		// The issues surface sees the same thread.
		const asIssue = await call("/repos/alice/proj/issues/1");
		expect(asIssue.body.pull_request.url).toBe(
			`${BASE}/repos/alice/proj/pulls/1`,
		);
	});

	it("422s missing fields, unknown branches, a foreign head, the same branch and a duplicate", async () => {
		const missing = await call(
			"/repos/alice/proj/pulls",
			post(alice, { base: "main" }),
		);
		expect(missing.status).toBe(422);
		expect(missing.body.errors).toEqual(
			expect.arrayContaining([
				{ resource: "PullRequest", field: "title", code: "missing_field" },
				{ resource: "PullRequest", field: "head", code: "missing_field" },
			]),
		);

		const unknown = await call(
			"/repos/alice/proj/pulls",
			post(alice, { title: "x", head: "nope", base: "main" }),
		);
		expect(unknown.status).toBe(422);
		expect(unknown.body.errors).toEqual([
			{ resource: "PullRequest", field: "head", code: "invalid" },
		]);

		const foreign = await call(
			"/repos/alice/proj/pulls",
			post(alice, { title: "x", head: "bob:topic", base: "main" }),
		);
		expect(foreign.body.errors).toEqual([
			{ resource: "PullRequest", field: "head", code: "invalid" },
		]);

		const same = await call(
			"/repos/alice/proj/pulls",
			post(alice, { title: "x", head: "main", base: "main" }),
		);
		expect(same.status).toBe(422);
		expect(same.body.errors[0]).toMatchObject({
			resource: "PullRequest",
			code: "custom",
			message: "No commits between main and main",
		});

		const duplicate = await call(
			"/repos/alice/proj/pulls",
			post(alice, { title: "x", head: "alice:topic", base: "main" }),
		);
		expect(duplicate.status).toBe(422);
		expect(duplicate.body.errors[0]).toMatchObject({
			code: "custom",
			message: "A pull request already exists for alice:topic.",
		});
	});

	it("needs write access: 403 for a reader, 401 anonymous", async () => {
		const reader = await call(
			"/repos/alice/proj/pulls",
			post(bob, { title: "x", head: "topic", base: "main" }),
		);
		expect(reader.status).toBe(403);
		const anonymous = await call("/repos/alice/proj/pulls", {
			method: "POST",
			body: "{}",
		});
		expect(anonymous.status).toBe(401);
	});
});

describe("reading pull requests", () => {
	it("lists with state, head and base filters, without the detail fields", async () => {
		const open = await call("/repos/alice/proj/pulls");
		expect(open.status).toBe(200);
		expect(open.body).toHaveLength(1);
		expect(open.body[0]).toMatchObject({ number: 1, state: "open" });
		expect(open.body[0]).not.toHaveProperty("commits");
		expect(open.body[0]).not.toHaveProperty("merged");

		const byHead = await call("/repos/alice/proj/pulls?head=alice:topic");
		expect(byHead.body).toHaveLength(1);
		const otherHead = await call("/repos/alice/proj/pulls?head=bob:topic");
		expect(otherHead.body).toEqual([]);
		const otherBase = await call("/repos/alice/proj/pulls?base=topic");
		expect(otherBase.body).toEqual([]);
		const closed = await call("/repos/alice/proj/pulls?state=closed");
		expect(closed.body).toEqual([]);
		const all = await call("/repos/alice/proj/pulls?state=all&sort=updated");
		expect(all.body).toHaveLength(1);

		const invalid = await call("/repos/alice/proj/pulls?state=bogus");
		expect(invalid.status).toBe(422);
	});

	it("gets one, 404s a missing or non-numeric number", async () => {
		const found = await call("/repos/alice/proj/pulls/1");
		expect(found.status).toBe(200);
		expect(found.body.number).toBe(1);
		expect((await call("/repos/alice/proj/pulls/99")).status).toBe(404);
		expect((await call("/repos/alice/proj/pulls/abc")).status).toBe(404);
	});

	it("lists the files with GitHub's shape", async () => {
		const { status, body } = await call("/repos/alice/proj/pulls/1/files");
		expect(status).toBe(200);
		expect(body).toHaveLength(1);
		expect(body[0]).toMatchObject({
			filename: "b.txt",
			status: "added",
			additions: 1,
			deletions: 0,
			changes: 1,
		});
		expect(body[0].sha).toMatch(/^[0-9a-f]{40}$/);
		expect(body[0].patch.startsWith("@@")).toBe(true);
		expect(body[0].patch).toContain("+b");
	});

	it("lists the commits oldest first with full commit objects", async () => {
		const { status, body } = await call("/repos/alice/proj/pulls/1/commits");
		expect(status).toBe(200);
		expect(body).toHaveLength(1);
		expect(body[0].sha).toMatch(/^[0-9a-f]{40}$/);
		expect(body[0].commit.message).toContain("Add b.txt");
		expect(body[0].commit.author.email).toBe("noreply@localhost:3000");
		expect(body[0].parents).toHaveLength(1);
		expect(body[0].url).toBe(`${BASE}/repos/alice/proj/commits/${body[0].sha}`);
	});

	it("hides pull requests of a private repository", async () => {
		await call(
			"/user/repos",
			post(alice, { name: "secret", private: true, auto_init: true }),
		);
		const anonymous = await call("/repos/alice/secret/pulls");
		expect(anonymous.status).toBe(404);
	});
});

describe("updating pull requests", () => {
	it("edits title and body, closes and reopens", async () => {
		const edited = await call(
			"/repos/alice/proj/pulls/1",
			patch(alice, { title: "Add b.txt", body: "New body" }),
		);
		expect(edited.status).toBe(200);
		expect(edited.body).toMatchObject({ title: "Add b.txt", body: "New body" });

		const closed = await call(
			"/repos/alice/proj/pulls/1",
			patch(alice, { state: "closed" }),
		);
		expect(closed.body.state).toBe("closed");
		expect(closed.body.merged).toBe(false);
		expect(closed.body.closed_at).toMatch(/Z$/);
		expect(
			(await call("/repos/alice/proj/pulls?state=closed")).body,
		).toHaveLength(1);

		const reopened = await call(
			"/repos/alice/proj/pulls/1",
			patch(alice, { state: "open" }),
		);
		expect(reopened.body.state).toBe("open");
		expect(reopened.body.closed_at).toBeNull();
	});

	it("refuses a reader (403), a bad state (422) and a base change (422)", async () => {
		const reader = await call(
			"/repos/alice/proj/pulls/1",
			patch(bob, { title: "mine" }),
		);
		expect(reader.status).toBe(403);
		const badState = await call(
			"/repos/alice/proj/pulls/1",
			patch(alice, { state: "merged" }),
		);
		expect(badState.status).toBe(422);
		const base = await call(
			"/repos/alice/proj/pulls/1",
			patch(alice, { base: "topic" }),
		);
		expect(base.status).toBe(422);
	});

	it("lets a writer edit someone else's pull request", async () => {
		const { status } = await call(
			"/repos/alice/proj/pulls/1",
			patch(dave, { title: "Add b.txt" }),
		);
		expect(status).toBe(200);
	});
});

describe("merging pull requests", () => {
	it("refuses unsupported methods, a stale sha, a reader and anonymous", async () => {
		const squash = await call(
			"/repos/alice/proj/pulls/1/merge",
			put(alice, { merge_method: "squash" }),
		);
		expect(squash.status).toBe(405);
		const bogus = await call(
			"/repos/alice/proj/pulls/1/merge",
			put(alice, { merge_method: "octopus" }),
		);
		expect(bogus.status).toBe(422);
		const stale = await call(
			"/repos/alice/proj/pulls/1/merge",
			put(alice, { sha: "0".repeat(40) }),
		);
		expect(stale.status).toBe(409);
		expect(stale.body.message).toBe(
			"Head branch was modified. Review and try the merge again.",
		);
		expect(
			(await call("/repos/alice/proj/pulls/1/merge", put(bob))).status,
		).toBe(403);
		expect(
			(await call("/repos/alice/proj/pulls/1/merge", { method: "PUT" })).status,
		).toBe(401);
		expect((await call("/repos/alice/proj/pulls/1/merge")).status).toBe(404);
	});

	it("merges (an empty body is fine), closes named issues and reports the merge", async () => {
		const issue = await call(
			"/repos/alice/proj/issues",
			post(alice, { title: "To close" }),
		);
		await call(
			"/repos/alice/proj/pulls/1",
			patch(alice, { body: `Closes #${issue.body.number}` }),
		);
		const head = (await call("/repos/alice/proj/pulls/1")).body.head.sha;

		const merged = await call("/repos/alice/proj/pulls/1/merge", put(alice));
		expect(merged.status).toBe(200);
		expect(merged.body).toEqual({
			sha: expect.stringMatching(/^[0-9a-f]{40}$/),
			merged: true,
			message: "Pull Request successfully merged",
		});

		const isMerged = await call("/repos/alice/proj/pulls/1/merge");
		expect(isMerged.status).toBe(204);

		const pull = await call("/repos/alice/proj/pulls/1");
		expect(pull.body).toMatchObject({
			state: "closed",
			merged: true,
			merge_commit_sha: merged.body.sha,
			merged_by: { login: "alice" },
			head: { sha: head },
		});
		expect(pull.body.merged_at).toMatch(/Z$/);
		expect(pull.body.closed_at).toBe(pull.body.merged_at);

		const closedIssue = await call(
			`/repos/alice/proj/issues/${issue.body.number}`,
		);
		expect(closedIssue.body.state).toBe("closed");

		const again = await call("/repos/alice/proj/pulls/1/merge", put(alice));
		expect(again.status).toBe(405);
		expect(again.body.message).toBe("Pull Request is not mergeable");

		// A merged pull request keeps its range after the base moved on.
		const filesAfter = await call("/repos/alice/proj/pulls/1/files");
		expect(
			filesAfter.body.map((f: { filename: string }) => f.filename),
		).toEqual(["b.txt"]);
		const reopen = await call(
			"/repos/alice/proj/pulls/1",
			patch(alice, { state: "open" }),
		);
		expect(reopen.status).toBe(422);
		expect(
			(await call("/repos/alice/proj/pulls?state=closed")).body,
		).toHaveLength(1);
	});

	it("merges with a custom message and refuses a conflict with 405", async () => {
		await commitFile("main", "c.txt", "base\n");
		await branchFrom("left");
		await branchFrom("right");
		await commitFile("left", "c.txt", "left\n");
		await commitFile("right", "c.txt", "right\n");
		const leftPull = await call(
			"/repos/alice/proj/pulls",
			post(alice, { title: "Left", head: "left", base: "main" }),
		);
		const rightPull = await call(
			"/repos/alice/proj/pulls",
			post(alice, { title: "Right", head: "right", base: "main" }),
		);
		const first = await call(
			`/repos/alice/proj/pulls/${leftPull.body.number}/merge`,
			put(dave, { commit_title: "Merge left", commit_message: "details" }),
		);
		expect(first.status).toBe(200);
		const log = await call(`/repos/alice/proj/pulls/${leftPull.body.number}`);
		expect(log.body.merged).toBe(true);

		const conflict = await call(
			`/repos/alice/proj/pulls/${rightPull.body.number}/merge`,
			put(alice),
		);
		expect(conflict.status).toBe(405);
		expect(conflict.body.message).toBe("Pull Request is not mergeable");
		const still = await call(
			`/repos/alice/proj/pulls/${rightPull.body.number}`,
		);
		expect(still.body.state).toBe("open");
	});
});

describe("response size and scopes", () => {
	it("omits patches past a per-response budget but still lists every file", async () => {
		await branchFrom("big");
		const line = `${"x".repeat(98)}\n`;
		const content = line.repeat(9000); // ~900 KB, under the per-file diff cap
		for (const name of ["one.txt", "two.txt", "three.txt"]) {
			await commitFile("big", name, content);
		}
		const created = await call(
			"/repos/alice/proj/pulls",
			post(alice, { title: "Big", head: "big", base: "main" }),
		);
		expect(created.status).toBe(201);
		const listed = await call(
			`/repos/alice/proj/pulls/${created.body.number}/files`,
		);
		expect(listed.status).toBe(200);
		expect(listed.body).toHaveLength(3);
		const withPatch = listed.body.filter(
			(file: { patch?: string }) => file.patch !== undefined,
		);
		expect(withPatch.length).toBeGreaterThan(0);
		expect(withPatch.length).toBeLessThan(3);
		const patchBytes = withPatch.reduce(
			(sum: number, file: { patch: string }) =>
				sum + Buffer.byteLength(file.patch),
			0,
		);
		expect(patchBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
		// Every file still reports its counts.
		for (const file of listed.body) expect(file.additions).toBe(9000);
	});

	it("refuses a head that moved after the pre-check, under the lock", async () => {
		const { mergePullRequestBranches } = await import("../pull-request-store");
		const { findRepositoryByName } = await import("../repository-lookup");
		const { db } = await import("#/db");
		await branchFrom("racy");
		await commitFile("racy", "racy.txt", "r\n");
		const created = await call(
			"/repos/alice/proj/pulls",
			post(alice, { title: "Racy", head: "racy", base: "main" }),
		);
		const repo = await findRepositoryByName("alice", "proj");
		const pr = await db.query.pullRequests.findFirst({
			where: { repoId, number: created.body.number },
		});
		if (!repo || !pr) throw new Error("fixture missing");
		const result = await mergePullRequestBranches(
			repo,
			pr,
			{ id: users.alice.id, name: "alice", email: "alice@example.com" },
			undefined,
			"0".repeat(40),
		);
		expect(result).toMatchObject({ success: false, headModified: true });
		const after = await call(`/repos/alice/proj/pulls/${created.body.number}`);
		expect(after.body.state).toBe("open");
		expect(after.body.merged).toBe(false);
	});

	it("gives a repo:read token 403 on every write", async () => {
		const aliceRead = await mintToken(users.alice, ["repo:read"]);
		const create = await call(
			"/repos/alice/proj/pulls",
			post(aliceRead, { title: "x", head: "topic", base: "main" }),
		);
		expect(create.status).toBe(403);
		const update = await call(
			"/repos/alice/proj/pulls/1",
			patch(aliceRead, { title: "x" }),
		);
		expect(update.status).toBe(403);
		const merge = await call("/repos/alice/proj/pulls/2/merge", put(aliceRead));
		expect(merge.status).toBe(403);
		expect(merge.body.message).toBe(
			"Resource not accessible by personal access token",
		);
	});
});
