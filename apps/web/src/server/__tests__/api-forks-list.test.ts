/**
 * @vitest-environment node
 *
 * Fork visibility on the REST API, in one ordered scenario: `GET
 * /repos/{o}/{r}/forks` lists only the forks the caller can read; a fork's
 * `parent` and `source` appear only when the caller can read them; `forks_count`
 * counts only readable forks; deleting a parent leaves its forks readable with
 * no `parent`.
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
const { call, mintToken, post, patch } = await import("../../test/api-client");
const { db } = await import("#/db");
const { repositoryCollaborators } = await import("#/db/app-schema");
const { invalidateRepositoryAccess } = await import("../repo-access");

const users = await createUsers("alice", "bob", "carol", "dave");
let alice: string;
let bob: string;
let carol: string;
let dave: string;
let secretId: number;

const as = (token?: string) =>
	token ? { authorization: `token ${token}` } : {};
const get = (path: string, token?: string) => call(path, as(token));
const names = (body: Array<{ full_name: string }>) =>
	body.map((repo) => repo.full_name).sort();

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
	bob = await mintToken(users.bob, ["repo:write"]);
	carol = await mintToken(users.carol, ["repo:write"]);
	dave = await mintToken(users.dave, ["repo:write"]);
	await call("/user/repos", post(alice, { name: "lib", auto_init: true }));
	secretId = (
		await call(
			"/user/repos",
			post(alice, { name: "secret-lib", auto_init: true, private: true }),
		)
	).body.id;
	// Bob and Dave read alice's private repository through collaboration.
	for (const who of [users.bob, users.dave]) {
		await db.insert(repositoryCollaborators).values({
			repoId: secretId,
			userId: who.id,
			role: "read",
		});
	}
	invalidateRepositoryAccess(secretId);
	expect((await call("/repos/alice/lib/forks", post(bob, {}))).status).toBe(
		202,
	);
	expect((await call("/repos/alice/lib/forks", post(carol, {}))).status).toBe(
		202,
	);
	expect(
		(await call("/repos/alice/secret-lib/forks", post(bob, {}))).status,
	).toBe(202);
});

describe("listing forks", () => {
	it("lists every public fork to a stranger and to anonymous callers", async () => {
		const stranger = await get("/repos/alice/lib/forks", carol);
		expect(stranger.status).toBe(200);
		expect(names(stranger.body)).toEqual(["bob/lib", "carol/lib"]);
		const anonymous = await get("/repos/alice/lib/forks");
		expect(names(anonymous.body)).toEqual(["bob/lib", "carol/lib"]);
	});

	it("answers 404 for a private parent to a stranger, not an empty list", async () => {
		expect((await get("/repos/alice/secret-lib/forks", carol)).status).toBe(
			404,
		);
		expect((await get("/repos/alice/secret-lib/forks")).status).toBe(404);
	});

	it("hides a private fork from a collaborator on the parent who cannot read the fork", async () => {
		const response = await get("/repos/alice/secret-lib/forks", dave);
		expect(response.status).toBe(200);
		expect(response.body).toEqual([]);
	});

	it("shows the fork to its owner, who can read the parent", async () => {
		const response = await get("/repos/alice/secret-lib/forks", bob);
		expect(names(response.body)).toEqual(["bob/secret-lib"]);
	});

	it("pages and orders the readable forks", async () => {
		const page = await call("/repos/alice/lib/forks?per_page=1", as(carol));
		expect(page.body).toHaveLength(1);
		expect(page.headers.get("link")).toContain('rel="next"');
		const oldest = await get("/repos/alice/lib/forks?sort=oldest", carol);
		expect(
			oldest.body.map((repo: { full_name: string }) => repo.full_name),
		).toEqual(["bob/lib", "carol/lib"]);
		const newest = await get("/repos/alice/lib/forks?sort=newest", carol);
		expect(
			newest.body.map((repo: { full_name: string }) => repo.full_name),
		).toEqual(["carol/lib", "bob/lib"]);
	});
});

describe("forks_count", () => {
	it("counts only the forks the viewer can read", async () => {
		expect((await get("/repos/alice/lib", carol)).body.forks_count).toBe(2);
		expect((await get("/repos/alice/secret-lib", bob)).body.forks_count).toBe(
			1,
		);
		expect((await get("/repos/alice/secret-lib", dave)).body.forks_count).toBe(
			0,
		);
	});
});

describe("parent and source", () => {
	it("are present for a viewer who can read them", async () => {
		const response = await get("/repos/bob/secret-lib", bob);
		expect(response.status).toBe(200);
		expect(response.body).toMatchObject({
			fork: true,
			parent: { full_name: "alice/secret-lib" },
			source: { full_name: "alice/secret-lib" },
		});
	});

	it("omit the fork itself from a viewer who cannot read it, without naming it", async () => {
		expect((await get("/repos/bob/secret-lib", dave)).status).toBe(404);
	});

	it("omit a parent or source the viewer cannot read, keeping the readable one", async () => {
		// carol forks bob's public fork; then alice makes the root private.
		expect(
			(await call("/repos/bob/lib/forks", post(carol, { name: "via-bob" })))
				.status,
		).toBe(202);
		expect(
			(await call("/repos/alice/lib", patch(alice, { private: true }))).status,
		).toBe(200);
		const viaBob = await get("/repos/carol/via-bob", carol);
		expect(viaBob.status).toBe(200);
		expect(viaBob.body.parent).toMatchObject({ full_name: "bob/lib" });
		expect(viaBob.body).not.toHaveProperty("source");

		// bob/lib is public and independent of its now-private parent: its
		// parent is unreadable to a stranger, so it is omitted with no leak.
		const bobLib = await get("/repos/bob/lib", carol);
		expect(bobLib.body.fork).toBe(true);
		expect(bobLib.body).not.toHaveProperty("parent");
		expect(bobLib.body).not.toHaveProperty("source");
	});

	it("are absent once the parent is deleted, and the fork stays readable", async () => {
		expect(
			(
				await call("/repos/alice/secret-lib", {
					method: "DELETE",
					...as(alice),
				})
			).status,
		).toBe(204);
		const fork = await get("/repos/bob/secret-lib", bob);
		expect(fork.status).toBe(200);
		expect(fork.body.fork).toBe(true);
		expect(fork.body).not.toHaveProperty("parent");
		expect(fork.body).not.toHaveProperty("source");
	});
});
