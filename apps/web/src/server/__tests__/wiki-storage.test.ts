/**
 * @vitest-environment node
 *
 * Wiki storage (#391): the wiki is a second bare repository at
 * `repos/{owner}/{repo}/wiki/git` on `master`, moved and deleted with its
 * repository, not copied by a fork; `has_wiki` defaults to true and a name
 * ending in `.wiki` is refused. pglite + the in-memory git store.
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
const { asToken, call, mintToken, patch, post } = await import(
	"../../test/api-client"
);
const { gitFs } = await import("../git-fs");
const { getRepoWikiGitStorageRoot } = await import("../git-storage-naming");
const { findRepositoryByName } = await import("../repository-lookup");
const { forkRepositoryForUser } = await import("../repository-fork");
const { ensureWikiRepository } = await import("../wiki-git");

const del = (token: string) => ({ ...asToken(token), method: "DELETE" });

let alice: string;

beforeAll(async () => {
	alice = await mintToken(users.alice, ["repo:write"]);
});

async function wikiHead(owner: string, repo: string): Promise<string | null> {
	try {
		return String(
			await gitFs.promises.readFile(
				`${getRepoWikiGitStorageRoot(owner, repo)}/HEAD`,
				"utf8",
			),
		);
	} catch (error) {
		if ((error as { code?: string } | null)?.code === "ENOENT") return null;
		throw error;
	}
}

describe("ensureWikiRepository", () => {
	it("initializes an empty wiki on master, idempotently, when has_wiki is on", async () => {
		await call("/user/repos", post(alice, { name: "pub" }));
		await ensureWikiRepository("alice", "pub");
		expect(await wikiHead("alice", "pub")).toBe("ref: refs/heads/master\n");

		// A branch ref does not exist yet: cloning is an empty repository.
		await expect(
			gitFs.promises.readFile(
				`${getRepoWikiGitStorageRoot("alice", "pub")}/refs/heads/master`,
			),
		).rejects.toMatchObject({ code: "ENOENT" });

		await ensureWikiRepository("alice", "pub");
		expect(await wikiHead("alice", "pub")).toBe("ref: refs/heads/master\n");
	});

	it("refuses when the repository's wiki is disabled", async () => {
		await call("/user/repos", post(alice, { name: "nowiki", has_wiki: false }));
		await expect(ensureWikiRepository("alice", "nowiki")).rejects.toThrow(
			"Repository not found",
		);
		expect(await wikiHead("alice", "nowiki")).toBeNull();
	});
});

describe("wiki lifecycle", () => {
	it("moves the wiki with a rename", async () => {
		await call("/user/repos", post(alice, { name: "before" }));
		await ensureWikiRepository("alice", "before");
		const renamed = await call(
			"/repos/alice/before",
			patch(alice, { name: "after" }),
		);
		expect(renamed.status).toBe(200);
		expect(await wikiHead("alice", "after")).toBe("ref: refs/heads/master\n");
		expect(await wikiHead("alice", "before")).toBeNull();
	});

	it("deletes the wiki with the repository", async () => {
		await call("/user/repos", post(alice, { name: "gone" }));
		await ensureWikiRepository("alice", "gone");
		expect((await call("/repos/alice/gone", del(alice))).status).toBe(204);
		expect(await wikiHead("alice", "gone")).toBeNull();
	});

	it("does not copy the wiki to a fork", async () => {
		await call("/user/repos", post(alice, { name: "src", auto_init: true }));
		await ensureWikiRepository("alice", "src");
		const parent = await findRepositoryByName("alice", "src");
		if (!parent) throw new Error("parent missing");
		await forkRepositoryForUser(parent, users.bob, "src");
		expect(await wikiHead("alice", "src")).toBe("ref: refs/heads/master\n");
		expect(await wikiHead("bob", "src")).toBeNull();
	});
});

describe("has_wiki and repository names", () => {
	it("reports has_wiki true for a repository created without it", async () => {
		const created = await call("/user/repos", post(alice, { name: "plain" }));
		expect(created.body.has_wiki).toBe(true);
	});

	it("refuses a name ending in .wiki with 422", async () => {
		const refused = await call("/user/repos", post(alice, { name: "x.wiki" }));
		expect(refused.status).toBe(422);
		expect(refused.body.errors).toEqual([
			{ resource: "Repository", field: "name", code: "invalid" },
		]);
	});
});
