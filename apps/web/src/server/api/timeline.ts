import type { TimelineEntry } from "#/lib/timeline-types";
import {
	countCommentsForThread,
	listCommentsForThread,
} from "../comment-store";
import { findThreadByNumber, type ThreadRef } from "../thread-store";
import { countTimeline, listTimeline } from "../timeline-store";
import type { ApiContext } from "./auth";
import { json, linkHeader, notFoundError, pageParams } from "./http";
import { readableRepository } from "./repo-lookup";
import { issueComment, simpleUser, timelineEvent } from "./serializers";
import { fullNameOf, serializeThreadsByNumber, threadNumber } from "./threads";

type CommentRow = Awaited<ReturnType<typeof listCommentsForThread>>[number];

type TimelineItem =
	| { createdAt: Date; id: number; kind: "event"; entry: TimelineEntry }
	| { createdAt: Date; id: number; kind: "comment"; comment: CommentRow };

function mergeTimeline(
	events: TimelineEntry[],
	comments: CommentRow[],
): TimelineItem[] {
	const items: TimelineItem[] = [
		...events.map((entry) => ({
			createdAt: entry.createdAt,
			id: entry.id,
			kind: "event" as const,
			entry,
		})),
		...comments.map((comment) => ({
			createdAt: comment.createdAt,
			id: comment.id,
			kind: "comment" as const,
			comment,
		})),
	];
	items.sort(
		(a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id,
	);
	return items;
}

function commentedItem(
	fullName: string,
	thread: ThreadRef,
	comment: CommentRow,
): Record<string, unknown> {
	return {
		...issueComment({
			fullName,
			kind: thread.kind,
			number: thread.number,
			comment,
			author: comment.author,
		}),
		event: "commented",
		actor: simpleUser(comment.author),
	};
}

export async function listTimelineItems(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const number = threadNumber(ctx.params.issue_number);
	const thread = await findThreadByNumber(repo.id, number);
	if (!thread) throw notFoundError();
	const params = pageParams(ctx.url.searchParams);
	if (!params.reachable) return json([], 200, {});
	// Both sources are capped at the deepest item the page can need, then merged.
	const cap = params.offset + params.perPage;
	const [events, comments, eventTotal, commentTotal] = await Promise.all([
		listTimeline(thread.id, { limit: cap }),
		listCommentsForThread(thread, { limit: cap }),
		countTimeline(thread.id),
		countCommentsForThread(thread),
	]);
	const merged = mergeTimeline(events, comments).slice(
		params.offset,
		params.offset + params.perPage,
	);
	const fullName = fullNameOf(repo);
	const threadByNumber = await serializeThreadsByNumber(
		repo,
		merged.flatMap((item) =>
			item.kind === "event" && item.entry.event === "cross-referenced"
				? [item.entry.source.number]
				: [],
		),
	);
	return json(
		merged.map((item) =>
			item.kind === "comment"
				? commentedItem(fullName, thread, item.comment)
				: timelineEvent(item.entry, { fullName, threadByNumber }),
		),
		200,
		linkHeader(ctx.url, params, eventTotal + commentTotal),
	);
}

export async function listEvents(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const number = threadNumber(ctx.params.issue_number);
	const thread = await findThreadByNumber(repo.id, number);
	if (!thread) throw notFoundError();
	const params = pageParams(ctx.url.searchParams);
	const [entries, total] = await Promise.all([
		params.reachable
			? listTimeline(thread.id, {
					limit: params.perPage,
					offset: params.offset,
				})
			: [],
		countTimeline(thread.id),
	]);
	const fullName = fullNameOf(repo);
	const threadByNumber = await serializeThreadsByNumber(
		repo,
		entries.flatMap((entry) =>
			entry.event === "cross-referenced" ? [entry.source.number] : [],
		),
	);
	return json(
		entries.map((entry) => timelineEvent(entry, { fullName, threadByNumber })),
		200,
		linkHeader(ctx.url, params, total),
	);
}
