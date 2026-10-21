/**
 * @vitest-environment node
 *
 * The REST API's Git database writes: blobs, trees, commits, annotated tags
 * and refs — the blob → tree → commit → ref sequence clients like Octokit
 * use to commit without a working tree — end to end over pglite and the
 * in-memory git store.
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

const { createUsers } = await import("../../test/app-harness");
const users = await createUsers("alice", "bob");
const { BASE, call, mintToken, patch, post } = await import(
	"../../test/api-client"
);

const SHA = /^[0-9a-f]{40}$/;
let alice: string;
let bob: string;

const git = (path: string) => `/repos/alice/proj/git/${path}`;

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	bob = await mintToken(users.bob, ["repo:write"]);
	await call("/user/repos", post(alice, { name: "proj", auto_init: true }));
});

async function mainTip(): Promise<string> {
	return (await call(git("ref/heads/main"))).body.object.sha;
}

describe("committing through the Git database", () => {
	it("blob → tree (on base_tree) → commit → fast-forward ref", async () => {
		const parent = await mainTip();
		const parentTree = (await call(git(`commits/${parent}`))).body.tree.sha;

		const blob = await call(
			git("blobs"),
			post(alice, {
				content: Buffer.from("bin\0ary").toString("base64"),
				encoding: "base64",
			}),
		);
		expect(blob.status).toBe(201);
		expect(blob.body).toEqual({
			sha: expect.stringMatching(SHA),
			url: `${BASE}/repos/alice/proj/git/blobs/${blob.body.sha}`,
		});

		const tree = await call(
			git("trees"),
			post(alice, {
				base_tree: parentTree,
				tree: [
					{
						path: "data/blob.bin",
						mode: "100644",
						type: "blob",
						sha: blob.body.sha,
					},
					{
						path: "hello.sh",
						mode: "100755",
						type: "blob",
						content: "echo hi\n",
					},
					{ path: "README.md", mode: "100644", type: "blob", sha: null },
				],
			}),
		);
		expect(tree.status).toBe(201);
		const paths = tree.body.tree.map((e: { path: string }) => e.path).sort();
		expect(paths).toEqual(["data", "hello.sh"]);
		expect(
			tree.body.tree.find((e: { path: string }) => e.path === "hello.sh"),
		).toMatchObject({ mode: "100755", type: "blob", size: 8 });

		const commit = await call(
			git("commits"),
			post(alice, {
				message: "Commit via API",
				tree: tree.body.sha,
				parents: [parent],
				author: {
					name: "Robot",
					email: "robot@example.org",
					date: "2020-01-02T03:04:05Z",
				},
			}),
		);
		expect(commit.status).toBe(201);
		expect(commit.body).toMatchObject({
			message: "Commit via API",
			tree: { sha: tree.body.sha },
			parents: [{ sha: parent }],
			author: { name: "Robot", date: "2020-01-02T03:04:05Z" },
			committer: { name: "Robot" },
		});

		// Not on any branch until the ref moves.
		expect(await mainTip()).toBe(parent);
		const moved = await call(
			git("refs/heads/main"),
			patch(alice, { sha: commit.body.sha }),
		);
		expect(moved.status).toBe(200);
		expect(moved.body).toMatchObject({
			ref: "refs/heads/main",
			object: { sha: commit.body.sha, type: "commit" },
		});
		const file = await call("/repos/alice/proj/contents/data/blob.bin");
		expect(Buffer.from(file.body.content, "base64").toString()).toBe(
			"bin\0ary",
		);
		expect((await call("/repos/alice/proj/contents/README.md")).status).toBe(
			404,
		);
	});

	it("refuses a non-fast-forward unless forced", async () => {
		const tip = await mainTip();
		const tree = (await call(git(`commits/${tip}`))).body.tree.sha;
		const sibling = await call(
			git("commits"),
			post(alice, { message: "Sibling", tree, parents: [] }),
		);
		const refused = await call(
			git("refs/heads/main"),
			patch(alice, { sha: sibling.body.sha }),
		);
		expect(refused.status).toBe(422);
		expect(refused.body.message).toBe("Update is not a fast forward");
		expect(await mainTip()).toBe(tip);

		await call(
			git("refs"),
			post(alice, { ref: "refs/heads/scratch", sha: tip }),
		);
		const forced = await call(
			git("refs/heads/scratch"),
			patch(alice, { sha: sibling.body.sha, force: true }),
		);
		expect(forced.status).toBe(200);
		expect(forced.body.object.sha).toBe(sibling.body.sha);
	});
});

describe("refs", () => {
	it("creates a branch and refuses duplicates, bad names and missing objects", async () => {
		const tip = await mainTip();
		const created = await call(
			git("refs"),
			post(alice, { ref: "refs/heads/feature/x", sha: tip }),
		);
		expect(created.status).toBe(201);
		expect(created.body).toMatchObject({
			ref: "refs/heads/feature/x",
			url: `${BASE}/repos/alice/proj/git/refs/heads/feature/x`,
		});
		expect((await call("/repos/alice/proj/branches/feature/x")).status).toBe(
			200,
		);
		const again = await call(
			git("refs"),
			post(alice, { ref: "refs/heads/feature/x", sha: tip }),
		);
		expect(again.status).toBe(422);
		expect(again.body.message).toBe("Reference already exists");
		for (const ref of [
			"heads/short",
			"refs/heads/..x",
			"refs/notes/x",
			"refs/heads/a b",
		]) {
			expect(
				(await call(git("refs"), post(alice, { ref, sha: tip }))).status,
				ref,
			).toBe(422);
		}
		expect(
			(
				await call(
					git("refs"),
					post(alice, { ref: "refs/heads/y", sha: "0".repeat(40) }),
				)
			).status,
		).toBe(422);
		expect(
			(await call(git("refs/heads/nope"), patch(alice, { sha: tip }))).status,
		).toBe(422);
	});
});

describe("annotated tags", () => {
	it("creates a tag object, then its ref", async () => {
		const tip = await mainTip();
		const tag = await call(
			git("tags"),
			post(alice, {
				tag: "v1.0.0",
				message: "First release",
				object: tip,
				type: "commit",
			}),
		);
		expect(tag.status).toBe(201);
		expect(tag.body).toMatchObject({
			tag: "v1.0.0",
			message: "First release",
			object: {
				sha: tip,
				type: "commit",
				url: `${BASE}/repos/alice/proj/git/commits/${tip}`,
			},
			tagger: { name: "Alice" },
			url: `${BASE}/repos/alice/proj/git/tags/${tag.body.sha}`,
		});
		expect((await call(git(`tags/${tag.body.sha}`))).body.sha).toBe(
			tag.body.sha,
		);
		// A commit sha isn't a tag object.
		expect((await call(git(`tags/${tip}`))).status).toBe(404);
		const ref = await call(
			git("refs"),
			post(alice, { ref: "refs/tags/v1.0.0", sha: tag.body.sha }),
		);
		expect(ref.status).toBe(201);
		expect(ref.body.object).toMatchObject({ sha: tag.body.sha, type: "tag" });
		const tags = await call("/repos/alice/proj/tags");
		expect(tags.body.map((t: { name: string }) => t.name)).toContain("v1.0.0");
		expect(
			(
				await call(
					git("tags"),
					post(alice, { tag: "bad", message: "", object: tip, type: "tree" }),
				)
			).status,
		).toBe(422);
	});
});

describe("validation and permissions", () => {
	it("rejects malformed trees and commits with 422", async () => {
		const tip = await mainTip();
		const treeSha = (await call(git(`commits/${tip}`))).body.tree.sha;
		const bad = [
			{ tree: [{ path: "../x", mode: "100644", type: "blob", content: "x" }] },
			{ tree: [{ path: "x", mode: "040000", type: "blob", content: "x" }] },
			{ tree: [{ path: "x", mode: "100644", type: "blob" }] },
			{
				tree: [
					{ path: "x", mode: "100644", type: "blob", sha: "0".repeat(40) },
				],
			},
			{ tree: [{ path: "x", mode: "040000", type: "tree", sha: tip }] },
			{ tree: [], base_tree: tip },
			{
				tree: [
					{ path: "x", mode: "100644", type: "blob", content: "a" },
					{ path: "x", mode: "100644", type: "blob", content: "b" },
				],
			},
		];
		for (const body of bad) {
			expect(
				(await call(git("trees"), post(alice, body))).status,
				JSON.stringify(body),
			).toBe(422);
		}
		expect(
			(
				await call(
					git("commits"),
					post(alice, { message: "m", tree: tip, parents: [] }),
				)
			).status,
		).toBe(422);
		expect(
			(
				await call(
					git("commits"),
					post(alice, { message: "m", tree: treeSha, parents: [treeSha] }),
				)
			).status,
		).toBe(422);
	});

	it("needs write access", async () => {
		const reader = await mintToken(users.alice, ["repo:read"]);
		expect(
			(await call(git("blobs"), post(reader, { content: "x" }))).status,
		).toBe(403);
		expect((await call(git("blobs"), post(bob, { content: "x" }))).status).toBe(
			403,
		);
		expect(
			(await call(git("blobs"), { method: "POST", body: "{}" })).status,
		).toBe(401);
	});
});

describe("unreferenced objects and repacks", () => {
	it("keeps a client's blob through a repack until a ref names it", async () => {
		const { afterRepositoryPush, repoFor } = await import("../git-repo");
		const { repackRepository } = await import("git-fs-s3/http");
		const blob = await call(
			git("blobs"),
			post(alice, { content: "orphan for now" }),
		);
		// Force a consolidation: every unkept pack is replaced.
		const removed = await repackRepository(repoFor("alice", "proj"), {
			threshold: 1,
		});
		expect(removed.length).toBeGreaterThan(0);
		afterRepositoryPush("alice", "proj");
		const tree = await call(
			git("trees"),
			post(alice, {
				tree: [
					{ path: "o.txt", mode: "100644", type: "blob", sha: blob.body.sha },
				],
			}),
		);
		expect(tree.status).toBe(201);
		const read = await call(git(`blobs/${blob.body.sha}`));
		expect(Buffer.from(read.body.content, "base64").toString()).toBe(
			"orphan for now",
		);
	});
});
