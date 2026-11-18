/**
 * A gist's git side: the gist twin of `git-repo.ts` + `git-read.ts` +
 * `git-write.ts`, over the same `git-fs-s3/ops` primitives. A gist is a bare
 * repository with one branch, `master` — GitHub's default for gist
 * repositories — whose bytes live at `gists/{id}/git`.
 */
import { getRepoCache, invalidateRepoCache } from "git-edge";
import {
	GitInvalidRequestError,
	getObjectSizes,
	isSafeTreePath,
} from "git-fs-s3";
import {
	authorNow,
	type CommitInfo,
	commitFilesToBare,
	deleteFromTree,
	getBlob,
	getCommitDiff,
	getCommitHistory,
	listTreeEntries,
	type OpsHooks,
	type Repo,
	resolveCommit,
	resultKeyPrefixes,
	type TreeEntry,
	upsertTree,
	writeCommitToBare,
} from "git-fs-s3/ops";
import git from "isomorphic-git";
import {
	MAX_GIST_INLINE_CONTENT_BYTES,
	MAX_GIST_INLINE_RESPONSE_BYTES,
	MAX_HISTORY_WALK,
} from "#/lib/limits";
import { invalidateResultCache, opsHooksWith } from "./git-cache";
import { gitFs, prefetchGistPacks, registerGistGitdir } from "./git-fs";
import { withGistLock } from "./git-repo-lock";
import { getGistGitStorageRoot } from "./git-storage-naming";
import type { CommitAuthorInput } from "./git-write";

export const GIST_BRANCH = "master";

/**
 * A gist commit carries no message: GitHub's revision labels ("created this
 * gist", "edited this gist") are page text, not commit messages — a cloned
 * GitHub gist's commits are empty.
 */
const GIST_COMMIT_MESSAGE = "";

/** The `Repo` every git call for a gist uses; see `repoFor` in `git-repo.ts`. */
export function gistRepoFor(id: string): Repo {
	return {
		fs: gitFs,
		gitdir: registerGistGitdir(id),
		cache: getRepoCache("gists", id),
	};
}

export function gistOpsHooks(id: string): OpsHooks {
	return opsHooksWith(() => prefetchGistPacks(id));
}

export function initGistRepo(id: string): Promise<void> {
	return git.init({
		fs: gitFs,
		dir: getGistGitStorageRoot(id),
		defaultBranch: GIST_BRANCH,
		bare: true,
	});
}

export interface GistFileInput {
	path: string;
	content: string | Uint8Array;
}

/** The first commit: every file a gist was created with, under its lock. */
export async function createGistFiles(
	id: string,
	files: readonly GistFileInput[],
	author: CommitAuthorInput,
): Promise<string> {
	assertPaths(files.map((file) => file.path));
	return await withGistLock(id, async () => {
		const oid = await commitFilesToBare(gistRepoFor(id), {
			branch: GIST_BRANCH,
			message: GIST_COMMIT_MESSAGE,
			author: authorNow(author.name, author.email),
			files: [...files],
		});
		afterGistWrite(id);
		return oid;
	});
}

export interface GistUpdate {
	/** Files to write; a path that already exists is replaced. */
	files?: readonly GistFileInput[];
	/** Files to remove (a rename is a delete plus a write of the new path). */
	deletes?: readonly string[];
}

/**
 * One commit over an existing gist: writes and removals land in the same tree
 * operations, so an update is one revision, never one per file.
 */
export async function applyGistUpdate(
	id: string,
	update: GistUpdate,
	author: CommitAuthorInput,
): Promise<string> {
	const files = update.files ?? [];
	const deletes = update.deletes ?? [];
	if (files.length === 0 && deletes.length === 0) {
		throw new GitInvalidRequestError("A gist update needs a file change");
	}
	assertPaths([...files.map((file) => file.path), ...deletes]);
	return await withGistLock(id, async () => {
		const oid = await writeCommitToBare(gistRepoFor(id), {
			branch: GIST_BRANCH,
			message: GIST_COMMIT_MESSAGE,
			author: authorNow(author.name, author.email),
			buildTree: async (parentTreeOid, writeRepo) => {
				if (!parentTreeOid) {
					throw new GitInvalidRequestError("The gist has no files yet");
				}
				let treeOid = parentTreeOid;
				for (const path of deletes) {
					treeOid = await deleteFromTree(writeRepo, treeOid, path);
				}
				if (files.length > 0) {
					const blobs = new Map<string, string>();
					for (const file of files) {
						const content =
							typeof file.content === "string"
								? new TextEncoder().encode(file.content)
								: file.content;
						blobs.set(
							file.path,
							await git.writeBlob({ ...writeRepo, blob: content }),
						);
					}
					treeOid = await upsertTree(writeRepo, treeOid, blobs);
				}
				return treeOid;
			},
		});
		afterGistWrite(id);
		return oid;
	});
}

