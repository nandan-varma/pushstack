/**
 * Pull request writes shared by the server functions and the REST API (a plain
 * server-only module — see repository-lookup.ts for why this is not a
 * server-function file). A pull request is an issue (`is_pull_request`) plus
 * its `pull_requests` row; reads go through thread-store.ts. Permission and
 * input checks stay with the caller: the server functions throw their own
 * errors, the API answers 401/403/404/422.
 */
import { and, eq, inArray } from "drizzle-orm";
import { MAX_RANGE_COMMITS } from "git-edge";
import { db } from "#/db";
import { issues, pullRequests, type Repository } from "#/db/app-schema";
import { getClosingIssueNumbers } from "#/lib/issue-references";
import { MAX_COMMIT_MESSAGE_CHARS } from "#/lib/limits";
import { recordActivity } from "./activity";
import { bestEffort } from "./best-effort";
import { ownerKeyOf } from "./git-storage-naming";
import {
	deleteBranch,
	type MergeMethod,
	type MergeOptions,
	mergeBranches,
} from "./git-write";
import { recordThreadActivity } from "./notification-store";
import { logError } from "./perf-log";
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

/**
 * Compensating delete for a half-made pull request. It never throws: the
 * caller rethrows the original error, and a failed cleanup (an orphaned row)
 * is logged for someone to remove.
 */
async function discardIssueRow(issueId: number, why: string): Promise<void> {
	await db
		.delete(issues)
		.where(eq(issues.id, issueId))
		.catch((cleanup: unknown) =>
			logError(
				"pull-request-store",
				`Issue row ${issueId} was left behind after a ${why}`,
				cleanup,
			),
		);
}

export async function insertPullRequest(
	repoId: number,
	userId: string,
	data: {
		title: string;
		body?: string;
		sourceBranch: string;
		targetBranch: string;
		draft?: boolean;
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
			isDraft: data.draft ?? false,
		})
		.returning()
		.catch(async (error: unknown) => {
			// No half-made pull request: an issue row flagged as one without
			// its branches would break every read of it.
			await discardIssueRow(issue.id, "failed pull request insert");
			throw error;
		});
	if (!fields) throw new Error("Pull request insert returned no row");
	const { issueId: _, ...prFields } = fields;
	const pr = pullRequestOf(issue, prFields);
	// Compensate a failed write by deleting the rows (cascading to the pull
	// request fields). A retry is duplicate-free when cleanup succeeds.
	try {
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
		});
		await recordActivity(userId, repoId, {
			type: "pr",
			metadata: { number: pr.number, title: pr.title, action: "opened" },
		});
	} catch (error) {
		await discardIssueRow(issue.id, "failed pull request write");
		throw error;
	}
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
		isDraft: pr.isDraft,
	});
}

/**
 * Mark a draft ready for review, or convert an open pull request back to a
 * draft, recording `ready_for_review` / `convert_to_draft`. The caller checked
 * access. A no-op (already in that state) records nothing; a pull request that
 * is not open can't change (GitHub refuses both on closed and merged ones).
 */
export async function setPullRequestDraft(
	pr: PullRequest,
	userId: string,
	draft: boolean,
): Promise<PullRequest> {
	if (pr.status !== "open") {
		throw new Error(
			"Only an open pull request can be marked ready for review or converted to a draft",
		);
	}
	// Conditional on the old state, so of two racing requests only one records.
	const [changed] = await db
		.update(pullRequests)
		.set({ isDraft: draft })
		.where(
			and(eq(pullRequests.issueId, pr.id), eq(pullRequests.isDraft, !draft)),
		)
		.returning({ id: pullRequests.issueId });
	if (!changed) return { ...pr, isDraft: draft };
	await db
		.update(issues)
		.set({ updatedAt: new Date() })
		.where(eq(issues.id, pr.id));
	await recordTimelineEvent(pr.id, userId, {
		event: draft ? "convert_to_draft" : "ready_for_review",
	});
	await recordThreadActivity({
		thread: pr,
		actorId: userId,
		actorReason: "state_change",
	});
	return { ...pr, isDraft: draft };
}

