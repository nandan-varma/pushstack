import fs from "node:fs";
import path from "node:path";
import git from "isomorphic-git";
import { isR2Configured } from "#/lib/r2";
import { getCachedObject, setCachedObject } from "./git-cache";
import { GitObjectNotFoundError } from "./git-errors";
import { getBareRepoOptions, getDefaultAuthor } from "./git-manager-iso";
import {
	getRepoOptions,
	syncRepositoryToR2,
	withRepositoryLock,
	withRepositoryWorktree,
} from "./git-repo-storage";

// A resolved ref (branch/commit) not existing is a normal, expected condition (empty
// repo, unborn branch) and is handled by each caller. An object that fails to resolve
// *underneath* an already-resolved ref (a tree/blob the stored pack doesn't actually
// contain) means the repo's git storage is inconsistent — surface that distinctly so
// callers don't render it as "empty" and the client doesn't see a raw isomorphic-git
// NotFoundError.
function wrapMissingObject<T>(
	promise: Promise<T>,
	context: string,
): Promise<T> {
	return promise.catch((err: unknown) => {
		if ((err as { code?: string })?.code === "NotFoundError") {
			throw new GitObjectNotFoundError(
				`Git data for ${context} is missing from storage. The repository may need to be re-pushed to repair it.`,
			);
		}
		throw err;
	});
}

// Build/update a git tree by overlaying new blobs onto an existing tree
async function upsertTree(
	repo: ReturnType<typeof getBareRepoOptions>,
	treeOid: string | undefined,
	entries: Map<string, string>, // relativePath -> blobOid
): Promise<string> {
	const existing = treeOid
		? (await git.readTree({ ...repo, oid: treeOid })).tree
		: [];
	const byName = new Map(existing.map((e) => [e.path, e]));
	const direct = new Map<string, string>();
	const nested = new Map<string, Map<string, string>>();
	for (const [filePath, blobOid] of entries) {
		const slash = filePath.indexOf("/");
		if (slash === -1) {
			direct.set(filePath, blobOid);
		} else {
			const dir = filePath.slice(0, slash);
			const rest = filePath.slice(slash + 1);
			if (!nested.has(dir)) nested.set(dir, new Map());
			nested.get(dir)?.set(rest, blobOid);
		}
	}
	for (const [name, blobOid] of direct) {
		byName.set(name, {
			mode: "100644",
			path: name,
			oid: blobOid,
			type: "blob",
		});
	}
	for (const [dir, subEntries] of nested) {
		const entry = byName.get(dir);
		const subtreeOid = entry?.type === "tree" ? entry.oid : undefined;
		const newOid = await upsertTree(repo, subtreeOid, subEntries);
		byName.set(dir, { mode: "040000", path: dir, oid: newOid, type: "tree" });
	}
	return git.writeTree({ ...repo, tree: Array.from(byName.values()) });
}

// Remove a file path from a tree, returning the new root tree OID
async function deleteFromTree(
	repo: ReturnType<typeof getBareRepoOptions>,
	treeOid: string,
	filePath: string,
): Promise<string> {
	const existing = (await git.readTree({ ...repo, oid: treeOid })).tree;
	const byName = new Map(existing.map((e) => [e.path, e]));
	const slash = filePath.indexOf("/");
	if (slash === -1) {
		byName.delete(filePath);
	} else {
		const dir = filePath.slice(0, slash);
		const rest = filePath.slice(slash + 1);
		const entry = byName.get(dir);
		if (entry?.type === "tree") {
			const newOid = await deleteFromTree(repo, entry.oid, rest);
			byName.set(dir, { ...entry, oid: newOid });
		}
	}
	return git.writeTree({ ...repo, tree: Array.from(byName.values()) });
}

