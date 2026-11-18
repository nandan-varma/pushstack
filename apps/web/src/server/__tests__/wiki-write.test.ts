/**
 * @vitest-environment node
 *
 * Wiki web writes (#394): `_new` and `_edit` save one commit on `master`, a
 * page titled "Getting Started" is `Getting-Started.md`, deleting removes the
 * file, and the write path refuses a bad page name, an archived repository
 * and a page over the editor's cap without committing anything.
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
const users = await createUsers("alice");
const { call, mintToken, post } = await import("../../test/api-client");
const { getCommitHistory, getTreeFromRef } = await import("git-fs-s3/ops");
const git = await import("isomorphic-git");
const { MAX_WIKI_PAGE_CHARS } = await import("#/lib/limits");
const { deleteWikiPage, saveWikiPage } = await import("../wiki");
const { repoFor } = await import("../git-repo");
const { ARCHIVED_MESSAGE } = await import("../repo-access");
const { updateRepository } = await import("../repositories");
const { WIKI_REF } = await import("../wiki-git");

let repoId: number;
let archivedId: number;

async function commits(): Promise<number> {
	return (
		await getCommitHistory(repoFor("alice", "pub", "wiki"), {
			ref: WIKI_REF,
			limit: 100,
		})
	).length;
}

async function wikiFiles(): Promise<string[]> {
	return (
		await getTreeFromRef(repoFor("alice", "pub", "wiki"), { ref: WIKI_REF })
	).map((entry) => entry.path);
}

beforeAll(async () => {
	const token = await mintToken(users.alice, ["repo:write"]);
	const created = await call("/user/repos", post(token, { name: "pub" }));
	expect(created.status).toBe(201);
	repoId = created.body.id;
	const archived = await call("/user/repos", post(token, { name: "arch" }));
	expect(archived.status).toBe(201);
	archivedId = archived.body.id;
	signIn(users.alice);
	await updateRepository({ data: { id: archivedId, archived: true } });
});

describe("wiki writes", () => {
	it("creates 'Getting Started' as Getting-Started.md in one commit", async () => {
		const saved = await saveWikiPage({
			data: {
				repoId,
				page: "Getting Started",
				content: "# Getting Started\n",
			},
		});
		expect(saved.page).toBe("Getting-Started");
		expect(await commits()).toBe(1);
		expect(await wikiFiles()).toEqual(["Getting-Started.md"]);

		const [commit] = await getCommitHistory(repoFor("alice", "pub", "wiki"), {
			ref: WIKI_REF,
			limit: 1,
		});
		expect(commit?.commit.message.trim()).toBe("Updated Getting-Started");
		// The first save created `master`, and `HEAD` resolves to it.
		expect(
			await git.resolveRef({ ...repoFor("alice", "pub", "wiki"), ref: "HEAD" }),
		).toBe(saved.commitSha);
	});

	it("saves an edit as a second commit", async () => {
		await saveWikiPage({
			data: {
				repoId,
				page: "Getting-Started",
				content: "# Edited\n",
			},
		});
		expect(await commits()).toBe(2);
	});

	it("deletes a page in its own commit", async () => {
		await deleteWikiPage({ data: { repoId, page: "Getting-Started" } });
		expect(await commits()).toBe(3);
		expect(await wikiFiles()).toEqual([]);
	});

	it("rejects a traversal, a dot name and a reserved action name", async () => {
		const before = await commits();
		for (const page of ["a/b", "..", "_edit"]) {
			await expect(
				saveWikiPage({ data: { repoId, page, content: "x" } }),
			).rejects.toThrow(/Invalid wiki page name/);
		}
		expect(await commits()).toBe(before);
	});

	it("refuses an archived repository", async () => {
		await expect(
			saveWikiPage({
				data: { repoId: archivedId, page: "Home", content: "x" },
			}),
		).rejects.toThrow(ARCHIVED_MESSAGE);
	});

	it("rejects content over the cap and leaves the page unchanged", async () => {
		await saveWikiPage({ data: { repoId, page: "Home", content: "small" } });
		await expect(
			saveWikiPage({
				data: {
					repoId,
					page: "Home",
					content: "x".repeat(MAX_WIKI_PAGE_CHARS + 1),
				},
			}),
		).rejects.toThrow(/Too big/);

		const { getWikiPage } = await import("../wiki");
		const wiki = await getWikiPage({ data: { repoId, page: "Home" } });
		expect(wiki.page?.content).toBe("small");
	});
});
