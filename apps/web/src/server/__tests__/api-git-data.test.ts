/**
 * @vitest-environment node
 *
 * The REST API's repository content surface (`/api/v3`): contents, commits,
 * compare and the Git database reads, end to end over pglite and git-fs.ts's
 * in-memory store.
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
const users = await createUsers("alice", "bob");
const { BASE, asToken, call, mintToken, post } = await import(
	"../../test/api-client"
);

const WEB = "http://localhost:3000";
const SHA = /^[0-9a-f]{40}$/;

let alice: string;
let bob: string;
let repoId: number;
let first: string;
let second: string;
let topicTip: string;

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
	return (await call(`/repos/alice/proj/branches/${branch}`)).body.commit.sha;
}

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	bob = await mintToken(users.bob, ["repo:read"]);
	const created = await call(
		"/user/repos",
		post(alice, { name: "proj", auto_init: true }),
	);
	repoId = created.body.id;
	await call("/user/repos", post(alice, { name: "secret", private: true }));
	await call("/user/repos", post(alice, { name: "empty" }));
	first = await commitFile("main", "src/app.txt", "hello\n");
	second = await commitFile("main", "src/app.txt", "hello\nworld\n");
	signIn(users.alice);
	await files.createBranch({ data: { repoId, name: "topic" } });
	topicTip = await commitFile("topic", "b.txt", "b\n");
	await commitFile("main", "c.txt", "c\n");
});

describe("contents", () => {
	it("returns a file as base64 with GitHub's shape", async () => {
		const { status, body } = await call(
			"/repos/alice/proj/contents/src/app.txt",
		);
		expect(status).toBe(200);
		expect(body).toMatchObject({
			type: "file",
			encoding: "base64",
			size: 12,
			name: "app.txt",
			path: "src/app.txt",
			sha: expect.stringMatching(SHA),
			url: `${BASE}/repos/alice/proj/contents/src/app.txt?ref=main`,
			html_url: `${WEB}/repo/alice/proj/blob/main/src/app.txt`,
			download_url: `${WEB}/api/raw/alice/proj/main/src/app.txt`,
		});
		expect(body.git_url).toBe(`${BASE}/repos/alice/proj/git/blobs/${body.sha}`);
		expect(Buffer.from(body.content, "base64").toString()).toBe(
			"hello\nworld\n",
		);
		expect(body._links).toEqual({
			self: body.url,
			git: body.git_url,
			html: body.html_url,
		});
	});

	it("reads at a ref", async () => {
		const { body } = await call(
			`/repos/alice/proj/contents/src/app.txt?ref=${first}`,
		);
		expect(Buffer.from(body.content, "base64").toString()).toBe("hello\n");
	});

	it("lists a directory and the root", async () => {
		const dir = await call("/repos/alice/proj/contents/src");
		expect(dir.status).toBe(200);
		expect(dir.body).toHaveLength(1);
		expect(dir.body[0]).toMatchObject({
			type: "file",
			name: "app.txt",
			path: "src/app.txt",
			size: 12,
		});
		expect(dir.body[0].content).toBeUndefined();
		const root = await call("/repos/alice/proj/contents");
		const names = root.body.map((entry: { name: string }) => entry.name);
		expect(names).toEqual(expect.arrayContaining(["README.md", "src"]));
		const src = root.body.find(
			(entry: { name: string }) => entry.name === "src",
		);
		expect(src).toMatchObject({
			type: "dir",
			size: 0,
			download_url: null,
			html_url: `${WEB}/repo/alice/proj/tree/main/src`,
		});
		expect(src.git_url).toBe(`${BASE}/repos/alice/proj/git/trees/${src.sha}`);
		expect((await call("/repos/alice/proj/contents/")).body).toEqual(root.body);
	});

	it("404s missing paths, refs and traversal attempts", async () => {
		for (const path of [
			"/repos/alice/proj/contents/nope.txt",
			"/repos/alice/proj/contents/src/app.txt?ref=nope",
			"/repos/alice/proj/contents/..%2F..%2Fbob",
			"/repos/alice/proj/contents/src/app.txt?ref=a..b",
		]) {
			expect((await call(path)).status).toBe(404);
		}
	});

	it("hides private repositories from non-readers", async () => {
		expect((await call("/repos/alice/secret/contents")).status).toBe(404);
		expect(
			(await call("/repos/alice/secret/contents", asToken(bob))).status,
		).toBe(404);
	});
});

describe("commits", () => {
	it("lists commits newest first with pagination", async () => {
		const { status, body, headers } = await call(
			"/repos/alice/proj/commits?per_page=2",
		);
		expect(status).toBe(200);
		expect(body).toHaveLength(2);
		expect(body[0].commit.message).toBe("Add c.txt\n");
		expect(body[0].url).toBe(`${BASE}/repos/alice/proj/commits/${body[0].sha}`);
		expect(headers.get("link")).toContain('rel="next"');
		const all = await call("/repos/alice/proj/commits");
		expect(all.body.map((c: { sha: string }) => c.sha)).toContain(second);
		expect(all.body.map((c: { sha: string }) => c.sha)).not.toContain(topicTip);
	});

	it("filters by sha and path", async () => {
		const topic = await call("/repos/alice/proj/commits?sha=topic");
		expect(topic.body[0].sha).toBe(topicTip);
		const byPath = await call("/repos/alice/proj/commits?path=src/app.txt");
		expect(byPath.body.map((c: { sha: string }) => c.sha)).toEqual([
			second,
			first,
		]);
	});

	it("409s an empty repository", async () => {
		const { status, body } = await call("/repos/alice/empty/commits");
		expect(status).toBe(409);
		expect(body.message).toBe("Git Repository is empty.");
	});

	it("returns one commit with stats and files", async () => {
		const { status, body } = await call(`/repos/alice/proj/commits/${second}`);
		expect(status).toBe(200);
		expect(body.sha).toBe(second);
		expect(body.parents).toEqual([expect.objectContaining({ sha: first })]);
		expect(body.files).toEqual([
			expect.objectContaining({
				filename: "src/app.txt",
				status: "modified",
				sha: expect.stringMatching(SHA),
				patch: expect.stringContaining("+world"),
			}),
		]);
		const [file] = body.files;
		expect(file.changes).toBe(file.additions + file.deletions);
		expect(body.stats).toEqual({
			total: file.changes,
			additions: file.additions,
			deletions: file.deletions,
		});
		const byBranch = await call("/repos/alice/proj/commits/topic");
		expect(byBranch.body.sha).toBe(topicTip);
	});

	it("422s an unknown commit, as GitHub does", async () => {
		const { status, body } = await call("/repos/alice/proj/commits/deadbeef");
		expect(status).toBe(422);
		expect(body.message).toBe("No commit found for SHA: deadbeef");
	});
});

describe("compare", () => {
	it("compares diverged branches", async () => {
		const { status, body } = await call(
			"/repos/alice/proj/compare/main...topic",
		);
		expect(status).toBe(200);
		expect(body).toMatchObject({
			status: "diverged",
			ahead_by: 1,
			behind_by: 1,
			total_commits: 1,
			url: `${BASE}/repos/alice/proj/compare/main...topic`,
			merge_base_commit: { sha: second },
		});
		expect(body.commits.map((c: { sha: string }) => c.sha)).toEqual([topicTip]);
		expect(body.files.map((f: { filename: string }) => f.filename)).toEqual([
			"b.txt",
		]);
		expect(body.files[0].status).toBe("added");
	});

	it("reports ahead, behind and identical", async () => {
		const ahead = await call(`/repos/alice/proj/compare/${first}...main`);
		expect(ahead.body).toMatchObject({
			status: "ahead",
			ahead_by: 2,
			behind_by: 0,
		});
		const behind = await call(`/repos/alice/proj/compare/main...${first}`);
		expect(behind.body).toMatchObject({
			status: "behind",
			ahead_by: 0,
			behind_by: 2,
		});
		const same = await call("/repos/alice/proj/compare/main...alice:main");
		expect(same.body).toMatchObject({
			status: "identical",
			files: [],
			commits: [],
		});
	});

	it("404s malformed, foreign-owner and unknown comparisons", async () => {
		for (const spec of ["main", "main...", "bob:main...topic", "main...nope"]) {
			expect((await call(`/repos/alice/proj/compare/${spec}`)).status).toBe(
				404,
			);
		}
	});
});

describe("git database", () => {
	it("gets a ref, lists refs and matching refs", async () => {
		const ref = await call("/repos/alice/proj/git/ref/heads/topic");
		expect(ref.status).toBe(200);
		expect(ref.body).toEqual({
			ref: "refs/heads/topic",
			url: `${BASE}/repos/alice/proj/git/refs/heads/topic`,
			object: {
				sha: topicTip,
				type: "commit",
				url: `${BASE}/repos/alice/proj/git/commits/${topicTip}`,
			},
		});
		expect((await call("/repos/alice/proj/git/ref/heads/nope")).status).toBe(
			404,
		);
		expect((await call("/repos/alice/proj/git/ref/heads")).status).toBe(404);

		const all = await call("/repos/alice/proj/git/refs");
		expect(all.body.map((r: { ref: string }) => r.ref)).toEqual([
			"refs/heads/main",
			"refs/heads/topic",
		]);
		const heads = await call("/repos/alice/proj/git/refs/heads");
		expect(heads.body).toHaveLength(2);
		const exact = await call("/repos/alice/proj/git/refs/heads/main");
		expect(exact.body.ref).toBe("refs/heads/main");
		expect((await call("/repos/alice/proj/git/refs/tags")).status).toBe(404);

		const matching = await call("/repos/alice/proj/git/matching-refs/heads/t");
		expect(matching.body.map((r: { ref: string }) => r.ref)).toEqual([
			"refs/heads/topic",
		]);
		expect(
			(await call("/repos/alice/proj/git/matching-refs/tags")).body,
		).toEqual([]);
	});

	it("reports annotated tags as tag objects", async () => {
		const git = (await import("isomorphic-git")).default;
		const { repoFor } = await import("../git-repo");
		const repo = repoFor("alice", "proj");
		await git.tag({ ...repo, ref: "v1", object: first });
		await git.annotatedTag({
			...repo,
			ref: "v2",
			object: first,
			message: "Release",
			tagger: { name: "T", email: "t@t.test" },
		});
		const { body } = await call("/repos/alice/proj/git/matching-refs/tags");
		expect(
			body.map((r: { object: { type: string } }) => r.object.type),
		).toEqual(["commit", "tag"]);
		expect(body[0].object.sha).toBe(first);
		expect(body[1].object.sha).not.toBe(first);
	});

	it("gets a git commit", async () => {
		const { status, body } = await call(
			`/repos/alice/proj/git/commits/${second}`,
		);
		expect(status).toBe(200);
		expect(body).toMatchObject({
			sha: second,
			url: `${BASE}/repos/alice/proj/git/commits/${second}`,
			html_url: `${WEB}/repo/alice/proj/commit/${second}`,
			message: "Add src/app.txt\n",
			tree: { sha: expect.stringMatching(SHA) },
			parents: [{ sha: first }],
			verification: { verified: false, reason: "unsigned" },
		});
		expect((await call("/repos/alice/proj/git/commits/main")).status).toBe(404);
		expect(
			(await call(`/repos/alice/proj/git/commits/${"0".repeat(40)}`)).status,
		).toBe(404);
	});

	it("gets a tree, flat and recursive, and a blob", async () => {
		const flat = await call("/repos/alice/proj/git/trees/main");
		expect(flat.status).toBe(200);
		expect(flat.body.truncated).toBe(false);
		const src = flat.body.tree.find((e: { path: string }) => e.path === "src");
		expect(src).toEqual({
			path: "src",
			mode: "040000",
			type: "tree",
			sha: expect.stringMatching(SHA),
			url: `${BASE}/repos/alice/proj/git/trees/${src.sha}`,
		});
		const bySha = await call(`/repos/alice/proj/git/trees/${flat.body.sha}`);
		expect(bySha.body).toEqual(flat.body);

		const deep = await call("/repos/alice/proj/git/trees/main?recursive=1");
		const file = deep.body.tree.find(
			(e: { path: string }) => e.path === "src/app.txt",
		);
		expect(file).toMatchObject({ mode: "100644", type: "blob", size: 12 });

		const blob = await call(`/repos/alice/proj/git/blobs/${file.sha}`);
		expect(blob.status).toBe(200);
		expect(blob.body).toMatchObject({
			sha: file.sha,
			size: 12,
			encoding: "base64",
		});
		expect(Buffer.from(blob.body.content, "base64").toString()).toBe(
			"hello\nworld\n",
		);
		expect((await call(`/repos/alice/proj/git/blobs/${src.sha}`)).status).toBe(
			404,
		);
		expect(
			(await call(`/repos/alice/proj/git/trees/${"0".repeat(40)}`)).status,
		).toBe(404);
	});

	it("hides private repositories", async () => {
		expect(
			(await call("/repos/alice/secret/git/refs", asToken(bob))).status,
		).toBe(404);
	});
});
