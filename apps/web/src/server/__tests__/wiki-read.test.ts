/**
 * @vitest-environment node
 *
 * Wiki web reads (#393): Home at `/…/wiki`, one page at `/…/wiki/{Page}`,
 * `_Sidebar.md`/`_Footer.md`, the pages list, the create-page state for an
 * unknown page, a 404 when `has_wiki` is off, and the clone-it notice for a
 * page git pushed past the render cap. Edits are allowed by the wiki policy,
 * never guessed on the client.
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

const { createUsers, rejectsNotFound, signIn, signOut } = await import(
	"../../test/app-harness"
);
const users = await createUsers("alice", "bob");
const { call, mintToken, post } = await import("../../test/api-client");
const { authorNow, commitFilesToBare } = await import("git-fs-s3/ops");
const { getWiki, getWikiPage } = await import("../wiki");
const { ensureWikiRepository } = await import("../wiki-git");
const { repoFor } = await import("../git-repo");
const { MAX_WIKI_RENDER_BYTES } = await import("#/lib/limits");

let token: string;
let repoId: number;
let offRepoId: number;

async function seedWiki(files: Record<string, string>): Promise<void> {
	await ensureWikiRepository("alice", "pub");
	await commitFilesToBare(repoFor("alice", "pub", "wiki"), {
		branch: "master",
		message: "Seed wiki",
		author: authorNow("Alice", "alice@example.com"),
		files: Object.entries(files).map(([path, content]) => ({ path, content })),
	});
}

beforeAll(async () => {
	token = await mintToken(users.alice, ["repo:write"]);
	const created = await call("/user/repos", post(token, { name: "pub" }));
	expect(created.status).toBe(201);
	repoId = created.body.id;
	const off = await call(
		"/user/repos",
		post(token, { name: "off", has_wiki: false }),
	);
	expect(off.status).toBe(201);
	offRepoId = off.body.id;
	await seedWiki({
		"Home.md": "# Home\n\nStart with [[Second Page]].\n",
		"_Sidebar.md": "**Sidebar**\n",
		"_Footer.md": "_Footer text_\n",
		"Second-Page.md": "The second page.\n",
		"Too-Big.md": "x".repeat(MAX_WIKI_RENDER_BYTES + 1),
	});
});

describe("wiki reads", () => {
	it("returns Home, the sidebar, the footer and the page list", async () => {
		signIn(users.alice);
		const wiki = await getWiki({ data: { repoId } });
		expect(wiki.page?.name).toBe("Home");
		expect(wiki.page?.content).toContain("[[Second Page]]");
		expect(wiki.page?.tooLarge).toBe(false);
		expect(wiki.sidebar).toContain("**Sidebar**");
		expect(wiki.footer).toContain("_Footer text_");
		expect(wiki.pages).toEqual(["Home", "Second-Page", "Too-Big"]);
	});

	it("reads one page by its slug", async () => {
		signIn(users.alice);
		const wiki = await getWikiPage({
			data: { repoId, page: "Second-Page" },
		});
		expect(wiki.page).toMatchObject({
			name: "Second-Page",
			content: "The second page.\n",
			tooLarge: false,
		});
	});

	it("shows the create state for an unknown page, not a 404", async () => {
		signIn(users.alice);
		const wiki = await getWikiPage({ data: { repoId, page: "Missing" } });
		expect(wiki.page).toBeNull();
	});

	it("returns a too-large notice instead of the page over the render cap", async () => {
		signIn(users.alice);
		const wiki = await getWikiPage({ data: { repoId, page: "Too-Big" } });
		expect(wiki.page?.content).toBeNull();
		expect(wiki.page?.tooLarge).toBe(true);
		expect(wiki.page?.size).toBe(MAX_WIKI_RENDER_BYTES + 1);
	});

	it("lets a signed-in user edit a public wiki, and anonymous only read", async () => {
		signIn(users.bob);
		expect((await getWiki({ data: { repoId } })).canEdit).toBe(true);
		signOut();
		const anonymous = await getWiki({ data: { repoId } });
		expect(anonymous.canEdit).toBe(false);
		expect(anonymous.page?.name).toBe("Home");
	});

	it("answers 404 when has_wiki is off", async () => {
		signIn(users.alice);
		expect(
			await rejectsNotFound(getWiki({ data: { repoId: offRepoId } })),
		).toBe(true);
		expect(
			await rejectsNotFound(
				getWikiPage({ data: { repoId: offRepoId, page: "Home" } }),
			),
		).toBe(true);
	});

	it("rejects a traversal-shaped page slug", async () => {
		signIn(users.alice);
		await expect(
			getWikiPage({ data: { repoId, page: "../etc/passwd" } }),
		).rejects.toThrow(/Invalid wiki page name/);
	});
});
