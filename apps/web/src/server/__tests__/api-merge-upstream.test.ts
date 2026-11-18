/**
 * @vitest-environment node
 *
 * `POST /repos/{o}/{r}/merge-upstream` (`gh repo sync`), and a forced
 * `PATCH git/refs/heads/{b}` to a commit only the parent has.
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

void ENV;
const users = await createUsers("alice", "bob", "carol");
let alice: string;
let bob: string;
let carol: string;

const as = (token: string) => ({ authorization: `token ${token}` });
const b64 = (text: string) => Buffer.from(text).toString("base64");
const write = (token: string, repo: string, path: string, text: string) =>
	call(`/repos/${repo}/contents/${path}`, {
		...patch(token, { message: `edit ${path}`, content: b64(text) }),
		method: "PUT",
	});
const sync = (token: string, repo: string, branch = "main") =>
	call(`/repos/${repo}/merge-upstream`, post(token, { branch }));
const tip = async (token: string, repo: string) =>
	(await call(`/repos/${repo}/git/ref/heads/main`, as(token))).body.object.sha;

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	bob = await mintToken(users.bob, ["repo:write"]);
	carol = await mintToken(users.carol, ["repo:write"]);
	await call("/user/repos", post(alice, { name: "lib", auto_init: true }));
	expect((await call("/repos/alice/lib/forks", post(bob, {}))).status).toBe(
		202,
	);
});

describe("merge-upstream", () => {
	it("is already up to date for a fresh fork", async () => {
		const response = await sync(bob, "bob/lib");
		expect(response.status).toBe(200);
		expect(response.body).toMatchObject({
			merge_type: "none",
			base_branch: "alice/lib:main",
		});
	});

	it("fast-forwards after the parent moves, then reports none", async () => {
		expect((await write(alice, "alice/lib", "a.txt", "a\n")).status).toBe(201);
		const response = await sync(bob, "bob/lib");
		expect(response.status).toBe(200);
		expect(response.body.merge_type).toBe("fast-forward");
		expect(await tip(bob, "bob/lib")).toBe(await tip(alice, "alice/lib"));
		expect((await sync(bob, "bob/lib")).body.merge_type).toBe("none");
	});

	it("merges when both moved without a conflict", async () => {
		await write(alice, "alice/lib", "parent.txt", "p\n");
		await write(bob, "bob/lib", "fork.txt", "f\n");
		const response = await sync(bob, "bob/lib");
		expect(response.body.merge_type).toBe("merge");
		const files = await call("/repos/bob/lib/contents", as(bob));
		expect(files.body.map((f: { name: string }) => f.name)).toEqual(
			expect.arrayContaining(["parent.txt", "fork.txt"]),
		);
	});

	it("answers 409 when both changed the same file", async () => {
		await write(alice, "alice/lib", "same.txt", "parent\n");
		await write(bob, "bob/lib", "same.txt", "fork\n");
		const before = await tip(bob, "bob/lib");
		expect((await sync(bob, "bob/lib")).status).toBe(409);
		expect(await tip(bob, "bob/lib")).toBe(before);
	});

	it("422 for a repository that is not a fork, 404 for a missing branch, 403 without write access", async () => {
		expect((await sync(alice, "alice/lib")).status).toBe(422);
		expect((await sync(bob, "bob/lib", "nope")).status).toBe(404);
		expect((await sync(carol, "bob/lib")).status).toBe(403);
	});

	it("forced PATCH of a ref moves the fork to a commit only its parent has", async () => {
		// The fork is behind after the parent's next commit; gh repo sync --force
		// reads the parent's sha and moves the fork's ref to it.
		await write(alice, "alice/lib", "later.txt", "l\n");
		const parentTip = await tip(alice, "alice/lib");
		const moved = await call(
			"/repos/bob/lib/git/refs/heads/main",
			patch(bob, { sha: parentTip, force: true }),
		);
		expect(moved.status).toBe(200);
		expect(await tip(bob, "bob/lib")).toBe(parentTip);
	});
});
