/**
 * File Operations Server Functions
 *
 * Handles file operations using real git repositories via isomorphic-git.
 * All file/commit/branch operations now interact with actual git repos on filesystem.
 */

import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { activities, repositories } from "../db/github-schema";
import {
	createBranch as gitCreateBranch,
	deleteBranch as gitDeleteBranch,
	getBranches as gitGetBranches,
} from "./git-branch-ops";
// Git operations imports (isomorphic-git)
import { createCommit, deleteFile as gitDeleteFile } from "./git-commit-write";
import * as GitDiff from "./git-diff-iso";
import {
	getCommitHistory,
	getFileFromBranch,
	getTreeFromBranch,
	getCommit as gitGetCommit,
} from "./git-history-ops";
import { getRepoStorageCoordinates } from "./git-storage-naming";
import { getRepoWithReadAccess, getRepoWithWriteAccess } from "./repo-access";
import { getCurrentUser, getCurrentUserOptional } from "./session";

function getStorage(repo: {
	ownerId: string;
	name: string;
	owner?: { id: string; username: string | null; email: string } | null;
}) {
	return getRepoStorageCoordinates(repo);
}

const safeRepoPathSchema = z
	.string()
	.refine((p) => !p.startsWith("/"), "Path must be relative")
	.refine(
		(p) => !p.split("/").some((segment) => segment === ".."),
		"Path must not contain '..' segments",
	)
	.refine(
		(p) => !/^\.git(\/|$)/i.test(p),
		"Path must not reference git internals",
	)
	.refine((p) => !p.includes("\0"), "Path must not contain null bytes");

// Upload file schema
const uploadFileSchema = z.object({
	repoId: z.number(),
	branchName: z.string(),
	path: safeRepoPathSchema,
	content: z.string(), // Base64 encoded content
	commitMessage: z.string(),
});

/**
 * Upload file to repository - creates a git commit
 */
export const uploadFile = createServerFn({ method: "POST" })
	.validator((data: unknown) => uploadFileSchema.parse(data))
	.handler(async ({ data }) => {
		const user = await getCurrentUser();

		const repo = await getRepoWithWriteAccess(data.repoId, user.id);

		// Decode content
		const buffer = Buffer.from(data.content, "base64");
		const storage = getStorage(repo);

		// Create commit with the file
		const commitSha = await createCommit(
			storage.ownerKey,
			repo.name,
			data.commitMessage,
			[{ path: data.path, content: buffer }],
			user.name || user.username || "Unknown",
			user.email,
			data.branchName,
			repo.ownerId,
		);

		// Update repository updated_at
		await db
			.update(repositories)
			.set({ updatedAt: new Date() })
			.where(eq(repositories.id, data.repoId));

		// Log activity
		await db.insert(activities).values({
			userId: user.id,
			repoId: data.repoId,
			type: "commit",
			metadata: {
				commitSha,
				message: data.commitMessage,
				filesCount: 1,
			},
		});

		return {
			commit: { sha: commitSha, message: data.commitMessage },
		};
	});

/**
 * Get file from repository
 */
export const getFile = createServerFn({ method: "GET" })
	.validator((data: unknown) =>
		z
			.object({
				repoId: z.number(),
				branchName: z.string(),
				path: safeRepoPathSchema,
			})
			.parse(data),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUserOptional();

		const repo = await getRepoWithReadAccess(data.repoId, currentUser?.id);

		const storage = getStorage(repo);

		// Get file from git
		const fileInfo = await getFileFromBranch(
			storage.ownerKey,
			repo.name,
			data.branchName,
			data.path,
		);

		return fileInfo;
	});

/**
 * Get presigned download URL for file
 */
export const getFileDownloadUrl = createServerFn({ method: "GET" })
	.validator((data: unknown) =>
		z
			.object({
				repoId: z.number(),
				branchName: z.string(),
				path: safeRepoPathSchema,
			})
			.parse(data),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUserOptional();

		const repo = await getRepoWithReadAccess(data.repoId, currentUser?.id);

		const storage = getStorage(repo);

		// Get file info
		const fileInfo = await getFileFromBranch(
			storage.ownerKey,
			repo.name,
			data.branchName,
			data.path,
		);

		// For simplicity, return content directly
		return {
			content: fileInfo.content,
			isLFS: false,
			size: fileInfo.size,
		};
	});

/**
 * List files in repository directory
 */
export const listFiles = createServerFn({ method: "GET" })
	.validator((data: unknown) =>
		z
			.object({
				repoId: z.number(),
				branchName: z.string(),
				path: safeRepoPathSchema.optional().default(""),
			})
			.parse(data),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUserOptional();

		const repo = await getRepoWithReadAccess(data.repoId, currentUser?.id);

		const storage = getStorage(repo);

		// Get tree from git
		const entries = await getTreeFromBranch(
			storage.ownerKey,
			repo.name,
			data.branchName,
			data.path || "",
		);

		return entries;
	});

/**
 * Delete file from repository
 */
export const deleteFile = createServerFn({ method: "POST" })
	.validator((data: unknown) =>
		z
			.object({
				repoId: z.number(),
				branchName: z.string(),
				path: safeRepoPathSchema,
				commitMessage: z.string(),
			})
			.parse(data),
	)
	.handler(async ({ data }) => {
		const user = await getCurrentUser();

		const repo = await getRepoWithWriteAccess(data.repoId, user.id);

		const storage = getStorage(repo);

		// Delete file and create commit
		const commitInfo = await gitDeleteFile(
			storage.ownerKey,
			repo.name,
			data.branchName,
			data.path,
			data.commitMessage,
			{ name: user.name || user.username || "Unknown", email: user.email },
			repo.ownerId,
		);

		// Log activity
		await db.insert(activities).values({
			userId: user.id,
			repoId: data.repoId,
			type: "commit",
			metadata: {
				commitSha: commitInfo.sha,
				message: data.commitMessage,
				filesCount: 1,
			},
		});

		return { success: true, commit: commitInfo };
	});

