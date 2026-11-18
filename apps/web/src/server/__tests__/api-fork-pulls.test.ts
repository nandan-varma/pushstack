/**
 * @vitest-environment node
 *
 * Pull requests from a fork: opened with `head: "owner:branch"`, the head is
 * copied into the base and pinned, follows the fork branch on each read,
 * merges, and survives the fork's deletion.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

const ENV = vi.hoisted(() => {
	process.env.R2_BUCKET_NAME = "test-bucket";
	process.env.R2_ENDPOINT = "https://test-account.r2.cloudflarestorage.com";
	process.env.R2_ACCESS_KEY_ID = "test-key";
	process.env.R2_SECRET_ACCESS_KEY = "test-secret";
});

vi.mock("#/lib/r2", async (importOriginal) => {
	const actual = await importOriginal<typeof import("#/lib/r2")>();
	const { createFetchS3Store } = await import("git-fs-s3/fetch-s3");
	const { createFakeS3 } = await import("git-fs-s3/testing");
	const s3 = createFakeS3({ bucket: "test-bucket" });
	return {
		...actual,
		createR2ObjectStoreFromEnv: (
			contentType?: (key: string) => string | undefined,
		) =>
			createFetchS3Store({
				endpoint: "https://test-account.r2.cloudflarestorage.com",
				bucket: "test-bucket",
				accessKeyId: "test-key",
				secretAccessKey: "test-secret",
				contentType,
				fetch: s3.fetch,
			}),
	};
});
vi.mock("#/db", async () => ({
	db: await (await import("../../test/pglite-db")).createTestDb(),
}));
vi.mock("@tanstack/react-start", () => import("../../test/server-test-utils"));
vi.mock(
	"#/server/session",
	async () => (await import("../../test/app-harness")).sessionModule,
);

const { createUsers } = await import("../../test/app-harness");
const { call, mintToken, post, patch } = await import("../../test/api-client");
const { createBranch } = await import("../git-write");
const { graphql } = await import("../../test/graphql-client");

void ENV;

const users = await createUsers("alice", "bob", "carol");
let alice: string;
let bob: string;
let carol: string;

const as = (token: string) => ({ authorization: `token ${token}` });
const b64 = (text: string) => Buffer.from(text).toString("base64");
const write = (
	token: string,
	repo: string,
	path: string,
	text: string,
	branch: string,
) =>
	call(`/repos/${repo}/contents/${path}`, {
		...patch(token, { message: `edit ${path}`, content: b64(text), branch }),
		method: "PUT",
	});
const tip = async (token: string, repo: string, branch: string) =>
	(await call(`/repos/${repo}/git/ref/heads/${branch}`, as(token))).body.object
		.sha;
const openPull = (token: string, head: string, extra: object = {}) =>
	call(
		"/repos/alice/lib/pulls",
		post(token, { title: "From a fork", head, base: "main", ...extra }),
	);
const files = async (token: string) =>
	(await call("/repos/alice/lib/pulls/1/files", as(token))).body.map(
		(f: { filename: string }) => f.filename,
	);

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	bob = await mintToken(users.bob, ["repo:write"]);
	carol = await mintToken(users.carol, ["repo:write"]);
	await call("/user/repos", post(alice, { name: "lib", auto_init: true }));
	await call("/user/repos", post(carol, { name: "lib", auto_init: true }));
	expect((await call("/repos/alice/lib/forks", post(bob, {}))).status).toBe(
		202,
	);
	await createBranch("bob", "lib", "feature", "main");
	await write(bob, "bob/lib", "feature.txt", "one\n", "feature");
	await createBranch("carol", "lib", "feature", "main");
	await write(carol, "carol/lib", "x.txt", "x\n", "feature");
});

describe("pull requests from a fork", () => {
	it("refuses a head from a repository outside the fork network, and a missing branch", async () => {
		expect((await openPull(carol, "carol:feature")).status).toBe(422);
		expect((await openPull(bob, "bob:nope")).status).toBe(422);
		expect((await openPull(bob, "nobody:feature")).status).toBe(422);
	});

	it("opens a pull request with head.repo, head.label and the fork's sha", async () => {
		const forkTip = await tip(bob, "bob/lib", "feature");
		const response = await openPull(bob, "bob:feature");
		expect(response.status).toBe(201);
		expect(response.body.head).toMatchObject({
			label: "bob:feature",
			ref: "feature",
			sha: forkTip,
			user: { login: "bob" },
			repo: { full_name: "bob/lib" },
		});
		expect(response.body.base.repo.full_name).toBe("alice/lib");
		expect(await files(alice)).toEqual(["feature.txt"]);
	});

	it("refuses a duplicate and filters the list by owner:branch", async () => {
		expect((await openPull(bob, "bob:feature")).status).toBe(422);
		const some = await call(
			"/repos/alice/lib/pulls?head=bob:feature",
			as(alice),
		);
		expect(some.body.map((p: { number: number }) => p.number)).toEqual([1]);
		const none = await call(
			"/repos/alice/lib/pulls?head=alice:feature",
			as(alice),
		);
		expect(none.body).toEqual([]);
	});

	it("follows the fork branch on the next read", async () => {
		await write(bob, "bob/lib", "two.txt", "two\n", "feature");
		const view = await call("/repos/alice/lib/pulls/1", as(alice));
		expect(view.body.head.sha).toBe(await tip(bob, "bob/lib", "feature"));
		expect(view.body.commits).toBe(2);
		expect(await files(alice)).toEqual(["feature.txt", "two.txt"]);
	});

	it("is not a clone-visible ref of the base", async () => {
		const refs = await call(
			"/repos/alice/lib/git/matching-refs/heads",
			as(alice),
		);
		expect(refs.body.map((r: { ref: string }) => r.ref)).toEqual([
			"refs/heads/main",
		]);
	});

	it("GraphQL reports the fork and opens a pull request from it (gh pr create)", async () => {
		const view = await graphql(
			alice,
			`{ repository(owner: "alice", name: "lib") { id pullRequest(number: 1) { isCrossRepository headRefName headRefOid headRepository { nameWithOwner } headRepositoryOwner { login } } } }`,
		);
		expect(view.body.errors).toBeUndefined();
		const pull = view.body.data.repository.pullRequest;
		expect(pull).toMatchObject({
			isCrossRepository: true,
			headRefName: "feature",
			headRefOid: await tip(bob, "bob/lib", "feature"),
			headRepository: { nameWithOwner: "bob/lib" },
			headRepositoryOwner: { login: "bob" },
		});

		await createBranch("bob", "lib", "feature2", "main");
		await write(bob, "bob/lib", "gql.txt", "gql\n", "feature2");
		const forkId = (
			await graphql(bob, `{ repository(owner: "bob", name: "lib") { id } }`)
		).body.data.repository.id;
		const created = await graphql(
			bob,
			`mutation($input: CreatePullRequestInput!) { createPullRequest(input: $input) { pullRequest { number isCrossRepository headRefName headRepository { nameWithOwner } } } }`,
			{
				input: {
					repositoryId: view.body.data.repository.id,
					headRepositoryId: forkId,
					baseRefName: "main",
					headRefName: "bob:feature2",
					title: "From GraphQL",
				},
			},
		);
		expect(created.body.errors).toBeUndefined();
		expect(created.body.data.createPullRequest.pullRequest).toMatchObject({
			number: 2,
			isCrossRepository: true,
			headRefName: "feature2",
			headRepository: { nameWithOwner: "bob/lib" },
		});
	});

	it("merges into the base and keeps rendering after the fork is deleted", async () => {
		const merged = await call("/repos/alice/lib/pulls/1/merge", {
			...patch(alice, {}),
			method: "PUT",
		});
		expect(merged.status).toBe(200);
		const file = await call("/repos/alice/lib/contents/two.txt", as(alice));
		expect(file.status).toBe(200);

		const deleted = await call("/repos/bob/lib", {
			...as(bob),
			method: "DELETE",
		});
		expect(deleted.status).toBe(204);
		const view = await call("/repos/alice/lib/pulls/1", as(alice));
		expect(view.status).toBe(200);
		expect(view.body).toMatchObject({
			merged: true,
			head: { label: "bob:feature", repo: null, user: { login: "bob" } },
		});
		expect(await files(alice)).toEqual(["feature.txt", "two.txt"]);
	});
});
