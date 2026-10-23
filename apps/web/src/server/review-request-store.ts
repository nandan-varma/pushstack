/**
 * Review requests, GitHub's rules: a pull request's author, or anyone with
 * write access, can ask the repository's owner or a collaborator to review
 * (never the pull request's author); each new request is a `review_requested`
 * timeline event and notifies the reviewer; withdrawing one records
 * `review_request_removed`. Submitting a review clears the reviewer's request
 * silently, and asking again is allowed. Plain server-only helpers behind the
 * server functions in `review-requests.ts` and the REST API.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "#/db";
import {
	pullRequestReviewRequests,
	repositoryCollaborators,
} from "#/db/app-schema";
import { MAX_REVIEWERS_PER_REQUEST } from "#/lib/limits";
import { recordThreadActivity } from "./notification-store";
import { type PublicUser, publicUserFields } from "./repository-lookup";
import { recordTimelineEvent } from "./timeline-store";

/** A refused request: the message is GitHub's (REST turns it into a 422). */
export class ReviewRequestError extends Error {}

type PullRef = { id: number; repoId: number; authorId: string };

export async function listRequestedReviewers(
	issueId: number,
): Promise<PublicUser[]> {
	return (await requestedReviewersByIssue([issueId])).get(issueId) ?? [];
}

/** Requested reviewers of many pull requests, oldest request first. */
export async function requestedReviewersByIssue(
	issueIds: number[],
): Promise<Map<number, PublicUser[]>> {
	const out = new Map<number, PublicUser[]>();
	if (issueIds.length === 0) return out;
	const rows = await db.query.pullRequestReviewRequests.findMany({
		columns: { issueId: true },
		where: { issueId: { in: issueIds } },
		with: { user: publicUserFields },
		orderBy: { createdAt: "asc", id: "asc" },
	});
	for (const row of rows) {
		const list = out.get(row.issueId) ?? [];
		list.push(row.user);
		out.set(row.issueId, list);
	}
	return out;
}

/** Who can be asked to review: the repository's owner and its collaborators. */
export async function listReviewerCandidates(
	repoId: number,
): Promise<PublicUser[]> {
	const repo = await db.query.repositories.findFirst({
		columns: { ownerId: true },
		where: { id: repoId },
	});
	if (!repo) return [];
	const collaborators = await db
		.select({ userId: repositoryCollaborators.userId })
		.from(repositoryCollaborators)
		.where(eq(repositoryCollaborators.repoId, repoId));
	const users = await db.query.user.findMany({
		...publicUserFields,
		where: {
			id: { in: [repo.ownerId, ...collaborators.map((c) => c.userId)] },
		},
	});
	return users.sort((a, b) => a.username.localeCompare(b.username));
}

function byLogin(users: PublicUser[], usernames: string[]): PublicUser[] {
	const wanted = new Set(usernames.map((name) => name.toLowerCase()));
	return users.filter((u) => wanted.has(u.username.toLowerCase()));
}

/**
 * Request reviews from `usernames`. Already-requested users are left alone;
 * returns the users newly requested. Throws {@link ReviewRequestError} when a
 * name is unknown, not a collaborator, or the pull request's author.
 */
export async function requestReviewers(
	pr: PullRef,
	usernames: string[],
	actorId: string,
): Promise<PublicUser[]> {
	const unique = [...new Set(usernames.map((name) => name.toLowerCase()))];
	if (unique.length > MAX_REVIEWERS_PER_REQUEST) {
		throw new ReviewRequestError(
			`At most ${MAX_REVIEWERS_PER_REQUEST} reviewers can be requested at once`,
		);
	}
	const candidates = await listReviewerCandidates(pr.repoId);
	const found = byLogin(candidates, unique);
	if (found.length !== unique.length) {
		const repo = await db.query.repositories.findFirst({
			columns: { name: true },
			where: { id: pr.repoId },
			with: { owner: { columns: { username: true } } },
		});
		throw new ReviewRequestError(
			`Reviews may only be requested from collaborators. One or more of the users or teams you specified is not a collaborator of the ${repo ? `${repo.owner.username}/${repo.name}` : "repository"} repository.`,
		);
	}
	if (found.some((u) => u.id === pr.authorId)) {
		throw new ReviewRequestError(
			"Review cannot be requested from pull request author.",
		);
	}
	if (found.length === 0) return [];
	const inserted = await db
		.insert(pullRequestReviewRequests)
		.values(
			found.map((u) => ({
				issueId: pr.id,
				userId: u.id,
				requesterId: actorId,
			})),
		)
		.onConflictDoNothing()
		.returning({ userId: pullRequestReviewRequests.userId });
	const added = found.filter((u) => inserted.some((r) => r.userId === u.id));
	for (const reviewer of added) {
		await recordTimelineEvent(pr.id, actorId, {
			event: "review_requested",
			reviewer: { username: reviewer.username, name: reviewer.name },
		});
	}
	if (added.length > 0) {
		await recordThreadActivity({
			thread: pr,
			actorId,
			direct: { userIds: added.map((u) => u.id), reason: "review_requested" },
			notifySubscribers: false,
		});
	}
	return added;
}

/** Withdraw requests; every name must have a pending request. */
export async function removeReviewRequests(
	pr: PullRef,
	usernames: string[],
	actorId: string,
): Promise<PublicUser[]> {
	const unique = [...new Set(usernames.map((name) => name.toLowerCase()))];
	const current = await listRequestedReviewers(pr.id);
	const found = byLogin(current, unique);
	if (found.length !== unique.length) {
		throw new ReviewRequestError(
			"Review cannot be removed from users who were not requested.",
		);
	}
	if (found.length === 0) return [];
	const deleted = await db
		.delete(pullRequestReviewRequests)
		.where(
			and(
				eq(pullRequestReviewRequests.issueId, pr.id),
				inArray(
					pullRequestReviewRequests.userId,
					found.map((u) => u.id),
				),
			),
		)
		.returning({ userId: pullRequestReviewRequests.userId });
	const removed = found.filter((u) => deleted.some((r) => r.userId === u.id));
	for (const reviewer of removed) {
		await recordTimelineEvent(pr.id, actorId, {
			event: "review_request_removed",
			reviewer: { username: reviewer.username, name: reviewer.name },
		});
	}
	return removed;
}

/** A submitted review answers the reviewer's request; no timeline event. */
export async function clearReviewRequest(
	issueId: number,
	userId: string,
): Promise<void> {
	await db
		.delete(pullRequestReviewRequests)
		.where(
			and(
				eq(pullRequestReviewRequests.issueId, issueId),
				eq(pullRequestReviewRequests.userId, userId),
			),
		);
}