/**
 * Get repository branches
 */
export const getBranches = createServerFn({ method: "GET" })
	.validator((data: unknown) =>
		z
			.object({
				repoId: z.number(),
			})
			.parse(data),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUserOptional();

		const repo = await getRepoWithReadAccess(data.repoId, currentUser?.id);

		const storage = getStorage(repo);

		// Get branches from git
		const branches = await gitGetBranches(storage.ownerKey, repo.name);

		return branches;
	});

/**
 * Create branch
 */
export const createBranch = createServerFn({ method: "POST" })
	.validator((data: unknown) =>
		z
			.object({
				repoId: z.number(),
				name: z.string(),
				fromBranch: z.string().optional().default("main"),
			})
			.parse(data),
	)
	.handler(async ({ data }) => {
		const user = await getCurrentUser();

		const repo = await getRepoWithWriteAccess(data.repoId, user.id);

		const storage = getStorage(repo);

		// Create branch in git
		await gitCreateBranch(
			storage.ownerKey,
			repo.name,
			data.name,
			data.fromBranch,
			repo.ownerId,
		);

		return { success: true, name: data.name };
	});

/**
 * Delete branch
 */
export const deleteBranch = createServerFn({ method: "POST" })
	.validator((data: unknown) =>
		z
			.object({
				repoId: z.number(),
				name: z.string(),
			})
			.parse(data),
	)
	.handler(async ({ data }) => {
		const user = await getCurrentUser();

		const repo = await getRepoWithWriteAccess(data.repoId, user.id);

		// Don't allow deleting default branch
		if (data.name === repo.defaultBranch) {
			throw new Error("Cannot delete default branch");
		}

		const storage = getStorage(repo);

		// Delete branch from git
		await gitDeleteBranch(storage.ownerKey, repo.name, data.name, repo.ownerId);

		return { success: true };
	});

/**
 * Get commits for a branch
 */
export const getCommits = createServerFn({ method: "GET" })
	.validator((data: unknown) =>
		z
			.object({
				repoId: z.number(),
				branchName: z.string(),
				limit: z.number().max(100).optional().default(50),
				skip: z.number().optional().default(0),
			})
			.parse(data),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUserOptional();

		const repo = await getRepoWithReadAccess(data.repoId, currentUser?.id);

		const storage = getStorage(repo);

		// Get commit history from git
		const commits = await getCommitHistory(
			storage.ownerKey,
			repo.name,
			data.branchName,
			data.limit,
			data.skip,
		);

		return commits.map((commit) => ({
			sha: commit.oid,
			message: commit.commit.message.trim(),
			createdAt: new Date(commit.commit.author.timestamp * 1000).toISOString(),
			authorName: commit.commit.author.name,
			authorEmail: commit.commit.author.email,
			author: {
				name: commit.commit.author.name,
				email: commit.commit.author.email,
			},
		}));
	});

/**
 * Get commit details by SHA
 */
export const getCommit = createServerFn({ method: "GET" })
	.validator((data: unknown) =>
		z
			.object({
				repoId: z.number(),
				commitSha: z.string(),
			})
			.parse(data),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUserOptional();

		const repo = await getRepoWithReadAccess(data.repoId, currentUser?.id);

		const storage = getStorage(repo);

		// Get commit from git
		const commit = await gitGetCommit(
			storage.ownerKey,
			repo.name,
			data.commitSha,
		);

		return {
			sha: commit.oid,
			message: commit.commit.message.trim(),
			tree: commit.commit.tree,
			parent: commit.commit.parent,
			payload: commit.payload,
			branch: repo.defaultBranch,
			author: {
				name: commit.commit.author.name,
				email: commit.commit.author.email,
				date: new Date(commit.commit.author.timestamp * 1000).toISOString(),
			},
			committer: {
				name: commit.commit.committer.name,
				email: commit.commit.committer.email,
				date: new Date(commit.commit.committer.timestamp * 1000).toISOString(),
			},
		};
	});

/**
 * Get commit diff
 */
export const getCommitDiff = createServerFn({ method: "GET" })
	.validator((data: unknown) =>
		z
			.object({
				repoId: z.number(),
				commitSha: z.string(),
			})
			.parse(data),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUserOptional();

		const repo = await getRepoWithReadAccess(data.repoId, currentUser?.id);

		const storage = getStorage(repo);

		// Get diff from git
		const diff = await GitDiff.getCommitDiff(
			storage.ownerKey,
			repo.name,
			data.commitSha,
		);

		return diff;
	});

/**
 * Get diff between branches (for pull requests)
 */
export const getBranchDiff = createServerFn({ method: "GET" })
	.validator((data: unknown) =>
		z
			.object({
				repoId: z.number(),
				sourceBranch: z.string(),
				targetBranch: z.string(),
			})
			.parse(data),
	)
	.handler(async ({ data }) => {
		const currentUser = await getCurrentUserOptional();

		const repo = await getRepoWithReadAccess(data.repoId, currentUser?.id);

		const storage = getStorage(repo);

		// Get diff from git
		const diff = await GitDiff.getDiffBetweenBranches(
			storage.ownerKey,
			repo.name,
			data.sourceBranch,
			data.targetBranch,
		);

		return diff;
	});