export type MergeMethodFlags = Pick<
	Repository,
	"allowMergeCommit" | "allowSquashMerge" | "allowRebaseMerge"
>;

const MERGE_METHOD_LABEL: Record<MergeMethod, string> = {
	merge: "Merge commits",
	squash: "Squash merges",
	rebase: "Rebase merges",
};

/** GitHub's refusal of a merge method the repository disallows, or null when allowed. */
export function disallowedMergeMethodMessage(
	repo: MergeMethodFlags,
	method: MergeMethod,
): string | null {
	const allowed =
		method === "merge"
			? repo.allowMergeCommit
			: method === "squash"
				? repo.allowSquashMerge
				: repo.allowRebaseMerge;
	return allowed
		? null
		: `${MERGE_METHOD_LABEL[method]} are not allowed on this repository.`;
}

export interface PullRequestMergeOptions {
	method: MergeMethod;
	/** The request's commit title and body (trimmed; absent when not given). */
	commitTitle?: string;
	commitMessage?: string;
	/** Refuse unless the source tip, read under the lock, is this. */
	expectedHeadSha?: string;
}

/**
 * GitHub's commit message: a given title (and body) replaces the default
 * title; a given body alone replaces the default body. A rebase keeps the
 * commits' own messages, so it has no composed message.
 */
function composeMergeMessage(
	given: Pick<PullRequestMergeOptions, "commitTitle" | "commitMessage">,
	defaults: { title: string; body?: string },
): string {
	if (given.commitTitle) {
		return given.commitMessage
			? `${given.commitTitle}\n\n${given.commitMessage}`
			: given.commitTitle;
	}
	const body = given.commitMessage ?? defaults.body;
	return body ? `${defaults.title}\n\n${body}` : defaults.title;
}

/** Longest subject quoted in a squash body's bullet. */
const MAX_BULLET_CHARS = 200;

/**
 * GitHub's default squash body: one bullet per commit, when there are several.
 * Each subject is cut to `MAX_BULLET_CHARS`, the body to a commit message's cap.
 */
function squashBody(
	commitMessages: string[],
	truncated: boolean,
): string | undefined {
	if (commitMessages.length < 2) return undefined;
	const bullets = commitMessages.map((message) => {
		const subject = message.trim().split("\n")[0] ?? "";
		return `* ${subject.slice(0, MAX_BULLET_CHARS)}`;
	});
	if (truncated) {
		bullets.push(
			`* (list truncated: only the first ${MAX_RANGE_COMMITS} commits are shown)`,
		);
	}
	return bullets.join("\n").slice(0, MAX_COMMIT_MESSAGE_CHARS);
}

function mergeOptionsFor(
	repo: Parameters<typeof ownerKeyOf>[0] & { name: string },
	pr: PullRequest,
	user: { name: string; email: string },
	options: PullRequestMergeOptions,
): MergeOptions {
	const author = {
		authorName: user.name,
		authorEmail: user.email,
		expectedHeadSha: options.expectedHeadSha,
	};
	switch (options.method) {
		case "merge":
			return {
				...author,
				method: "merge",
				message: composeMergeMessage(options, {
					title: `Merge pull request #${pr.number} from ${ownerKeyOf(repo)}/${pr.sourceBranch}`,
					body: pr.title,
				}),
			};
		case "squash":
			return {
				...author,
				method: "squash",
				message: (commitMessages, truncated) =>
					composeMergeMessage(options, {
						title: `${pr.title} (#${pr.number})`,
						body: squashBody(commitMessages, truncated),
					}),
			};
		case "rebase":
			return { ...author, method: "rebase" };
	}
}

/**
 * Merge `pr`'s branches by `options.method` and record the merge: status,
 * timeline, the issues its body closes and activity. The caller checked that
 * the pull request is open, that `user` may merge it (and holds the write
 * access the lock needs) and that the repository allows the method.
 */
