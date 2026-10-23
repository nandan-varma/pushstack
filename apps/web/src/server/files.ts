import { createServerFn } from "@tanstack/react-start";
import { summarizeCommit } from "git-fs-s3/ops";
import { z } from "zod";
import { base64ToBytes } from "#/lib/bytes";
import {
	MAX_COMMIT_MESSAGE_CHARS,
	MAX_LIST_SKIP,
	MAX_WEB_UPLOAD_BYTES,
	maxBase64CharsForBytes,
} from "#/lib/limits";
import { recordActivity } from "./activity";
import { compareRevisions } from "./compare";
import * as gitRead from "./git-read";
import { BANNER_WALK_DEPTH } from "./git-read";
import {
	safeBranchNameSchema,
	safeCommitRevSchema,
	safeCommitShaSchema,
	safeRefNameSchema,
	safeRepoPathSchema,
} from "./git-ref-name";
import { ownerKeyOf } from "./git-storage-naming";
import * as gitWrite from "./git-write";
import { perfStep } from "./perf-log";
import { deleteHeadBranch } from "./pull-request-store";
import { readInput } from "./read-input";
import {
	type RepositoryWithOwner,
	readWithAccess,
	writeWithAccess,
} from "./repo-access";

/** Run a git read for a repository the caller can read (404 otherwise). */
function readGit<T>(
	label: string,
	repoId: number,
	fn: (
		ownerKey: string,
		repoName: string,
		repo: RepositoryWithOwner,
	) => Promise<T>,
): Promise<T> {
	return readWithAccess(label, repoId, (repo) =>
		perfStep(label, () => fn(ownerKeyOf(repo), repo.name, repo)),
	);
}

const refPath = z.object({
	repoId: z.number(),
	/** A branch name or, for permalinks, a full commit sha. */
	branchName: safeRefNameSchema,
	path: safeRepoPathSchema.default(""),
});

export const getFile = createServerFn({ method: "GET" })
	.validator(readInput(refPath))
	.handler(({ data }) =>
		readGit(
			`getFile ${data.branchName}:${data.path}`,
			data.repoId,
			(owner, name) =>
				gitRead.getFileView(owner, name, data.branchName, data.path),
		),
	);

export const getTreePageData = createServerFn({ method: "GET" })
	.validator(readInput(refPath))
	.handler(({ data }) =>
		readGit(
			`getTreePageData ${data.branchName}:${data.path}`,
			data.repoId,
			async (owner, name) => {
				const page = await gitRead.getRepositoryTreeData(
					owner,
					name,
					data.branchName,
					data.path,
				);
				return {
					...page,
					latestCommit: page.latestCommit && summarizeCommit(page.latestCommit),
				};
			},
		),
	);

/** One directory's entries and nothing else: what the file tree expands. */
export const getTreeEntries = createServerFn({ method: "GET" })
	.validator(readInput(refPath))
	.handler(({ data }) =>
		readGit(
			`getTreeEntries ${data.branchName}:${data.path}`,
			data.repoId,
			(owner, name) => gitRead.getTree(owner, name, data.branchName, data.path),
		),
	);

export const getLastCommits = createServerFn({ method: "GET" })
	.validator(readInput(refPath))
	.handler(({ data }) =>
		readGit(
			`getLastCommits ${data.branchName}:${data.path}`,
			data.repoId,
			(owner, name) =>
				gitRead.getLastCommitsForTree(owner, name, data.branchName, data.path),
		),
	);

export const getFileHistory = createServerFn({ method: "GET" })
	.validator(
		readInput(
			refPath.extend({
				limit: z.number().int().min(1).max(100).default(30),
				/** "banner": only the latest commit is shown, so walk shallowly first. */
				depth: z.enum(["banner", "full"]).default("full"),
			}),
		),
	)
	.handler(({ data }) =>
		readGit(
			`getFileHistory ${data.branchName}:${data.path}`,
			data.repoId,
			(owner, name) =>
				gitRead.getFileHistory(
					owner,
					name,
					data.branchName,
					data.path,
					data.limit,
					data.depth === "banner" ? BANNER_WALK_DEPTH : undefined,
				),
		),
	);

export const getBranches = createServerFn({ method: "GET" })
	.validator(readInput(z.object({ repoId: z.number() })))
	.handler(({ data }) =>
		readGit("getBranches", data.repoId, (owner, name) =>
			gitRead.getBranches(owner, name),
		),
	);

export const getTags = createServerFn({ method: "GET" })
	.validator(readInput(z.object({ repoId: z.number() })))
	.handler(({ data }) =>
		readGit("getTags", data.repoId, (owner, name) =>
			gitRead.getTags(owner, name),
		),
	);

export const getCommits = createServerFn({ method: "GET" })
	.validator(
		readInput(
			z.object({
				repoId: z.number(),
				branchName: safeRefNameSchema,
				limit: z.number().int().min(1).max(100).default(50),
				skip: z.number().int().min(0).max(MAX_LIST_SKIP).default(0),
			}),
		),
	)
	.handler(({ data }) =>
		readGit(
			`getCommits ${data.branchName}`,
			data.repoId,
			async (owner, name) => {
				const commits = await gitRead.getCommitHistory(
					owner,
					name,
					data.branchName,
					data.limit,
					data.skip,
				);
				return commits.map(summarizeCommit);
			},
		),
	);

const identity = (who: { name: string; email: string; timestamp: number }) => ({
	name: who.name,
	email: who.email,
	date: new Date(who.timestamp * 1000).toISOString(),
});

