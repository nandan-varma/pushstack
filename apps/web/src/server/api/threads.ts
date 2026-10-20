/**
 * Serializing issue/PR threads for the REST API. The issues endpoints return
 * pull requests too (GitHub does the same: a pull request is an issue), so a
 * thread is whatever the shared `#N` names; the serializer then adds the
 * `pull_request` object for a pull request. Rows come from thread-store.ts's
 * `listThreads`, already carrying labels, assignees and comment counts.
 */
import type { PublicUser, RepositoryRowWithOwner } from "../repository-lookup";
import { findThreads, type Thread } from "../thread-store";
import { notFoundError } from "./http";
import { issue } from "./serializers";

export const fullNameOf = (repo: RepositoryRowWithOwner) =>
	`${repo.owner.username}/${repo.name}`;

/** The route's `:number`; anything that isn't a positive integer is a 404. */
export function threadNumber(raw: string | undefined): number {
	if (!raw || !/^\d+$/.test(raw)) throw notFoundError();
	const number = Number(raw);
	if (number < 1) throw notFoundError();
	return number;
}

/** When a thread closed; a closed row without one closed at its last change. */
function closedAtOf(thread: {
	status: "open" | "closed";
	closedAt: Date | null;
	updatedAt: Date;
}): Date | null {
	return thread.status === "open"
		? null
		: (thread.closedAt ?? thread.updatedAt);
}

/**
 * GitHub's issue shape for `thread`. `withClosedBy` adds `closed_by`, which
 * GitHub returns on a single issue only.
 */
export function serializeThread(
	repo: RepositoryRowWithOwner,
	thread: Thread,
	withClosedBy = false,
): Record<string, unknown> {
	const closed = thread.status === "closed";
	const closedBy: PublicUser | null = closed ? thread.closedBy : null;
	return issue({
		fullName: fullNameOf(repo),
		kind: thread.kind,
		id: thread.id,
		number: thread.number,
		title: thread.title,
		body: thread.body,
		state: thread.status,
		createdAt: thread.createdAt,
		updatedAt: thread.updatedAt,
		closedAt: closedAtOf(thread),
		// Issues only; a closed issue without a stored reason was completed.
		stateReason:
			thread.kind === "pull_request"
				? null
				: closed
					? (thread.stateReason ?? "completed")
					: thread.stateReason,
		...(withClosedBy && { closedBy }),
		mergedAt: thread.pullRequest?.mergedAt ?? null,
		author: thread.author,
		labels: thread.labels,
		assignees: thread.assignees,
		commentsCount: thread.commentsCount,
	});
}

export async function serializeThreadsByNumber(
	repo: RepositoryRowWithOwner,
	numbers: number[],
): Promise<Map<number, unknown>> {
	const threads = await findThreads(repo.id, numbers);
	return new Map(
		threads.map((thread) => [thread.number, serializeThread(repo, thread)]),
	);
}
