/**
 * A wiki is a second bare repository per repository, at
 * `repos/{ownerKey}/{repoName}/wiki/git`, on branch `master` with `HEAD ->
 * refs/heads/master` (GitHub's) so cloning a fresh wiki is an empty
 * repository, not a failure. Every wiki write takes the repository's own
 * lease: it is the same repository, only a second gitdir.
 *
 * GitHub has no wiki content API, and neither does this: pages are markdown
 * files in the wiki's root tree (`Getting-Started.md`), so every read is one
 * tree listing and, at most, a page's blob.
 */
import {
	GitRepositoryNotFoundError,
	getObjectSizes,
	isNotFoundError,
} from "git-fs-s3";
import {
	authorNow,
	commitFilesToBare,
	deleteFileFromBare,
	getBlob,
	getTreeFromRef,
	type TreeEntry,
} from "git-fs-s3/ops";
import { MAX_WIKI_PAGES, MAX_WIKI_RENDER_BYTES } from "#/lib/limits";
import {
	pageFileName,
	pageSlugFromTitle,
	safeWikiPageSchema,
	WIKI_CHROME_FILES,
} from "#/lib/wiki-page";
import { opsHooksFor } from "./git-cache";
import { gitFs } from "./git-fs";
import { afterRepositoryPush, initBareRepo, repoFor } from "./git-repo";
import { withRepositoryLock } from "./git-repo-lock";
import { getRepoWikiGitStorageRoot } from "./git-storage-naming";
import type { CommitAuthorInput } from "./git-write";
import { ARCHIVED_MESSAGE } from "./repo-access";
import { findRepositoryByName } from "./repository-lookup";

export const WIKI_BRANCH = "master";
export const WIKI_REF = `refs/heads/${WIKI_BRANCH}`;

function wikiRepoFor(ownerKey: string, repoName: string) {
	return repoFor(ownerKey, repoName, "wiki");
}

async function wikiRepositoryExists(
	ownerKey: string,
	repoName: string,
): Promise<boolean> {
	try {
		await gitFs.promises.stat(
			`${getRepoWikiGitStorageRoot(ownerKey, repoName)}/HEAD`,
		);
		return true;
	} catch (error) {
		if ((error as { code?: string } | null)?.code !== "ENOENT") throw error;
		return false;
	}
}

/** Init the wiki's bare repository under the caller's lock, unless it exists. */
async function ensureWikiRepositoryUnlocked(
	ownerKey: string,
	repoName: string,
): Promise<void> {
	if (await wikiRepositoryExists(ownerKey, repoName)) return;
	await initBareRepo(ownerKey, repoName, WIKI_BRANCH, "wiki");
}

/**
 * Create the wiki's repository unless it already exists. Idempotent and under
 * the repository lock, so the first clone of a fresh wiki and the web editor's
 * first save race safely; refuses when the repository's wiki is disabled.
 */
export async function ensureWikiRepository(
	ownerKey: string,
	repoName: string,
): Promise<void> {
	const repository = await findRepositoryByName(ownerKey, repoName);
	if (!repository?.hasWiki) {
		throw new GitRepositoryNotFoundError("Repository not found");
	}
	await withRepositoryLock(ownerKey, repoName, () =>
		ensureWikiRepositoryUnlocked(ownerKey, repoName),
	);
}

/** The wiki's root tree entries; [] until its first page is committed. */
async function wikiRootEntries(
	ownerKey: string,
	repoName: string,
): Promise<TreeEntry[]> {
	try {
		return await getTreeFromRef(
			wikiRepoFor(ownerKey, repoName),
			{ ref: WIKI_REF },
			opsHooksFor(ownerKey, repoName, "wiki"),
		);
	} catch (error) {
		// An empty wiki has no `master` yet: no pages, not a failure.
		if (isNotFoundError(error)) return [];
		throw error;
	}
}

/** Page names (file names without `.md`), alphabetically, `Home` first. */
export async function listWikiPages(
	ownerKey: string,
	repoName: string,
): Promise<string[]> {
	const entries = await wikiRootEntries(ownerKey, repoName);
	return entries
		.filter(
			(entry) =>
				entry.type === "blob" &&
				entry.path.endsWith(".md") &&
				!entry.path.includes("/") &&
				!WIKI_CHROME_FILES.has(entry.path),
		)
		.slice(0, MAX_WIKI_PAGES)
		.map((entry) => entry.path.slice(0, -".md".length))
		.sort((a, b) =>
			a === "Home" ? -1 : b === "Home" ? 1 : a.localeCompare(b),
		);
}

export interface WikiPageContent {
	/** The markdown, or null when the blob is over {@link MAX_WIKI_RENDER_BYTES}. */
	content: string | null;
	size: number;
	tooLarge: boolean;
}

