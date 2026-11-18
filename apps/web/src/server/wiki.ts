import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { MAX_WIKI_PAGE_CHARS } from "#/lib/limits";
import { safeWikiPageSchema } from "#/lib/wiki-page";
import {
	getViewerRepositoryAccess,
	type RepositoryWithOwner,
	readWithAccess,
	writeWithWikiAccess,
} from "./repo-access";
import {
	deleteWikiPage as deleteWikiPageFromGit,
	listWikiPages,
	readWikiChrome,
	readWikiPage,
	saveWikiPage as saveWikiPageToGit,
	type WikiPage,
} from "./wiki-git";

const WIKI_HOME = "Home";

interface WikiView {
	page: WikiPage | null;
	sidebar: string | null;
	footer: string | null;
	pages: string[];
	/** Server-side `wikiEdit`: the page never guesses from a client flag. */
	canEdit: boolean;
}

async function readWikiView(
	repo: RepositoryWithOwner,
	page: string,
): Promise<WikiView> {
	const ownerKey = repo.owner.login;
	const [content, chrome, pages, viewer] = await Promise.all([
		readWikiPage(ownerKey, repo.name, page),
		readWikiChrome(ownerKey, repo.name),
		listWikiPages(ownerKey, repo.name),
		getViewerRepositoryAccess(repo.id),
	]);
	return { page: content, ...chrome, pages, canEdit: viewer.canEditWiki };
}

export const getWiki = createServerFn({ method: "GET" })
	.validator(z.object({ repoId: z.number() }))
	.handler(({ data }) =>
		readWithAccess("getWiki", data.repoId, async (repo) => {
			if (!repo.hasWiki) throw notFound();
			return readWikiView(repo, WIKI_HOME);
		}),
	);

export const getWikiPage = createServerFn({ method: "GET" })
	.validator(z.object({ repoId: z.number(), page: safeWikiPageSchema }))
	.handler(({ data }) =>
		readWithAccess("getWikiPage", data.repoId, async (repo) => {
			if (!repo.hasWiki) throw notFound();
			return readWikiView(repo, data.page);
		}),
	);

const wikiWriteInput = z.object({
	repoId: z.number(),
	page: safeWikiPageSchema,
	content: z.string().max(MAX_WIKI_PAGE_CHARS),
});

export const saveWikiPage = createServerFn({ method: "POST" })
	.validator(wikiWriteInput)
	.handler(({ data }) =>
		writeWithWikiAccess(data.repoId, async (repo, user) => {
			const saved = await saveWikiPageToGit(repo.owner.login, repo.name, {
				page: data.page,
				content: data.content,
				author: { name: user.name, email: user.email },
			});
			return saved;
		}),
	);

export const deleteWikiPage = createServerFn({ method: "POST" })
	.validator(z.object({ repoId: z.number(), page: safeWikiPageSchema }))
	.handler(({ data }) =>
		writeWithWikiAccess(data.repoId, async (repo, user) => {
			const deleted = await deleteWikiPageFromGit(repo.owner.login, repo.name, {
				page: data.page,
				author: { name: user.name, email: user.email },
			});
			return deleted;
		}),
	);