export async function mergePullRequestBranches(
	repo: Parameters<typeof ownerKeyOf>[0] & { name: string },
	pr: PullRequest,
	user: { id: string; name: string; email: string },
	options: PullRequestMergeOptions,
): Promise<
	| { success: true; commitSha: string }
	| {
			success: false;
			conflicts: string[];
			headModified?: true;
			refusal?: string;
	  }
> {
	const result = await mergeBranches(
		ownerKeyOf(repo),
		repo.name,
		pr.sourceBranch,
		pr.targetBranch,
		mergeOptionsFor(repo, pr, user, options),
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
	// The status flip above already claimed the merge. If recording it fails,
	// reopen, or the pull request would stay closed-but-unmerged for good
	// (git's side is done, so a retry merges again).
	await db
		.update(pullRequests)
		.set({
			mergedAt: now,
			mergedBy: user.id,
			mergeCommitSha: result.commitSha,
			baseSha: result.baseSha,
			headSha: result.headSha,
		})
		.where(eq(pullRequests.issueId, pr.id))
		.catch(async (error: unknown) => {
			await db
				.update(issues)
				.set({
					status: "open",
					closedAt: null,
					closedById: null,
					updatedAt: new Date(),
				})
				.where(eq(issues.id, pr.id))
				.catch((cleanup: unknown) =>
					logError(
						"pull-request-store",
						`Reopen of #${pr.number} failed`,
						cleanup,
					),
				);
			throw error;
		});
	// The merge is recorded above. Its follow-ups are best-effort: a failure
	// must not report an error for a merged pull request.
	const followUp = (what: string, effect: () => Promise<unknown>) =>
		bestEffort("pull-request-store", `${what} of #${pr.number}`, effect);
	await followUp("The merged event", () =>
		recordTimelineEvent(pr.id, user.id, {
			event: "merged",
			commitSha: result.commitSha,
			base: pr.targetBranch,
		}),
	);
	await followUp("The merge notice", () =>
		recordThreadActivity({
			thread: pr,
			actorId: user.id,
			actorReason: "state_change",
		}),
	);
	const closing = getClosingIssueNumbers(pr.body);
	if (closing.length > 0) {
		await followUp("Closing the linked issues", () =>
			closeLinkedIssues(pr, closing, user.id, now),
		);
	}
	await followUp("The merge activity", () =>
		recordActivity(user.id, pr.repoId, {
			type: "pr",
			metadata: { number: pr.number, title: pr.title, action: "merged" },
		}),
	);
	return { success: true, commitSha: result.commitSha };
}

/**
 * Closes the open issues a merged pull request names (`Closes #N`), records
 * each close and tells its subscribers. Called after the merge is recorded.
 */
async function closeLinkedIssues(
	pr: PullRequest,
	numbers: number[],
	actorId: string,
	now: Date,
) {
	const closedIssues = await db
		.update(issues)
		.set({
			status: "closed",
			stateReason: "completed",
			closedAt: now,
			closedById: actorId,
			updatedAt: now,
		})
		.where(
			and(
				eq(issues.repoId, pr.repoId),
				inArray(issues.number, numbers),
				eq(issues.isPullRequest, false),
				eq(issues.status, "open"),
			),
		)
		.returning({ id: issues.id });
	await recordTimelineEvents(
		closedIssues.map((issue) => issue.id),
		actorId,
		{
			event: "closed",
			closer: { kind: "pull_request", number: pr.number, title: pr.title },
			stateReason: "completed",
		},
	);
	// GitHub sends each closed issue's subscribers a state change.
	for (const issue of closedIssues) {
		await bestEffort(
			"pull-request-store",
			`The close notice of issue ${issue.id}`,
			() =>
				recordThreadActivity({
					thread: { id: issue.id, repoId: pr.repoId },
					actorId,
				}),
		);
	}
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
