/**
 * @vitest-environment node
 *
 * The REST API's repository content surface (`/api/v3`): contents, commits,
 * compare and the Git database reads, end to end over pglite and git-fs.ts's
 * in-memory store.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

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
const caps = await import("../api/caps");
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
			html_url: `${WEB}/alice/proj/blob/main/src/app.txt`,
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
			html_url: `${WEB}/alice/proj/tree/main/src`,
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
		expect(body[0].commit.message).toBe("Add c.txt");
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
			html_url: `${WEB}/alice/proj/commit/${second}`,
			message: "Add src/app.txt",
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

describe("caps (lowered for the test)", () => {
	const { apiCaps, DEFAULT_API_CAPS } = caps;
	afterEach(() => {
		Object.assign(apiCaps, DEFAULT_API_CAPS);
	});

	it("returns encoding none for files over the inline cap", async () => {
		apiCaps.contentsInlineBytes = 5;
		const { status, body } = await call(
			"/repos/alice/proj/contents/src/app.txt",
		);
		expect(status).toBe(200);
		expect(body).toMatchObject({ size: 12, content: "", encoding: "none" });
	});

	it("caps a directory listing", async () => {
		apiCaps.directoryEntries = 1;
		expect((await call("/repos/alice/proj/contents")).body).toHaveLength(1);
	});

	it("truncates trees", async () => {
		apiCaps.treeEntries = 2;
		const { body } = await call("/repos/alice/proj/git/trees/main?recursive=1");
		expect(body.tree).toHaveLength(2);
		expect(body.truncated).toBe(true);
	});

	it("403s blobs over the cap", async () => {
		const file = await call("/repos/alice/proj/contents/src/app.txt");
		apiCaps.blobBytes = 5;
		const { status, body } = await call(
			`/repos/alice/proj/git/blobs/${file.body.sha}`,
		);
		expect(status).toBe(403);
		expect(body.message).toContain("blobs up to 5 bytes");
	});

	it("omits patches past the patch budget", async () => {
		apiCaps.patchBudgetBytes = 1;
		const { body } = await call(`/repos/alice/proj/commits/${second}`);
		expect(body.files).toHaveLength(1);
		expect(body.files[0].patch).toBeUndefined();
		expect(body.files[0].additions).toBeGreaterThan(0);
	});

	it("caps files and commits of a comparison and a commit", async () => {
		const full = await call(`/repos/alice/proj/compare/${first}...main`);
		expect(full.body.files).toHaveLength(2);
		expect(full.body.commits).toHaveLength(2);
		apiCaps.diffFiles = 1;
		apiCaps.compareCommits = 1;
		const capped = await call(`/repos/alice/proj/compare/${first}...main`);
		expect(capped.body.files).toHaveLength(1);
		expect(capped.body.commits).toHaveLength(1);
		expect(capped.body.ahead_by).toBe(2);
		expect(capped.body.total_commits).toBe(2);
		const paged = await call(
			`/repos/alice/proj/compare/${first}...main?per_page=1&page=2`,
		);
		expect(paged.body.commits).toEqual([]);
	});
});

describe("symlinks and submodules", () => {
	const SUB = "a".repeat(40);

	beforeAll(async () => {
		await call("/user/repos", post(alice, { name: "links" }));
		const git = (await import("isomorphic-git")).default;
		const { repoFor } = await import("../git-repo");
		const repo = repoFor("alice", "links");
		const blob = (text: string) =>
			git.writeBlob({ ...repo, blob: new TextEncoder().encode(text) });
		const tree = await git.writeTree({
			...repo,
			tree: [
				{
					mode: "100644",
					path: ".gitmodules",
					type: "blob",
					oid: await blob(
						'[submodule "lib"]\n\tpath = lib\n\turl = https://example.org/lib.git\n',
					),
				},
				{ mode: "160000", path: "lib", type: "commit", oid: SUB },
				{
					mode: "120000",
					path: "link",
					type: "blob",
					oid: await blob(".gitmodules"),
				},
			],
		});
		const author = {
			name: "A",
			email: "a@a.test",
			timestamp: 0,
			timezoneOffset: 0,
		};
		const commit = await git.writeCommit({
			...repo,
			commit: {
				message: "links\n",
				tree,
				parent: [],
				author,
				committer: author,
			},
		});
		await git.writeRef({ ...repo, ref: "refs/heads/main", value: commit });
	});

	it("returns a symlink with its target", async () => {
		const { status, body } = await call("/repos/alice/links/contents/link");
		expect(status).toBe(200);
		expect(body).toMatchObject({
			type: "symlink",
			target: ".gitmodules",
			size: 11,
			path: "link",
		});
		expect(body.content).toBeUndefined();
	});

	it("does not read a symlink target over the cap", async () => {
		const { apiCaps, DEFAULT_API_CAPS } = caps;
		apiCaps.symlinkTargetBytes = 4;
		try {
			const { body } = await call("/repos/alice/links/contents/link");
			expect(body).toMatchObject({ type: "symlink", target: null });
		} finally {
			Object.assign(apiCaps, DEFAULT_API_CAPS);
		}
	});

	it("returns a submodule with its URL", async () => {
		const { status, body } = await call("/repos/alice/links/contents/lib");
		expect(status).toBe(200);
		expect(body).toMatchObject({
			type: "submodule",
			sha: SUB,
			submodule_git_url: "https://example.org/lib.git",
			download_url: null,
			git_url: null,
			html_url: null,
		});
		const root = await call("/repos/alice/links/contents");
		expect(root.body.map((e: { type: string }) => e.type).sort()).toEqual([
			"file",
			"submodule",
			"symlink",
		]);
	});
});

describe("private repositories", () => {
	it("404s commits and compare for non-readers", async () => {
		await call(
			"/user/repos",
			post(alice, { name: "hidden", private: true, auto_init: true }),
		);
		for (const path of [
			"/repos/alice/hidden/commits",
			"/repos/alice/hidden/commits/main",
			"/repos/alice/hidden/compare/main...main",
			"/repos/alice/hidden/git/trees/main",
		]) {
			expect((await call(path)).status).toBe(404);
			expect((await call(path, asToken(bob))).status).toBe(404);
		}
		expect(
			(await call("/repos/alice/hidden/commits", asToken(alice))).status,
		).toBe(200);
	});
});

describe("deleting refs", () => {
	const del = (path: string, token: string) =>
		call(path, { ...asToken(token), method: "DELETE" });

	it("deletes a branch and records head_ref_deleted on its closed pull", async () => {
		signIn(users.alice);
		await files.createBranch({ data: { repoId, name: "doomed" } });
		await commitFile("doomed", "d.txt", "d\n");
		const pull = await call(
			"/repos/alice/proj/pulls",
			post(alice, { title: "Doomed", head: "doomed", base: "main" }),
		);
		await call(`/repos/alice/proj/pulls/${pull.body.number}`, {
			...asToken(alice),
			method: "PATCH",
			body: JSON.stringify({ state: "closed" }),
		});

		const deleted = await del("/repos/alice/proj/git/refs/heads/doomed", alice);
		expect(deleted.status).toBe(204);
		expect((await call("/repos/alice/proj/branches/doomed")).status).toBe(404);
		const timeline = await call(
			`/repos/alice/proj/issues/${pull.body.number}/timeline`,
		);
		expect(
			timeline.body.map((item: { event: string }) => item.event),
		).toContain("head_ref_deleted");
		// Gone now: GitHub's 422.
		const again = await del("/repos/alice/proj/git/refs/heads/doomed", alice);
		expect(again.status).toBe(422);
		expect(again.body.message).toBe("Reference does not exist");
	});

	it("deletes a tag", async () => {
		const { default: git } = await import("isomorphic-git");
		const { repoFor } = await import("../git-repo");
		await git.tag({ ...repoFor("alice", "proj"), ref: "v-old", object: first });
		expect((await call("/repos/alice/proj/git/ref/tags/v-old")).status).toBe(
			200,
		);
		expect(
			(await del("/repos/alice/proj/git/refs/tags/v-old", alice)).status,
		).toBe(204);
		expect((await call("/repos/alice/proj/git/ref/tags/v-old")).status).toBe(
			404,
		);
	});

	it("refuses the default branch, unknown namespaces and non-writers", async () => {
		const main = await del("/repos/alice/proj/git/refs/heads/main", alice);
		expect(main.status).toBe(422);
		expect(
			(await del("/repos/alice/proj/git/refs/notes/x", alice)).status,
		).toBe(422);
		expect(
			(await del("/repos/alice/proj/git/refs/heads/..x", alice)).status,
		).toBe(422);
		expect(
			(await del("/repos/alice/proj/git/refs/heads/topic", bob)).status,
		).toBe(403);
		expect(
			(
				await call("/repos/alice/proj/git/refs/heads/topic", {
					method: "DELETE",
				})
			).status,
		).toBe(401);
		expect((await call("/repos/alice/proj/branches/topic")).status).toBe(200);
	});
});

describe("file writes", () => {
	const send = (method: string, path: string, token: string, body: object) =>
		call(`/repos/alice/proj/contents/${path}`, {
			...asToken(token),
			method,
			body: JSON.stringify(body),
		});
	const b64 = (text: string) => Buffer.from(text).toString("base64");

	it("creates (201), updates with sha (200) and deletes a file", async () => {
		const created = await send("PUT", "docs/new.md", alice, {
			message: "Add new.md",
			content: b64("one\n"),
		});
		expect(created.status).toBe(201);
		expect(created.body.content).toMatchObject({
			type: "file",
			name: "new.md",
			path: "docs/new.md",
			size: 4,
			html_url: `${WEB}/alice/proj/blob/main/docs/new.md`,
		});
		expect(created.body.commit).toMatchObject({
			message: "Add new.md",
			author: { name: "Alice" },
		});
		const tip = await call("/repos/alice/proj/branches/main");
		expect(tip.body.commit.sha).toBe(created.body.commit.sha);

		const updated = await send("PUT", "docs/new.md", alice, {
			message: "Update new.md",
			content: b64("two\n"),
			sha: created.body.content.sha,
			author: { name: "Someone", email: "someone@example.org" },
		});
		expect(updated.status).toBe(200);
		expect(updated.body.commit.author.name).toBe("Someone");
		expect(updated.body.commit.parents[0].sha).toBe(created.body.commit.sha);
		const read = await call("/repos/alice/proj/contents/docs/new.md");
		expect(Buffer.from(read.body.content, "base64").toString()).toBe("two\n");

		const removed = await send("DELETE", "docs/new.md", alice, {
			message: "Remove new.md",
			sha: updated.body.content.sha,
		});
		expect(removed.status).toBe(200);
		expect(removed.body.content).toBeNull();
		expect(removed.body.commit.message).toBe("Remove new.md");
		expect((await call("/repos/alice/proj/contents/docs/new.md")).status).toBe(
			404,
		);
	});

	it("writes to a named branch only", async () => {
		const onTopic = await send("PUT", "topic-only.txt", alice, {
			message: "On topic",
			content: b64("t\n"),
			branch: "topic",
		});
		expect(onTopic.status).toBe(201);
		expect(onTopic.body.content.url).toContain("?ref=topic");
		expect(
			(await call("/repos/alice/proj/contents/topic-only.txt?ref=topic"))
				.status,
		).toBe(200);
		expect(
			(await call("/repos/alice/proj/contents/topic-only.txt")).status,
		).toBe(404);
		const missing = await send("PUT", "x.txt", alice, {
			message: "x",
			content: b64("x"),
			branch: "no-such-branch",
		});
		expect(missing.status).toBe(404);
	});

	it("is GitHub's optimistic lock: 422 without sha, 409 on a stale one", async () => {
		const existing = await call("/repos/alice/proj/contents/c.txt");
		const noSha = await send("PUT", "c.txt", alice, {
			message: "m",
			content: b64("z"),
		});
		expect(noSha.status).toBe(422);
		expect(noSha.body.message).toContain('"sha" wasn\'t supplied.');
		const stale = await send("PUT", "c.txt", alice, {
			message: "m",
			content: b64("z"),
			sha: "0".repeat(40),
		});
		expect(stale.status).toBe(409);
		expect(stale.body.message).toBe(`c.txt does not match ${"0".repeat(40)}`);
		const staleDelete = await send("DELETE", "c.txt", alice, {
			message: "m",
			sha: "0".repeat(40),
		});
		expect(staleDelete.status).toBe(409);
		const after = await call("/repos/alice/proj/contents/c.txt");
		expect(after.body.sha).toBe(existing.body.sha);
		const gone = await send("DELETE", "nope.txt", alice, {
			message: "m",
			sha: existing.body.sha,
		});
		expect(gone.status).toBe(404);
		const dir = await send("PUT", "src", alice, {
			message: "m",
			content: b64("z"),
			sha: existing.body.sha,
		});
		expect(dir.status).toBe(422);
	});

	it("validates input and permissions", async () => {
		expect(
			(await send("PUT", "v.txt", alice, { content: b64("v") })).status,
		).toBe(422);
		expect(
			(await send("PUT", "v.txt", alice, { message: "m", content: "%%%" }))
				.status,
		).toBe(422);
		expect(
			(await send("PUT", "v.txt", bob, { message: "m", content: b64("v") }))
				.status,
		).toBe(403);
		expect(
			(
				await send("PUT", ".git/config", alice, {
					message: "m",
					content: b64("v"),
				})
			).status,
		).toBe(404);
		expect(
			(
				await call("/repos/alice/proj/contents/v.txt", {
					method: "PUT",
					body: JSON.stringify({ message: "m", content: b64("v") }),
				})
			).status,
		).toBe(401);
	});

	it("creates the first commit of an empty repository", async () => {
		const first = await call("/repos/alice/empty/contents/README.md", {
			...asToken(alice),
			method: "PUT",
			body: JSON.stringify({ message: "Init", content: b64("# hi\n") }),
		});
		expect(first.status).toBe(201);
		expect(first.body.commit.parents).toEqual([]);
		const branch = await call("/repos/alice/empty/branches/main");
		expect(branch.body.commit.sha).toBe(first.body.commit.sha);
	});
});
