import fs from "node:fs";
import path from "node:path";
import git from "isomorphic-git";
import { isR2Configured } from "#/lib/r2";
import { getBareRepoOptions, getDefaultAuthor } from "./git-manager-iso";
import { withRepositoryLock, withRepositoryWorktree } from "./git-repo-storage";
import { deleteFromTree, upsertTree } from "./git-tree-ops";

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
					// ponytail: each blob is written to its own content-addressed R2 key —
					// no shared state between files, so writing them one-at-a-time (as
					// resolveConflicts's multi-file commits used to) only added latency.
					const blobs = new Map<string, string>();
					await Promise.all(
						files.map(async (file) => {
							const content =
								typeof file.content === "string"
									? Buffer.from(file.content)
									: file.content;
							const oid = await git.writeBlob({ ...repo, blob: content });
							blobs.set(file.path, oid);
						}),
					);
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
