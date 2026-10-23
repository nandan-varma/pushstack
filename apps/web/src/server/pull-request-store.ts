/**
 * Pull request writes shared by the server functions and the REST API (a plain
 * server-only module — see repository-lookup.ts for why this is not a
 * server-function file). A pull request is an issue (`is_pull_request`) plus
 * its `pull_requests` row; reads go through thread-store.ts. Permission and
 * input checks stay with the caller: the server functions throw their own
 * errors, the API answers 401/403/404/422.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "#/db";
import { issues, pullRequests } from "#/db/app-schema";
import { getClosingIssueNumbers } from "#/lib/issue-references";
import { recordActivity } from "./activity";
import { ownerKeyOf } from "./git-storage-naming";
import { deleteBranch, mergeBranches } from "./git-write";
import { recordThreadActivity } from "./notification-store";
import { claimNextIssueOrPrNumber } from "./repository-lookup";
import {
	findPullRequestById,
	type PullRequest,
	pullRequestOf,
} from "./thread-store";
import {
	recordCrossReferences,
	recordTimelineEvent,
	recordTimelineEvents,
} from "./timeline-store";

export type { PullRequest };

export async function insertPullRequest(
	repoId: number,
	userId: string,
	data: {
		title: string;
		body?: string;
		sourceBranch: string;
		targetBranch: string;
	},
): Promise<PullRequest> {
	const [issue] = await db
		.insert(issues)
		.values({
			repoId,
			number: await claimNextIssueOrPrNumber(repoId),
			isPullRequest: true,
			authorId: userId,
			title: data.title,
			body: data.body || null,
		})
		.returning();
	if (!issue) throw new Error("Pull request insert returned no row");
	const [fields] = await db
		.insert(pullRequests)
		.values({
			issueId: issue.id,
			sourceBranch: data.sourceBranch,
			targetBranch: data.targetBranch,
		})
		.returning()
		.catch(async (error: unknown) => {
			// No half-made pull request: an issue row flagged as one without
			// its branches would break every read of it.
			await db.delete(issues).where(eq(issues.id, issue.id));
			throw error;
		});
	if (!fields) throw new Error("Pull request insert returned no row");
	const { issueId: _, ...prFields } = fields;
	const pr = pullRequestOf(issue, prFields);
	await recordCrossReferences(
		repoId,
		pr.id,
		{ kind: "pull_request", number: pr.number, title: pr.title },
		pr.body,
		userId,
	);
	await recordThreadActivity({
		thread: pr,
		actorId: userId,
		actorReason: "author",
		text: pr.body,
		newThread: true,
	});
	await recordActivity(userId, repoId, {
		type: "pr",
		metadata: { number: pr.number, title: pr.title, action: "opened" },
	});
	return pr;
}

/**
 * Apply an edit to `pr` (the caller checked access, and that a merged pull
 * request's status is untouched): records `renamed`, cross-references and
 * `closed`/`reopened`.
 */
export async function updatePullRequestFields(
	pr: PullRequest,
	userId: string,
	fields: { title?: string; body?: string; status?: "open" | "closed" },
): Promise<PullRequest> {
	const titleChanged = fields.title !== undefined && fields.title !== pr.title;
	const bodyChanged =
		fields.body !== undefined && (fields.body || null) !== pr.body;
	const statusChanged =
		fields.status !== undefined && fields.status !== pr.status;
	const now = new Date();
	const [updated] = await db
		.update(issues)
		.set({
			...(fields.title !== undefined && { title: fields.title }),
			...(fields.body !== undefined && { body: fields.body || null }),
			...(bodyChanged && { editedAt: now }),
			...(statusChanged && {
				status: fields.status,
				closedAt: fields.status === "closed" ? now : null,
				closedById: fields.status === "closed" ? userId : null,
			}),
			updatedAt: now,
		})
		.where(eq(issues.id, pr.id))
		.returning();
	if (!updated) throw new Error("Pull request update returned no row");
	if (titleChanged) {
		await recordTimelineEvent(pr.id, userId, {
			event: "renamed",
			from: pr.title,
			to: updated.title,
		});
	}
	if (bodyChanged) {
		await recordCrossReferences(
			pr.repoId,
			pr.id,
			{ kind: "pull_request", number: pr.number, title: updated.title },
			fields.body,
			userId,
		);
	}
	if (bodyChanged || statusChanged) {
		await recordThreadActivity({
			thread: pr,
			actorId: userId,
			...(statusChanged && { actorReason: "state_change" as const }),
			...(bodyChanged && { text: fields.body, previousText: pr.body }),
			notifySubscribers: statusChanged,
		});
	}
	if (statusChanged && fields.status) {
		const action = fields.status === "closed" ? "closed" : "reopened";
		await recordTimelineEvent(pr.id, userId, { event: action });
		await recordActivity(userId, pr.repoId, {
			type: "pr",
			metadata: { number: pr.number, title: pr.title, action },
		});
	}
	return pullRequestOf(updated, {
		sourceBranch: pr.sourceBranch,
		targetBranch: pr.targetBranch,
		mergedAt: pr.mergedAt,
		mergedBy: pr.mergedBy,
		mergeCommitSha: pr.mergeCommitSha,
		baseSha: pr.baseSha,
		headSha: pr.headSha,
	});
}