// Write a commit directly to R2 without a worktree — no download/upload cycle
async function writeCommitDirect(
	ownerKey: string,
	repoName: string,
	branch: string,
	message: string,
	author: {
		name: string;
		email: string;
		timestamp: number;
		timezoneOffset: number;
	},
	buildTree: (
		parentTreeOid: string | undefined,
		repo: ReturnType<typeof getBareRepoOptions>,
	) => Promise<string>,
): Promise<string> {
	const repo = getBareRepoOptions(ownerKey, repoName);
	let parentOid: string | undefined;
	let parentTreeOid: string | undefined;
	try {
		parentOid = await git.resolveRef({ ...repo, ref: `refs/heads/${branch}` });
		const { commit } = await git.readCommit({ ...repo, oid: parentOid });
		parentTreeOid = commit.tree;
	} catch (err) {
		if ((err as { code?: string })?.code !== "NotFoundError") {
			throw err;
		}
		// empty repo — first commit
	}
	const treeOid = await buildTree(parentTreeOid, repo);
	const commitOid = await git.writeCommit({
		...repo,
		commit: {
			message,
			tree: treeOid,
			parent: parentOid ? [parentOid] : [],
			author,
			committer: author,
		},
	});
	await git.writeRef({
		...repo,
		ref: `refs/heads/${branch}`,
		value: commitOid,
		force: true,
	});
	return commitOid;
}

export interface Branch {
	name: string;
	commit: string;
	isDefault: boolean;
}

export interface TreeEntry {
	path: string;
	mode: string;
	type: "blob" | "tree";
	oid: string;
	size?: number;
}

export interface CommitInfo {
	oid: string;
	commit: {
		message: string;
		tree: string;
		parent: string[];
		author: {
			name: string;
			email: string;
			timestamp: number;
			timezoneOffset: number;
		};
		committer: {
			name: string;
			email: string;
			timestamp: number;
			timezoneOffset: number;
		};
	};
	payload: string;
}

async function resolveCommit(ownerKey: string, repoName: string, ref: string) {
	const repo = await getRepoOptions(ownerKey, repoName);
	const oid = await git.resolveRef({ ...repo, ref });
	const result = await git.readCommit({ ...repo, oid });

	return {
		repo,
		oid,
		commit: result.commit,
	};
}

async function findTreeEntry(
	repo: Awaited<ReturnType<typeof getRepoOptions>>,
	rootTreeOid: string,
	treePath: string,
): Promise<TreeEntry | null> {
	if (!treePath) {
		return {
			path: "",
			mode: "040000",
			type: "tree",
			oid: rootTreeOid,
		};
	}

	const parts = treePath.split("/").filter(Boolean);
	let currentTreeOid = rootTreeOid;
	let currentPath = "";

	for (const [index, part] of parts.entries()) {
		const tree = await git.readTree({ ...repo, oid: currentTreeOid });
		const entry = tree.tree.find((candidate) => candidate.path === part);

		if (!entry) {
			return null;
		}

		currentPath = currentPath
			? path.posix.join(currentPath, entry.path)
			: entry.path;

		if (index === parts.length - 1) {
			return {
				path: currentPath,
				mode: entry.mode,
				type: entry.type as "blob" | "tree",
				oid: entry.oid,
			};
		}

		if (entry.type !== "tree") {
			return null;
		}

		currentTreeOid = entry.oid;
	}

	return null;
}

async function listTreeEntries(
	repo: Awaited<ReturnType<typeof getRepoOptions>>,
	treeOid: string,
	prefix: string = "",
): Promise<TreeEntry[]> {
	const tree = await git.readTree({ ...repo, oid: treeOid });

	return tree.tree.map((entry) => ({
		path: prefix ? path.posix.join(prefix, entry.path) : entry.path,
		mode: entry.mode,
		type: entry.type as "blob" | "tree",
		oid: entry.oid,
	}));
}

