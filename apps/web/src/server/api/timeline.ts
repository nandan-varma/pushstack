import { db } from "#/db";
import { emptyReactionRollup, type ReactionRollup } from "#/lib/reactions";
import type { TimelineEntry } from "#/lib/timeline-types";
import {
	countCommentsForThread,
	listCommentsForThread,
} from "../comment-store";
import { commentReactionRollups } from "../reaction-store";
import { getAccessForRepository } from "../repo-access";
import {
	type PublicUser,
	publicUserFields,
	type RepositoryRowWithOwner,
} from "../repository-lookup";
import { submittedReviewsByIds } from "../review-store";
import { findThreadByNumber, type ThreadRef } from "../thread-store";
import { countTimeline, listTimeline } from "../timeline-store";
import type { ApiContext } from "./auth";
import { json, linkHeader, notFoundError, pageParams } from "./http";
import { pathParams } from "./input";
import { readableRepository } from "./repo-lookup";
import {
	issueComment,
	reviewedItem,
	type Shape,
	simpleUser,
	timelineEvent,
} from "./serializers";
import { fullNameOf, serializeThreadsByNumber } from "./threads";

/** The users `review_requested`/`review_request_removed` events name. */
async function reviewersOf(
	entries: TimelineEntry[],
): Promise<Map<string, PublicUser>> {
	const names = new Set<string>();
	for (const entry of entries) {
		if (
			entry.event === "review_requested" ||
			entry.event === "review_request_removed"
		) {
			names.add(entry.reviewer.username);
		}
	}
	if (names.size === 0) return new Map();
	const users = await db.query.user.findMany({
		...publicUserFields,
		where: { username: { in: [...names] } },
	});
	return new Map(users.map((u) => [u.username.toLowerCase(), u]));
}

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
	reactions: ReactionRollup,
): Shape<"timelineItem"> {
	return {
		...issueComment({
			fullName,
			kind: thread.kind,
			number: thread.number,
			comment,
			author: comment.author,
			reactions,
		}),
		event: "commented" as const,
		actor: simpleUser(comment.author),
	};
}

/**
 * GitHub's `author_association` for each user: the repository's owner, a
 * collaborator, or neither. (CONTRIBUTOR/MEMBER need commit authorship and
 * organizations, which PushStack doesn't track.)
 */
async function authorAssociations(
	repo: RepositoryRowWithOwner,
	userIds: string[],
): Promise<Map<string, Shape<"reviewedItem">["author_association"]>> {
	const unique = [...new Set(userIds)];
	const roles = await Promise.all(
		unique.map(async (userId) => {
			const { role } = await getAccessForRepository(repo, userId);
			return [
				userId,
				role === "owner"
					? "OWNER"
					: role === "anonymous"
						? "NONE"
						: "COLLABORATOR",
			] as const;
		}),
	);
	return new Map(roles);
}

export async function listTimelineItems(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const number = pathParams(
		ctx,
		"issues/list-events-for-timeline",
	).issue_number;
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
	const rollups = await commentReactionRollups(
		merged.flatMap((item) =>
			item.kind === "comment" ? [item.comment.id] : [],
		),
	);
	const reviewIds = merged.flatMap((item) =>
		item.kind === "event" && item.entry.event === "reviewed"
			? [item.entry.reviewId]
			: [],
	);
	const reviews = new Map(
		(await submittedReviewsByIds(thread.id, reviewIds)).map((review) => [
			review.id,
			review,
		]),
	);
	const associations = await authorAssociations(
		repo,
		[...reviews.values()].map((review) => review.authorId),
	);
	const threadByNumber = await serializeThreadsByNumber(
		repo,
		merged.flatMap((item) =>
			item.kind === "event" && item.entry.event === "cross-referenced"
				? [item.entry.source.number]
				: [],
		),
	);
	const reviewers = await reviewersOf(
		merged.flatMap((item) => (item.kind === "event" ? [item.entry] : [])),
	);
	return json(
		merged.flatMap((item) => {
			if (item.kind === "comment") {
				return [
					commentedItem(
						fullName,
						thread,
						item.comment,
						rollups.get(item.comment.id) ?? emptyReactionRollup(),
					),
				];
			}
			if (item.entry.event === "reviewed") {
				const review = reviews.get(item.entry.reviewId);
				if (!review) throw new Error(`Review ${item.entry.reviewId} missing`);
				return [
					reviewedItem({
						fullName,
						number: thread.number,
						review,
						association: associations.get(review.authorId) ?? "NONE",
					}),
				];
			}
			const event = timelineEvent(item.entry, {
				fullName,
				threadByNumber,
				reviewers,
			});
			return event ? [event] : [];
		}),
		200,
		linkHeader(ctx.url, params, eventTotal + commentTotal),
	);
}

export async function listEvents(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const number = pathParams(ctx, "issues/list-events").issue_number;
	const thread = await findThreadByNumber(repo.id, number);
	if (!thread) throw notFoundError();
	const params = pageParams(ctx.url.searchParams);
	const [entries, total] = await Promise.all([
		params.reachable
			? listTimeline(thread.id, {
					limit: params.perPage,
					offset: params.offset,
					scope: "issue-events",
				})
			: [],
		countTimeline(thread.id, "issue-events"),
	]);
	const fullName = fullNameOf(repo);
	const threadByNumber = await serializeThreadsByNumber(
		repo,
		entries.flatMap((entry) =>
			entry.event === "cross-referenced" ? [entry.source.number] : [],
		),
	);
	const reviewers = await reviewersOf(entries);
	return json(
		entries.flatMap((entry) => {
			const event = timelineEvent(entry, {
				fullName,
				threadByNumber,
				reviewers,
			});
			return event ? [event] : [];
		}),
		200,
		linkHeader(ctx.url, params, total),
	);
}