/**
 * Merge `pr`'s branches and record the merge: status, timeline, the issues its
 * body closes and activity. The caller checked that the pull request is open
 * and that `user` may merge it (and holds the write access the lock needs).
 */
export async function mergePullRequestBranches(
	repo: Parameters<typeof ownerKeyOf>[0] & { name: string },
	pr: PullRequest,
	user: { id: string; name: string; email: string },
	commitMessage?: string,
	expectedHeadSha?: string,
): Promise<
	| { success: true; commitSha: string }
	| { success: false; conflicts: string[]; headModified?: true }
> {
	const result = await mergeBranches(
		ownerKeyOf(repo),
		repo.name,
		pr.sourceBranch,
		pr.targetBranch,
		{
			message: commitMessage || `Merge pull request #${pr.number}: ${pr.title}`,
			authorName: user.name,
			authorEmail: user.email,
			expectedHeadSha,
		},
	);
	if (!result.success) return result;

	// Conditional on still being open: of two concurrent merges, only one
	// records the merge (the other's merge was a no-op on git's side).
	const now = new Date();
	const [closed] = await db
		.update(issues)
		.set({
			status: "closed",
			closedAt: now,
			closedById: user.id,
			updatedAt: now,
		})
		.where(and(eq(issues.id, pr.id), eq(issues.status, "open")))
		.returning({ id: issues.id });
	if (!closed) return { success: true, commitSha: result.commitSha };
	await db
		.update(pullRequests)
		.set({
			mergedAt: now,
			mergedBy: user.id,
			mergeCommitSha: result.commitSha,
			baseSha: result.baseSha,
			headSha: result.headSha,
		})
		.where(eq(pullRequests.issueId, pr.id));
	await recordTimelineEvent(pr.id, user.id, {
		event: "merged",
		commitSha: result.commitSha,
		base: pr.targetBranch,
	});
	await recordThreadActivity({
		thread: pr,
		actorId: user.id,
		actorReason: "state_change",
	});

	const closing = getClosingIssueNumbers(pr.body);
	if (closing.length > 0) {
		const closedIssues = await db
			.update(issues)
			.set({
				status: "closed",
				stateReason: "completed",
				closedAt: now,
				closedById: user.id,
				updatedAt: now,
			})
			.where(
				and(
					eq(issues.repoId, pr.repoId),
					inArray(issues.number, closing),
					eq(issues.isPullRequest, false),
					eq(issues.status, "open"),
				),
			)
			.returning({ id: issues.id });
		await recordTimelineEvents(
			closedIssues.map((issue) => issue.id),
			user.id,
			{
				event: "closed",
				closer: { kind: "pull_request", number: pr.number, title: pr.title },
				stateReason: "completed",
			},
		);
		// GitHub sends each closed issue's subscribers a state change.
		for (const issue of closedIssues) {
			await recordThreadActivity({
				thread: { id: issue.id, repoId: pr.repoId },
				actorId: user.id,
			});
		}
	}
	await recordActivity(user.id, pr.repoId, {
		type: "pr",
		metadata: { number: pr.number, title: pr.title, action: "merged" },
	});
	return { success: true, commitSha: result.commitSha };
}

/**
 * Delete the head branch `branch`, then {@link recordHeadBranchDeleted}. The
 * caller checked write access and that `branch` is not the default branch.
 */
export async function deleteHeadBranch(
	repo: Parameters<typeof ownerKeyOf>[0] & { id: number; name: string },
	branch: string,
	userId: string,
): Promise<void> {
	await deleteBranch(ownerKeyOf(repo), repo.name, branch);
	await recordHeadBranchDeleted(repo.id, branch, userId);
}

/**
 * After `branch` was deleted (from the web, the REST API or a push), as
 * GitHub does: every pull request it heads gets `head_ref_deleted`, and the
 * open ones are closed — they have nothing left to merge.
 */
export async function recordHeadBranchDeleted(
	repoId: number,
	branch: string,
	userId: string,
): Promise<void> {
	const heads = await db
		.select({ id: issues.id, status: issues.status })
		.from(pullRequests)
		.innerJoin(issues, eq(issues.id, pullRequests.issueId))
		.where(
			and(eq(issues.repoId, repoId), eq(pullRequests.sourceBranch, branch)),
		);
	await recordTimelineEvents(
		heads.map((head) => head.id),
		userId,
		{ event: "head_ref_deleted", branch },
	);
	for (const head of heads.filter((row) => row.status === "open")) {
		const pr = await findPullRequestById(head.id);
		if (pr?.status === "open") {
			await updatePullRequestFields(pr, userId, { status: "closed" });
		}
	}
}
