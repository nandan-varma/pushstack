/**
 * @vitest-environment node
 *
 * GitHub's commit comments at `/api/v3`: create, list (per commit and per
 * repository), get, update and delete, with GitHub's permissions and status
 * codes, and `comment_count` on commit objects.
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
const { asToken, call, mintToken, patch, post } = await import(
	"../../test/api-client"
);

const users = await createUsers("alice", "bob", "carol", "dave");
const del = (token: string) => ({ ...asToken(token), method: "DELETE" });

let alice: string;
let aliceRead: string;
let bob: string;
let carol: string;
let dave: string;
let head: string;

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	aliceRead = await mintToken(users.alice, ["repo:read"]);
	bob = await mintToken(users.bob, ["repo:write"]);
	carol = await mintToken(users.carol, ["repo:write"]);
	dave = await mintToken(users.dave, ["repo:write"]);
	const created = await call(
		"/user/repos",
		post(alice, { name: "proj", auto_init: true }),
	);
	const repoId = created.body.id;
	await call("/user/repos", post(alice, { name: "secret", private: true }));
	signIn(users.alice);
	await repositories.addCollaboratorByUsername({
		data: { repoId, username: "dave", role: "write" },
	});
	await files.uploadFile({
		data: {
			repoId,
			branchName: "main",
			path: "a.txt",
			content: btoa("a\n"),
			commitMessage: "Add a",
		},
	});
	head = (await call("/repos/alice/proj/commits")).body[0].sha;
});

describe("commit comments", () => {
	let id: number;

	it("creates a comment with 201, Location and GitHub's shape", async () => {
		const { status, headers, body } = await call(
			`/repos/alice/proj/commits/${head}/comments`,
			post(bob, { body: "Looks good", path: "a.txt", position: 1, line: 1 }),
		);
		expect(status).toBe(201);
		id = body.id;
		expect(headers.get("location")).toMatch(
			new RegExp(`/api/v3/repos/alice/proj/comments/${id}$`),
		);
		expect(body).toMatchObject({
			body: "Looks good",
			commit_id: head,
			path: "a.txt",
			position: 1,
			line: 1,
			user: { login: "bob" },
			html_url: expect.stringContaining(
				`/alice/proj/commit/${head}#commitcomment-${id}`,
			),
		});
	});

	it("accepts an abbreviated sha and a comment without a path", async () => {
		const { status, body } = await call(
			`/repos/alice/proj/commits/${head.slice(0, 7)}/comments`,
			post(alice, { body: "General" }),
		);
		expect(status).toBe(201);
		expect(body).toMatchObject({ commit_id: head, path: null, line: null });
	});

	it("lists a commit's and the repository's comments, oldest first", async () => {
		const forCommit = await call(`/repos/alice/proj/commits/${head}/comments`);
		expect(forCommit.body.map((c: { body: string }) => c.body)).toEqual([
			"Looks good",
			"General",
		]);
		const forRepo = await call("/repos/alice/proj/comments?per_page=1");
		expect(forRepo.body).toHaveLength(1);
		expect(forRepo.headers.get("link")).toContain('rel="next"');
	});

	it("counts comments in the commit object", async () => {
		const { body } = await call(`/repos/alice/proj/commits/${head}`);
		expect(body.commit.comment_count).toBe(2);
		const list = await call("/repos/alice/proj/commits");
		expect(list.body[0].commit.comment_count).toBe(2);
		expect(list.body[1].commit.comment_count).toBe(0);
	});

	it("rejects unknown commits, paths and empty bodies with 422", async () => {
		const missing = "0".repeat(40);
		expect(
			(await call(`/repos/alice/proj/commits/${missing}/comments`)).status,
		).toBe(422);
		expect(
			(
				await call(
					`/repos/alice/proj/commits/${missing}/comments`,
					post(alice, { body: "x" }),
				)
			).status,
		).toBe(422);
		expect(
			(
				await call(
					`/repos/alice/proj/commits/${head}/comments`,
					post(alice, { body: "x", path: "nope.txt" }),
				)
			).status,
		).toBe(422);
		expect(
			(
				await call(
					`/repos/alice/proj/commits/${head}/comments`,
					post(alice, { body: " " }),
				)
			).status,
		).toBe(422);
	});

	it("needs a token with repo:write to comment", async () => {
		expect(
			(
				await call(`/repos/alice/proj/commits/${head}/comments`, {
					method: "POST",
					body: JSON.stringify({ body: "x" }),
				})
			).status,
		).toBe(401);
		expect(
			(
				await call(
					`/repos/alice/proj/commits/${head}/comments`,
					post(aliceRead, { body: "x" }),
				)
			).status,
		).toBe(403);
	});

	it("lets the author or a write collaborator edit; others get 403", async () => {
		expect(
			(
				await call(
					`/repos/alice/proj/comments/${id}`,
					patch(carol, { body: "no" }),
				)
			).status,
		).toBe(403);
		const own = await call(
			`/repos/alice/proj/comments/${id}`,
			patch(bob, { body: "Edited" }),
		);
		expect(own.status).toBe(200);
		expect(own.body.body).toBe("Edited");
		const moderated = await call(
			`/repos/alice/proj/comments/${id}`,
			patch(dave, { body: "Moderated" }),
		);
		expect(moderated.body.body).toBe("Moderated");
		expect((await call(`/repos/alice/proj/comments/${id}`)).body.body).toBe(
			"Moderated",
		);
	});

	it("deletes with 204, then 404", async () => {
		expect(
			(await call(`/repos/alice/proj/comments/${id}`, del(carol))).status,
		).toBe(403);
		expect(
			(await call(`/repos/alice/proj/comments/${id}`, del(bob))).status,
		).toBe(204);
		expect((await call(`/repos/alice/proj/comments/${id}`)).status).toBe(404);
	});

	it("hides private repositories' comments behind 404", async () => {
		expect(
			(await call("/repos/alice/secret/comments", asToken(bob))).status,
		).toBe(404);
		expect(
			(await call("/repos/alice/secret/comments", asToken(alice))).status,
		).toBe(200);
	});

	it("doesn't serve another repository's comment by id", async () => {
		const other = await call(
			`/repos/alice/proj/commits/${head}/comments`,
			post(alice, { body: "Mine" }),
		);
		expect(
			(
				await call(
					`/repos/alice/secret/comments/${other.body.id}`,
					asToken(alice),
				)
			).status,
		).toBe(404);
	});
});

describe("commit comment server functions", () => {
	const web = () => import("../commit-comments");

	it("posts, lists with edit rights, edits and deletes", async () => {
		const {
			addCommitComment,
			editCommitComment,
			getCommitComments,
			removeCommitComment,
		} = await web();
		const repoId = (await call("/repos/alice/proj")).body.id;
		signIn(users.carol);
		const posted = await addCommitComment({
			data: { repoId, sha: head, body: "From the web" },
		});
		const page = await getCommitComments({ data: { repoId, sha: head } });
		expect(page.canComment).toBe(true);
		expect(page.comments.find((c) => c.id === posted.id)?.canEdit).toBe(true);
		expect(page.comments.find((c) => c.id !== posted.id)?.canEdit).toBe(false);
		await editCommitComment({
			data: { repoId, commentId: posted.id, body: "Edited on the web" },
		});
		signIn(users.bob);
		await expect(
			removeCommitComment({ data: { repoId, commentId: posted.id } }),
		).rejects.toThrow("Access denied");
		signIn(users.carol);
		await removeCommitComment({ data: { repoId, commentId: posted.id } });
		const after = await getCommitComments({ data: { repoId, sha: head } });
		expect(after.comments.some((c) => c.id === posted.id)).toBe(false);
	});

	it("rejects an unknown commit and an invalid sha", async () => {
		const { addCommitComment } = await web();
		const repoId = (await call("/repos/alice/proj")).body.id;
		signIn(users.carol);
		await expect(
			addCommitComment({ data: { repoId, sha: "f".repeat(40), body: "x" } }),
		).rejects.toBeTruthy();
		await expect(
			addCommitComment({ data: { repoId, sha: "../x", body: "x" } }),
		).rejects.toBeTruthy();
	});
});