/** A commit by branch, tag, `HEAD`, full or abbreviated sha; `sha` is the resolved oid. */
export const getCommit = createServerFn({ method: "GET" })
	.validator(
		readInput(z.object({ repoId: z.number(), rev: safeCommitRevSchema })),
	)
	.handler(({ data }) =>
		readGit(`getCommit ${data.rev}`, data.repoId, async (owner, name) => {
			const { oid, commit } = await gitRead.getCommit(owner, name, data.rev);
			return {
				sha: oid,
				message: commit.message.trim(),
				parents: commit.parent,
				author: identity(commit.author),
				committer: identity(commit.committer),
			};
		}),
	);

export const getCommitDiff = createServerFn({ method: "GET" })
	.validator(
		readInput(z.object({ repoId: z.number(), commitSha: safeCommitShaSchema })),
	)
	.handler(({ data }) =>
		readGit(`getCommitDiff ${data.commitSha}`, data.repoId, (owner, name) =>
			gitRead.getCommitDiff(owner, name, data.commitSha),
		),
	);

/** A pull request's diff: what `sourceBranch` changed since branching from `targetBranch`. */
export const getBranchDiff = createServerFn({ method: "GET" })
	.validator(
		readInput(
			z.object({
				repoId: z.number(),
				sourceBranch: safeBranchNameSchema,
				targetBranch: safeBranchNameSchema,
			}),
		),
	)
	.handler(({ data }) =>
		readGit(
			`getBranchDiff ${data.targetBranch}...${data.sourceBranch}`,
			data.repoId,
			(owner, name) =>
				gitRead.getBranchDiff(
					owner,
					name,
					data.targetBranch,
					data.sourceBranch,
				),
		),
	);

/**
 * The compare page (`/{owner}/{repo}/compare/{base}...{head}`): commits on
 * `head` that `base` lacks, ahead/behind counts and the three-dot diff.
 */
export const getComparison = createServerFn({ method: "GET" })
	.validator(
		readInput(
			z.object({
				repoId: z.number(),
				base: safeCommitRevSchema,
				head: safeCommitRevSchema,
				separator: z.enum(["...", ".."]).default("..."),
			}),
		),
	)
	.handler(({ data }) =>
		readGit(
			`getComparison ${data.base}${data.separator}${data.head}`,
			data.repoId,
			async (owner, name) => {
				const { commits, ...comparison } = await compareRevisions(
					owner,
					name,
					data.base,
					data.head,
					data.separator,
				);
				return { ...comparison, commits: commits.map(summarizeCommit) };
			},
		),
	);

export const uploadFile = createServerFn({ method: "POST" })
	.validator(
		z.object({
			repoId: z.number(),
			branchName: safeBranchNameSchema,
			path: safeRepoPathSchema.min(1),
			content: z.base64().max(maxBase64CharsForBytes(MAX_WEB_UPLOAD_BYTES)),
			commitMessage: z.string().trim().min(1).max(MAX_COMMIT_MESSAGE_CHARS),
		}),
	)
	.handler(({ data }) =>
		writeWithAccess(data.repoId, async (repo, user) => {
			const sha = await gitWrite.createCommit(ownerKeyOf(repo), repo.name, {
				branch: data.branchName,
				message: data.commitMessage,
				files: [{ path: data.path, content: base64ToBytes(data.content) }],
				author: { name: user.name, email: user.email },
			});
			await recordActivity(user.id, repo.id, {
				type: "commit",
				metadata: { commitSha: sha, message: data.commitMessage },
			});
			return { commit: { sha, message: data.commitMessage } };
		}),
	);

export const deleteFile = createServerFn({ method: "POST" })
	.validator(
		z.object({
			repoId: z.number(),
			branchName: safeBranchNameSchema,
			path: safeRepoPathSchema.min(1),
			commitMessage: z.string().trim().min(1).max(MAX_COMMIT_MESSAGE_CHARS),
		}),
	)
	.handler(({ data }) =>
		writeWithAccess(data.repoId, async (repo, user) => {
			const sha = await gitWrite.deleteFile(ownerKeyOf(repo), repo.name, {
				branch: data.branchName,
				filePath: data.path,
				message: data.commitMessage,
				author: { name: user.name, email: user.email },
			});
			await recordActivity(user.id, repo.id, {
				type: "commit",
				metadata: { commitSha: sha, message: data.commitMessage },
			});
			return { commit: { sha, message: data.commitMessage } };
		}),
	);

export const createBranch = createServerFn({ method: "POST" })
	.validator(
		z.object({
			repoId: z.number(),
			name: safeBranchNameSchema,
			/** Defaults to the repository's default branch. */
			fromBranch: safeBranchNameSchema.optional(),
		}),
	)
	.handler(({ data }) =>
		writeWithAccess(data.repoId, async (repo) => {
			await gitWrite.createBranch(
				ownerKeyOf(repo),
				repo.name,
				data.name,
				data.fromBranch ?? repo.defaultBranch,
			);
			return { name: data.name };
		}),
	);

export const deleteBranch = createServerFn({ method: "POST" })
	.validator(z.object({ repoId: z.number(), name: safeBranchNameSchema }))
	.handler(({ data }) =>
		writeWithAccess(data.repoId, async (repo, user) => {
			if (data.name === repo.defaultBranch) {
				throw new Error("Cannot delete the default branch");
			}
			await deleteHeadBranch(repo, data.name, user.id);
		}),
	);