export async function createCommit(
	ownerKey: string,
	repoName: string,
	message: string,
	files: Array<{ path: string; content: string | Buffer }>,
	authorName?: string,
	authorEmail?: string,
	branch: string = "main",
	ownerDbId?: string,
): Promise<string> {
	const author =
		authorName && authorEmail
			? {
					name: authorName,
					email: authorEmail,
					timestamp: Math.floor(Date.now() / 1000),
					timezoneOffset: 0,
				}
			: getDefaultAuthor();

	if (isR2Configured()) {
		// ponytail: write blobs + tree + commit directly to R2 — no worktree, no disk I/O
		return withRepositoryLock(ownerKey, repoName, () =>
			writeCommitDirect(
				ownerKey,
				repoName,
				branch,
				message,
				author,
				async (parentTreeOid, repo) => {
					const blobs = new Map<string, string>();
					for (const file of files) {
						const content =
							typeof file.content === "string"
								? Buffer.from(file.content)
								: file.content;
						const oid = await git.writeBlob({ ...repo, blob: content });
						blobs.set(file.path, oid);
					}
					return upsertTree(repo, parentTreeOid, blobs);
				},
			),
		);
	}

	return withRepositoryWorktree(
		ownerKey,
		repoName,
		branch,
		async ({ worktreePath }) => {
			for (const file of files) {
				const filePath = path.join(worktreePath, file.path);
				fs.mkdirSync(path.dirname(filePath), { recursive: true });
				fs.writeFileSync(filePath, file.content);
			}

			for (const file of files) {
				await git.add({ fs, dir: worktreePath, filepath: file.path });
			}

			await git.setConfig({
				fs,
				dir: worktreePath,
				path: "user.name",
				value: author.name,
			});
			await git.setConfig({
				fs,
				dir: worktreePath,
				path: "user.email",
				value: author.email,
			});

			return git.commit({
				fs,
				dir: worktreePath,
				message,
				author,
				committer: author,
			});
		},
		"main",
		ownerDbId,
	);
}

export async function getBranches(
	ownerKey: string,
	repoName: string,
): Promise<Branch[]> {
	const repo = await getRepoOptions(ownerKey, repoName);
	try {
		const branches = await git.listBranches(repo);
		const currentBranch = await git
			.currentBranch({ ...repo, fullname: false })
			.catch(() => null);

		return Promise.all(
			branches.map(async (branch) => ({
				name: branch,
				commit: await git.resolveRef({ ...repo, ref: `refs/heads/${branch}` }),
				isDefault: branch === currentBranch,
			})),
		);
	} catch (err: unknown) {
		if ((err as { code?: string }).code === "NotFoundError") return [];
		throw err;
	}
}

export async function createBranch(
	ownerKey: string,
	repoName: string,
	branchName: string,
	startPoint: string = "main",
	ownerDbId?: string,
): Promise<void> {
	const run = async () => {
		const repo = await getRepoOptions(ownerKey, repoName);
		const object = await git.resolveRef({
			...repo,
			ref: `refs/heads/${startPoint}`,
		});
		await git.branch({ ...repo, ref: branchName, checkout: false, object });
		// ponytail: when R2 backend is active, git.branch wrote directly to R2 — syncing local→R2
		// here would read an empty local dir and delete all R2 objects
		if (!isR2Configured()) {
			await syncRepositoryToR2(ownerKey, repoName, ownerDbId);
		}
	};
	// Only lock the R2-direct path: getRepoOptions()/syncRepositoryToR2() in the
	// non-R2 path already acquire this same lock internally, and it isn't
	// reentrant — wrapping the whole function unconditionally deadlocks.
	if (isR2Configured()) {
		await withRepositoryLock(ownerKey, repoName, run);
	} else {
		await run();
	}
}

