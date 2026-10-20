/**
 * Pull request writes shared by the server functions and the REST API (a plain
 * server-only module — see repository-lookup.ts for why this is not a
 * server-function file). Permission and input checks stay with the caller: the
 * server functions throw their own errors, the API answers 401/403/404/422.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "#/db";
import { issues, pullRequests } from "#/db/app-schema";
import { getClosingIssueNumbers } from "#/lib/issue-references";
import { recordActivity } from "./activity";
import { ownerKeyOf } from "./git-storage-naming";
import { mergeBranches } from "./git-write";
import { claimNextIssueOrPrNumber } from "./repository-lookup";
import {
	recordCrossReferences,
	recordTimelineEvent,
	recordTimelineEvents,
} from "./timeline-store";

export type PullRequest = typeof pullRequests.$inferSelect;

/** Open a pull request as `userId` (the caller checked access and both branches). */
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
	const [pr] = await db
		.insert(pullRequests)
		.values({
			repoId,
			number: await claimNextIssueOrPrNumber(repoId),
			authorId: userId,
			title: data.title,
			body: data.body || null,
			sourceBranch: data.sourceBranch,
			targetBranch: data.targetBranch,
		})
		.returning();
	if (!pr) throw new Error("Pull request insert returned no row");
	await recordCrossReferences(
		repoId,
		{ kind: "pull_request", number: pr.number, title: pr.title },
		pr.body,
		userId,
	);
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
	const [updated] = await db
		.update(pullRequests)
		.set({
			...fields,
			...(fields.body !== undefined && { body: fields.body || null }),
			...(bodyChanged && { editedAt: new Date() }),
			updatedAt: new Date(),
		})
		.where(eq(pullRequests.id, pr.id))
		.returning();
	if (!updated) throw new Error("Pull request update returned no row");
	if (titleChanged) {
		await recordTimelineEvent(pr.repoId, pr.number, userId, {
			event: "renamed",
			from: pr.title,
			to: updated.title,
		});
	}
	if (bodyChanged) {
		await recordCrossReferences(
			pr.repoId,
			{ kind: "pull_request", number: pr.number, title: updated.title },
			fields.body,
			userId,
		);
	}
	if (fields.status && fields.status !== pr.status) {
		const action = fields.status === "closed" ? "closed" : "reopened";
		await recordTimelineEvent(pr.repoId, pr.number, userId, { event: action });
		await recordActivity(userId, pr.repoId, {
			type: "pr",
			metadata: { number: pr.number, title: pr.title, action },
		});
	}
	return updated;
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
	const [merged] = await db
		.update(pullRequests)
		.set({
			status: "merged",
			mergedAt: new Date(),
			mergedBy: user.id,
			mergeCommitSha: result.commitSha,
			baseSha: result.baseSha,
			headSha: result.headSha,
			updatedAt: new Date(),
		})
		.where(and(eq(pullRequests.id, pr.id), eq(pullRequests.status, "open")))
		.returning({ id: pullRequests.id });
	if (!merged) return { success: true, commitSha: result.commitSha };
	await recordTimelineEvent(pr.repoId, pr.number, user.id, {
		event: "merged",
		commitSha: result.commitSha,
		base: pr.targetBranch,
	});

	const closing = getClosingIssueNumbers(pr.body);
	if (closing.length > 0) {
		const closedIssues = await db
			.update(issues)
			.set({ status: "closed", closedAt: new Date(), updatedAt: new Date() })
			.where(
				and(
					eq(issues.repoId, pr.repoId),
					inArray(issues.number, closing),
					eq(issues.status, "open"),
				),
			)
			.returning({ number: issues.number });
		await recordTimelineEvents(
			pr.repoId,
			closedIssues.map((issue) => issue.number),
			user.id,
			{
				event: "closed",
				closer: { kind: "pull_request", number: pr.number, title: pr.title },
			},
		);
	}
	await recordActivity(user.id, pr.repoId, {
		type: "pr",
		metadata: { number: pr.number, title: pr.title, action: "merged" },
	});
	return { success: true, commitSha: result.commitSha };
}
