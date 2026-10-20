/**
 * Serializing issue/PR threads for the REST API. The issues endpoints return
 * pull requests too (GitHub does the same: a pull request is an issue), so a
 * thread is whatever the shared `#N` names; the serializer then adds the
 * `pull_request` object for a pull request. Rows come from thread-store.ts's
 * `listThreads`, already carrying labels, assignees and comment counts.
 */

import {
	emptyReactionRollup as emptyRollup,
	type ReactionRollup,
} from "#/lib/reactions";
import { issueReactionRollups } from "../reaction-store";
import type { PublicUser, RepositoryRowWithOwner } from "../repository-lookup";
import { findThreads, type Thread } from "../thread-store";
import { issue, type Shape } from "./serializers";

export const fullNameOf = (repo: RepositoryRowWithOwner) =>
	`${repo.owner.username}/${repo.name}`;

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
 * GitHub's issue shape for `thread` with its own reaction rollup. `withClosedBy`
 * adds `closed_by`, which GitHub returns on a single issue only.
 */
function serializeThreadWith(
	repo: RepositoryRowWithOwner,
	thread: Thread,
	reactions: ReactionRollup,
	withClosedBy = false,
): Shape<"issue"> {
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
		reactions,
	});
}

/** GitHub's issue shapes for `threads`, their reaction rollups in one read. */
export async function serializeThreads(
	repo: RepositoryRowWithOwner,
	threads: Thread[],
): Promise<Shape<"issue">[]> {
	const rollups = await issueReactionRollups(threads.map((t) => t.id));
	return threads.map((thread) =>
		serializeThreadWith(repo, thread, rollups.get(thread.id) ?? emptyRollup()),
	);
}

/** One thread's issue shape; `withClosedBy` for single-issue reads. */
export async function serializeThread(
	repo: RepositoryRowWithOwner,
	thread: Thread,
	withClosedBy = false,
): Promise<Shape<"issue">> {
	const rollups = await issueReactionRollups([thread.id]);
	return serializeThreadWith(
		repo,
		thread,
		rollups.get(thread.id) ?? emptyRollup(),
		withClosedBy,
	);
}

export async function serializeThreadsByNumber(
	repo: RepositoryRowWithOwner,
	numbers: number[],
): Promise<Map<number, Shape<"issue">>> {
	const threads = await findThreads(repo.id, numbers);
	const shapes = await serializeThreads(repo, threads);
	return new Map(shapes.map((shape) => [shape.number, shape]));
}
