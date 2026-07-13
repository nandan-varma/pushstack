import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { activities, pullRequests } from "../db/github-schema";
import { analyzeMerge, mergeBranches } from "./git-merge-iso";
import { getRepoStorageCoordinates } from "./git-storage-naming";
import {
	canMergePullRequest,
	canReadRepo,
	canWriteRepo,
	requireReadAccess,
	requireWriteAccess,
} from "./repo-access";
import { getCurrentUser, getCurrentUserOptional } from "./session";

// ============ PULL REQUESTS ============

// Create pull request
export const createPullRequest = createServerFn({ method: "POST" })
	.validator((data: unknown) =>
		z
			.object({
				repoId: z.number(),
				title: z.string().min(1),
				body: z.string().optional(),
				sourceBranchName: z.string(),
				targetBranchName: z.string(),
			})
			.parse(data),
	)
	.handler(async ({ data }) => {
		const user = await getCurrentUser();

		await requireWriteAccess(data.repoId, user.id);

		// Validate branches exist - we now work with branch names directly
		if (data.sourceBranchName === data.targetBranchName) {
			throw new Error("Cannot create PR from same branch");
		}

		const [pr] = await db
			.insert(pullRequests)
			.values({
				repoId: data.repoId,
				authorId: user.id,
				title: data.title,
				body: data.body || null,
				sourceBranch: data.sourceBranchName,
				targetBranch: data.targetBranchName,
				status: "open",
			})
			.returning();

		// Log activity
		await db.insert(activities).values({
			userId: user.id,
			repoId: data.repoId,
			type: "pr",
			metadata: {
				prId: pr.id,
				title: pr.title,
				action: "opened",
			},
		});

		return pr;
	});

// Get pull requests
export const getPullRequests = createServerFn({ method: "GET" })
	.validator((data: unknown) =>
		z
			.object({
				repoId: z.number(),
				status: z
					.enum(["open", "closed", "merged", "all"])
					.optional()
					.default("open"),
			})
			.parse(data),
	)
	.handler(async ({ data }) => {
		const user = await getCurrentUserOptional();

		await requireReadAccess(data.repoId, user?.id);

		const prList = await db.query.pullRequests.findMany({
			where: and(
				eq(pullRequests.repoId, data.repoId),
				data.status !== "all"
					? eq(pullRequests.status, data.status)
					: undefined,
			),
			with: {
				author: true,
			},
			orderBy: [desc(pullRequests.createdAt)],
		});

		return prList;
	});

// Get pull request by ID
export const getPullRequest = createServerFn({ method: "GET" })
	.validator((data: unknown) =>
		z
			.object({
				prId: z.number(),
			})
			.parse(data),
	)
	.handler(async ({ data }) => {
		const user = await getCurrentUserOptional();

		const pr = await db.query.pullRequests.findFirst({
			where: eq(pullRequests.id, data.prId),
			with: {
				author: true,
				repository: true,
			},
		});

		if (!pr) {
			throw new Error("Pull request not found");
		}

		if (!(await canReadRepo(pr.repoId, user?.id))) {
			throw new Error("Access denied");
		}

		return pr;
	});

// Update pull request
export const updatePullRequest = createServerFn({ method: "POST" })
	.validator((data: unknown) =>
		z
			.object({
				prId: z.number(),
				title: z.string().optional(),
				body: z.string().optional(),
				status: z.enum(["open", "closed"]).optional(),
			})
			.parse(data),
	)
	.handler(async ({ data }) => {
		const user = await getCurrentUser();

		const pr = await db.query.pullRequests.findFirst({
			where: eq(pullRequests.id, data.prId),
		});

		if (!pr) {
			throw new Error("Pull request not found");
		}

		if (pr.authorId !== user.id && !(await canWriteRepo(pr.repoId, user.id))) {
			throw new Error("Access denied");
		}

		const [updated] = await db
			.update(pullRequests)
			.set({
				...(data.title && { title: data.title }),
				...(data.body !== undefined && { body: data.body }),
				...(data.status && { status: data.status }),
				updatedAt: new Date(),
			})
			.where(eq(pullRequests.id, data.prId))
			.returning();

		return updated;
	});

// Merge pull request
export const mergePullRequest = createServerFn({ method: "POST" })
	.validator((data: unknown) =>
		z
			.object({
				prId: z.number(),
				commitMessage: z.string().optional(),
				strategy: z
					.enum(["merge", "ours", "theirs"])
					.optional()
					.default("merge"),
			})
			.parse(data),
	)
	.handler(async ({ data }) => {
		const user = await getCurrentUser();

		const pr = await db.query.pullRequests.findFirst({
			where: eq(pullRequests.id, data.prId),
			with: {
				repository: {
					with: {
						owner: true,
					},
				},
			},
		});

		if (!pr) {
			throw new Error("Pull request not found");
		}

		if (!(await canMergePullRequest(pr.repoId, user.id))) {
			throw new Error("Access denied");
		}

		if (pr.status !== "open") {
			throw new Error("Pull request is not open");
		}

		// Get repository
		const repo = pr.repository;
		const storage = getRepoStorageCoordinates(repo);

		// Analyze merge first to check for conflicts
		const analysis = await analyzeMerge(
			storage.ownerKey,
			repo.name,
			pr.sourceBranch,
			pr.targetBranch,
		);

		if (!analysis.canMerge) {
			throw new Error(
				`Cannot merge: ${analysis.hasConflicts ? "has conflicts" : "unknown issue"}`,
			);
		}

		// Perform the merge
		const mergeMessage =
			data.commitMessage || `Merge pull request #${pr.id}: ${pr.title}`;
		const mergeResult = await mergeBranches(
			storage.ownerKey,
			repo.name,
			pr.sourceBranch,
			pr.targetBranch,
			{
				message: mergeMessage,
				authorName: user.name || user.username || "Unknown",
				authorEmail: user.email,
				strategy: data.strategy,
			},
			repo.ownerId,
		);

		if (!mergeResult.success) {
			throw new Error(
				`Merge failed: ${mergeResult.conflicts?.join(", ") || "Unknown error"}`,
			);
		}

		// Update PR status
		await db
			.update(pullRequests)
			.set({
				status: "merged",
				mergedAt: new Date(),
				mergedBy: user.id,
				mergeCommitSha: mergeResult.commitSha,
			})
			.where(eq(pullRequests.id, data.prId));

		// Log activity
		await db.insert(activities).values({
			userId: user.id,
			repoId: pr.repoId,
			type: "pr",
			metadata: {
				prId: pr.id,
				title: pr.title,
				action: "merged",
				mergeCommitSha: mergeResult.commitSha,
			},
		});

		return {
			success: true,
			commitSha: mergeResult.commitSha,
		};
	});