export interface WikiPage extends WikiPageContent {
	name: string;
}

async function readBlob(
	ownerKey: string,
	repoName: string,
	entry: TreeEntry,
): Promise<WikiPageContent> {
	const repo = wikiRepoFor(ownerKey, repoName);
	const size = (await getObjectSizes(repo, [entry.oid])).get(entry.oid) ?? null;
	if (size !== null && size > MAX_WIKI_RENDER_BYTES) {
		return { content: null, size, tooLarge: true };
	}
	const bytes = await getBlob(repo, entry.oid);
	if (bytes.byteLength > MAX_WIKI_RENDER_BYTES) {
		return { content: null, size: bytes.byteLength, tooLarge: true };
	}
	return {
		content: new TextDecoder().decode(bytes),
		size: bytes.byteLength,
		tooLarge: false,
	};
}

/** One page, or null when it does not exist yet (GitHub's create state). */
export async function readWikiPage(
	ownerKey: string,
	repoName: string,
	page: string,
): Promise<WikiPage | null> {
	const name = safeWikiPageSchema.parse(page);
	const filePath = pageFileName(name);
	const entry = (await wikiRootEntries(ownerKey, repoName)).find(
		(candidate) => candidate.type === "blob" && candidate.path === filePath,
	);
	if (!entry) return null;
	return { name, ...(await readBlob(ownerKey, repoName, entry)) };
}

export interface WikiChrome {
	sidebar: string | null;
	footer: string | null;
}

/** `_Sidebar.md` and `_Footer.md`, rendered around every page. */
export async function readWikiChrome(
	ownerKey: string,
	repoName: string,
): Promise<WikiChrome> {
	const entries = await wikiRootEntries(ownerKey, repoName);
	const chrome: WikiChrome = { sidebar: null, footer: null };
	for (const [key, file] of [
		["sidebar", "_Sidebar.md"],
		["footer", "_Footer.md"],
	] as const) {
		const entry = entries.find(
			(candidate) => candidate.type === "blob" && candidate.path === file,
		);
		if (!entry) continue;
		chrome[key] = (await readBlob(ownerKey, repoName, entry)).content;
	}
	return chrome;
}

/** Refuse a write to a repository with no wiki, or an archived one. */
async function assertWikiWritable(
	ownerKey: string,
	repoName: string,
): Promise<void> {
	const repository = await findRepositoryByName(ownerKey, repoName);
	if (!repository?.hasWiki) {
		throw new GitRepositoryNotFoundError("Repository not found");
	}
	if (repository.archived) throw new Error(ARCHIVED_MESSAGE);
}

/**
 * One page save is one commit on `master`; the first save in an empty wiki
 * creates the branch. The message defaults to GitHub's "Updated <Page>".
 */
export async function saveWikiPage(
	ownerKey: string,
	repoName: string,
	options: {
		page: string;
		content: string;
		author: CommitAuthorInput;
		message?: string;
	},
): Promise<{ commitSha: string; page: string }> {
	const page = safeWikiPageSchema.parse(pageSlugFromTitle(options.page));
	await assertWikiWritable(ownerKey, repoName);
	const commitSha = await withRepositoryLock(ownerKey, repoName, async () => {
		await ensureWikiRepositoryUnlocked(ownerKey, repoName);
		const oid = await commitFilesToBare(wikiRepoFor(ownerKey, repoName), {
			branch: WIKI_BRANCH,
			message: options.message ?? `Updated ${page}`,
			author: authorNow(options.author.name, options.author.email),
			files: [{ path: pageFileName(page), content: options.content }],
		});
		afterRepositoryPush(ownerKey, repoName, "wiki");
		return oid;
	});
	return { commitSha, page };
}

/** Delete one page in one commit; the wiki's other pages and chrome stay. */
export async function deleteWikiPage(
	ownerKey: string,
	repoName: string,
	options: {
		page: string;
		author: CommitAuthorInput;
		message?: string;
	},
): Promise<{ commitSha: string; page: string }> {
	const page = safeWikiPageSchema.parse(pageSlugFromTitle(options.page));
	await assertWikiWritable(ownerKey, repoName);
	const commitSha = await withRepositoryLock(ownerKey, repoName, async () => {
		await ensureWikiRepositoryUnlocked(ownerKey, repoName);
		const oid = await deleteFileFromBare(wikiRepoFor(ownerKey, repoName), {
			branch: WIKI_BRANCH,
			filePath: pageFileName(page),
			message: options.message ?? `Deleted ${page}`,
			author: authorNow(options.author.name, options.author.email),
		});
		afterRepositoryPush(ownerKey, repoName, "wiki");
		return oid;
	});
	return { commitSha, page };
}