export async function deleteBranch(
	ownerKey: string,
	repoName: string,
	branchName: string,
	ownerDbId?: string,
): Promise<void> {
	const run = async () => {
		const repo = await getRepoOptions(ownerKey, repoName);
		await git.deleteBranch({ ...repo, ref: branchName });
		if (!isR2Configured()) {
			await syncRepositoryToR2(ownerKey, repoName, ownerDbId);
		}
	};
	// See createBranch above: only lock the R2-direct path to avoid deadlocking
	// on the non-reentrant lock already held by the non-R2 hydrate/sync calls.
	if (isR2Configured()) {
		await withRepositoryLock(ownerKey, repoName, run);
	} else {
		await run();
	}
}

export async function getBlob(
	ownerKey: string,
	repoName: string,
	sha: string,
): Promise<Buffer> {
	const repo = await getRepoOptions(ownerKey, repoName);
	const { blob } = await wrapMissingObject(
		git.readBlob({ ...repo, oid: sha }),
		`${ownerKey}/${repoName} blob ${sha}`,
	);
	return Buffer.from(blob);
}

export async function getFileContent(
	ownerKey: string,
	repoName: string,
	filePath: string,
	ref: string = "main",
): Promise<Buffer> {
	const { repo, commit } = await resolveCommit(ownerKey, repoName, ref);
	const entry = await wrapMissingObject(
		findTreeEntry(repo, commit.tree, filePath),
		`${ownerKey}/${repoName}@${ref}:${filePath}`,
	);

	if (entry?.type !== "blob") {
		throw new Error(`File not found: ${filePath}`);
	}

	const { blob } = await wrapMissingObject(
		git.readBlob({ ...repo, oid: entry.oid }),
		`${ownerKey}/${repoName}@${ref}:${filePath}`,
	);
	return Buffer.from(blob);
}

export async function getTree(
	ownerKey: string,
	repoName: string,
	ref: string = "main",
	treePath: string = "",
): Promise<TreeEntry[]> {
	return getTreeFromBranch(ownerKey, repoName, ref, treePath);
}

export async function getCommit(
	ownerKey: string,
	repoName: string,
	sha: string,
): Promise<CommitInfo> {
	const repo = await getRepoOptions(ownerKey, repoName);
	const result = await wrapMissingObject(
		git.readCommit({ ...repo, oid: sha }),
		`${ownerKey}/${repoName} commit ${sha}`,
	);

	return {
		oid: result.oid,
		commit: result.commit,
		payload: result.payload,
	};
}

export async function getCommitLog(
	ownerKey: string,
	repoName: string,
	ref: string = "main",
	depth: number = 50,
): Promise<CommitInfo[]> {
	const repo = await getRepoOptions(ownerKey, repoName);
	try {
		const commits = await git.log({ ...repo, ref, depth });
		return commits.map((commit) => ({
			oid: commit.oid,
			commit: commit.commit,
			payload: commit.payload || "",
		}));
	} catch (err: unknown) {
		if ((err as { code?: string }).code === "NotFoundError") return [];
		throw err;
	}
}

export async function checkoutBranch(
	ownerKey: string,
	repoName: string,
	branchName: string,
): Promise<void> {
	const repo = await getRepoOptions(ownerKey, repoName);
	await git.resolveRef({ ...repo, ref: `refs/heads/${branchName}` });
}

export async function getFileFromBranch(
	ownerKey: string,
	repoName: string,
	branchName: string,
	filePath: string,
): Promise<{ content: string; size: number; isBinary: boolean }> {
	const buffer = await getFileContent(ownerKey, repoName, filePath, branchName);
	const isBinary = buffer.includes(0);

	return {
		content: isBinary ? buffer.toString("base64") : buffer.toString("utf-8"),
		size: buffer.length,
		isBinary,
	};
}