export interface GistFile {
	path: string;
	oid: string;
	size: number;
	/** The bytes, or null when a size or response budget left them out. */
	content: Uint8Array | null;
	truncated: boolean;
}

/**
 * A gist's files at a revision (default `HEAD`). Sizes come before content,
 * so both truncation budgets are applied before a blob is read: a file over
 * {@link MAX_GIST_INLINE_CONTENT_BYTES}, or one that would push the response
 * past {@link MAX_GIST_INLINE_RESPONSE_BYTES}, is listed without content.
 */
export async function readGistFiles(
	id: string,
	revision = "HEAD",
): Promise<GistFile[]> {
	const repo = gistRepoFor(id);
	const { commit } = await resolveCommit(repo, revision);
	const entries = await listBlobs(repo, commit.tree);
	const sizes = await getObjectSizes(
		repo,
		entries.map((entry) => entry.oid),
	);
	const files: GistFile[] = [];
	let budget = MAX_GIST_INLINE_RESPONSE_BYTES;
	for (const entry of entries) {
		const known = sizes.get(entry.oid) ?? null;
		if (known !== null && known > MAX_GIST_INLINE_CONTENT_BYTES) {
			files.push({ ...entry, size: known, content: null, truncated: true });
			continue;
		}
		// A loose object's size is unknown before reading it; the byte length
		// read is then what the budgets are checked against.
		const content = await getBlob(repo, entry.oid);
		const size = content.byteLength;
		if (size > MAX_GIST_INLINE_CONTENT_BYTES || size > budget) {
			files.push({ ...entry, size, content: null, truncated: true });
			continue;
		}
		budget -= size;
		files.push({ ...entry, size, content, truncated: false });
	}
	return files;
}

export interface GistCommit {
	commit: CommitInfo;
	/** Lines against the first parent, as GitHub's `Gist Commit` reports them. */
	changeStatus: { total: number; additions: number; deletions: number };
}

/** One page of a gist's history, newest first, with each commit's line counts. */
export async function gistCommitPage(
	id: string,
	limit: number,
	skip = 0,
): Promise<GistCommit[]> {
	const repo = gistRepoFor(id);
	const hooks = gistOpsHooks(id);
	const boundedSkip = Math.max(0, Math.min(skip, MAX_HISTORY_WALK - limit));
	const commits = await getCommitHistory(
		repo,
		{ ref: "HEAD", limit, skip: boundedSkip },
		hooks,
	);
	return Promise.all(
		commits.map(async (commit) => {
			const diff = await getCommitDiff(repo, commit.oid);
			return {
				commit,
				changeStatus: {
					total: diff.totalAdditions + diff.totalDeletions,
					additions: diff.totalAdditions,
					deletions: diff.totalDeletions,
				},
			};
		}),
	);
}

/**
 * Bookkeeping after a gist write, inside its lock: drop the gist's result
 * caches (keyed per head sha) and its isomorphic-git pack-index cache.
 */
export function afterGistWrite(id: string): void {
	for (const prefix of resultKeyPrefixes(getGistGitStorageRoot(id))) {
		invalidateResultCache(prefix);
	}
	invalidateRepoCache("gists", id);
}

function assertPaths(paths: readonly string[]): void {
	for (const path of paths) {
		if (!isSafeTreePath(path)) {
			throw new GitInvalidRequestError(`Invalid file path: ${path}`);
		}
	}
}

/**
 * Every file (blob) under a tree, recursively: a gist file name may contain
 * `/`, so the tree is a directory structure even though the API flattens it.
 */
async function listBlobs(
	repo: Repo,
	treeOid: string,
	prefix = "",
): Promise<TreeEntry[]> {
	const entries = await listTreeEntries(repo, treeOid, prefix);
	const blobs: TreeEntry[] = [];
	for (const entry of entries) {
		if (entry.type === "tree") {
			blobs.push(...(await listBlobs(repo, entry.oid, entry.path)));
		} else if (entry.type === "blob") {
			blobs.push(entry);
		}
	}
	return blobs;
}