export async function getTreeFromBranch(
	ownerKey: string,
	repoName: string,
	branchName: string,
	treePath: string = "",
): Promise<TreeEntry[]> {
	let repo: Awaited<ReturnType<typeof getRepoOptions>>;
	let commit: Awaited<ReturnType<typeof resolveCommit>>["commit"];
	let headSha: string | null = null;
	try {
		const resolved = await resolveCommit(ownerKey, repoName, branchName);
		repo = resolved.repo;
		commit = resolved.commit;
		headSha = resolved.oid;
	} catch (err: unknown) {
		// ponytail: empty repo or branch not yet created — return empty tree
		if ((err as { code?: string }).code === "NotFoundError") return [];
		throw err;
	}

	// ponytail: keyed by HEAD sha so cache auto-invalidates on push
	const cacheKey = `result:tree:${ownerKey}/${repoName}/${headSha}:${treePath}`;
	const cached = getCachedObject<TreeEntry[]>(cacheKey);
	if (cached) return cached;

	const context = `${ownerKey}/${repoName}@${branchName}:${treePath || "/"}`;
	let result: TreeEntry[];
	if (!treePath) {
		result = await wrapMissingObject(
			listTreeEntries(repo, commit.tree),
			context,
		);
	} else {
		const entry = await wrapMissingObject(
			findTreeEntry(repo, commit.tree, treePath),
			context,
		);
		result =
			entry?.type !== "tree"
				? []
				: await wrapMissingObject(
						listTreeEntries(repo, entry.oid, entry.path),
						context,
					);
	}

	setCachedObject(cacheKey, result);
	return result;
}

export async function deleteFile(
	ownerKey: string,
	repoName: string,
	branchName: string,
	filePath: string,
	message: string,
	author: { name: string; email: string },
	ownerDbId?: string,
): Promise<{ sha: string; message: string }> {
	const authorInfo = {
		name: author.name,
		email: author.email,
		timestamp: Math.floor(Date.now() / 1000),
		timezoneOffset: 0,
	};

	if (isR2Configured()) {
		// ponytail: remove from tree + commit directly to R2 — no worktree
		const sha = await writeCommitDirect(
			ownerKey,
			repoName,
			branchName,
			message,
			authorInfo,
			async (parentTreeOid, repo) => {
				if (!parentTreeOid) throw new Error(`Branch ${branchName} is empty`);
				return deleteFromTree(repo, parentTreeOid, filePath);
			},
		);
		return { sha, message };
	}

	const sha = await withRepositoryWorktree(
		ownerKey,
		repoName,
		branchName,
		async ({ worktreePath }) => {
			const fullPath = path.join(worktreePath, filePath);
			fs.rmSync(fullPath, { force: true });
			await git.remove({ fs, dir: worktreePath, filepath: filePath });
			await git.setConfig({
				fs,
				dir: worktreePath,
				path: "user.name",
				value: authorInfo.name,
			});
			await git.setConfig({
				fs,
				dir: worktreePath,
				path: "user.email",
				value: authorInfo.email,
			});

			return git.commit({
				fs,
				dir: worktreePath,
				message,
				author: authorInfo,
				committer: authorInfo,
			});
		},
		"main",
		ownerDbId,
	);

	return { sha, message };
}

export async function getCommitHistory(
	ownerKey: string,
	repoName: string,
	branchName: string,
	limit: number = 50,
	skip: number = 0,
): Promise<CommitInfo[]> {
	const repo = await getRepoOptions(ownerKey, repoName);
	const headSha = await git
		.resolveRef({ ...repo, ref: `refs/heads/${branchName}` })
		.catch(() => null);

	// ponytail: keyed by HEAD sha so cache auto-invalidates on push
	const cacheKey = headSha
		? `result:commits:${ownerKey}/${repoName}/${headSha}:${limit}:${skip}`
		: null;
	if (cacheKey) {
		const cached = getCachedObject<CommitInfo[]>(cacheKey);
		if (cached) return cached;
	}

	const all = await getCommitLog(ownerKey, repoName, branchName, limit + skip);
	const result = all.slice(skip, skip + limit);

	if (cacheKey) setCachedObject(cacheKey, result);
	return result;
}
