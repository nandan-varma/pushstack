/**
 * Discussions: the categories (shared with the REST API and the settings page)
 * and the reads and writes GraphQL and the web pages serve. A discussion is an
 * `issues` row (see thread-store.ts) with a `discussions` row of its own, as a
 * pull request has a `pull_requests` row. Callers authorize first; everything
 * here assumes the repository exists.
 */
import {
	and,
	asc,
	count,
	desc,
	eq,
	isNotNull,
	isNull,
	ne,
	type SQL,
	sql,
} from "drizzle-orm";
import { db } from "#/db";
import {
	comments,
	discussionCategories,
	discussions,
	discussionUpvotes,
	type Issue,
	issues,
	labels,
	threadLabels,
} from "#/db/app-schema";
import { user } from "#/db/schema";
import {
	DEFAULT_DISCUSSION_CATEGORIES,
	type DiscussionCategoryFormat,
	type DiscussionStateReason,
	discussionCategorySlug,
} from "#/lib/discussions";
import type { LabelView } from "#/lib/labels";
import { MAX_DISCUSSION_CATEGORIES_PER_REPOSITORY } from "#/lib/limits";
import { deleteActivity, recordActivity } from "./activity";
import { bestEffort } from "./best-effort";
import { deleteCommentRow, updateCommentRow } from "./comment-store";
import { isUniqueViolation } from "./db-errors";
import { recordThreadActivity } from "./notification-store";
import { logError } from "./perf-log";
import {
	assertRepositoryCapacity,
	withRepositoryCapacityLock,
} from "./repository-capacity";
import type { PublicUser } from "./repository-lookup";
import {
	claimNextIssueOrPrNumber,
	publicUserColumns,
} from "./repository-lookup";
import { recordCrossReferences, recordTimelineEvent } from "./timeline-store";

export interface DiscussionCategoryView {
	id: number;
	repoId: number;
	createdAt: Date;
	name: string;
	slug: string;
	emoji: string;
	description: string | null;
	format: DiscussionCategoryFormat;
	position: number;
}

export class DuplicateDiscussionCategoryError extends Error {
	constructor() {
		super("A discussion category with this name already exists");
	}
}

/** Refused only for the last category of a repository that still holds discussions. */
export class DiscussionCategoryNotEmptyError extends Error {
	constructor() {
		super("Move the discussions in this category before deleting it");
	}
}

const categoryColumns = {
	id: discussionCategories.id,
	repoId: discussionCategories.repoId,
	createdAt: discussionCategories.createdAt,
	name: discussionCategories.name,
	slug: discussionCategories.slug,
	emoji: discussionCategories.emoji,
	description: discussionCategories.description,
	format: discussionCategories.format,
	position: discussionCategories.position,
};

export function assertCategoryCapacity(held: number): void {
	assertRepositoryCapacity(
		held,
		MAX_DISCUSSION_CATEGORIES_PER_REPOSITORY,
		`A repository holds at most ${MAX_DISCUSSION_CATEGORIES_PER_REPOSITORY} discussion categories`,
	);
}

export function listDiscussionCategories(
	repoId: number,
): Promise<DiscussionCategoryView[]> {
	return db
		.select(categoryColumns)
		.from(discussionCategories)
		.where(eq(discussionCategories.repoId, repoId))
		.orderBy(asc(discussionCategories.position), asc(discussionCategories.id));
}

async function countCategories(repoId: number): Promise<number> {
	const [held] = await db
		.select({ total: count() })
		.from(discussionCategories)
		.where(eq(discussionCategories.repoId, repoId));
	return Number(held?.total ?? 0);
}

export async function createDiscussionCategory(
	repoId: number,
	data: {
		name: string;
		emoji: string;
		description?: string;
		format?: DiscussionCategoryFormat;
	},
): Promise<DiscussionCategoryView> {
	return withRepositoryCapacityLock(repoId, async () => {
		assertCategoryCapacity(await countCategories(repoId));
		const [category] = await db
			.insert(discussionCategories)
			.values({
				repoId,
				name: data.name,
				slug: discussionCategorySlug(data.name),
				emoji: data.emoji,
				description: data.description || null,
				format: data.format ?? "open",
			})
			.returning(categoryColumns)
			.catch((error: unknown) => {
				throw isUniqueViolation(error)
					? new DuplicateDiscussionCategoryError()
					: error;
			});
		if (!category)
			throw new Error("Discussion category insert returned no row");
		return category;
	});
}

export async function updateDiscussionCategory(
	repoId: number,
	categoryId: number,
	fields: {
		name?: string;
		emoji?: string;
		description?: string;
		format?: DiscussionCategoryFormat;
	},
): Promise<DiscussionCategoryView | null> {
	const changes = {
		...(fields.name !== undefined && {
			name: fields.name,
			slug: discussionCategorySlug(fields.name),
		}),
		...(fields.emoji !== undefined && { emoji: fields.emoji }),
		...(fields.description !== undefined && {
			description: fields.description || null,
		}),
		...(fields.format !== undefined && { format: fields.format }),
	};
	if (Object.keys(changes).length === 0) {
		const [existing] = await db
			.select(categoryColumns)
			.from(discussionCategories)
			.where(
				and(
					eq(discussionCategories.id, categoryId),
					eq(discussionCategories.repoId, repoId),
				),
			);
		return existing ?? null;
	}
	const [category] = await db
		.update(discussionCategories)
		.set(changes)
		.where(
			and(
				eq(discussionCategories.id, categoryId),
				eq(discussionCategories.repoId, repoId),
			),
		)
		.returning(categoryColumns)
		.catch((error: unknown) => {
			throw isUniqueViolation(error)
				? new DuplicateDiscussionCategoryError()
				: error;
		});
	return category ?? null;
}

/**
 * Delete a category, filing the discussions it still holds under the first
 * remaining category (GitHub moves them to General). Deleting the last
 * category while it holds discussions is refused: a discussion always has one.
 */
export async function deleteDiscussionCategory(
	repoId: number,
	categoryId: number,
): Promise<boolean> {
	const remaining = await db
		.select({ id: discussionCategories.id })
		.from(discussionCategories)
		.where(
			and(
				eq(discussionCategories.repoId, repoId),
				ne(discussionCategories.id, categoryId),
			),
		)
		.orderBy(asc(discussionCategories.position), asc(discussionCategories.id))
		.limit(1);
	const target = remaining[0];
	if (target) {
		await db
			.update(discussions)
			.set({ categoryId: target.id })
			.where(eq(discussions.categoryId, categoryId));
	} else {
		const [held] = await db
			.select({ total: count() })
			.from(discussions)
			.where(eq(discussions.categoryId, categoryId));
		if (Number(held?.total ?? 0) > 0)
			throw new DiscussionCategoryNotEmptyError();
	}
	const deleted = await db
		.delete(discussionCategories)
		.where(
			and(
				eq(discussionCategories.id, categoryId),
				eq(discussionCategories.repoId, repoId),
			),
		)
		.returning({ id: discussionCategories.id });
	return deleted.length > 0;
}

export async function createDefaultDiscussionCategories(
	repoId: number,
): Promise<void> {
	await db.insert(discussionCategories).values(
		DEFAULT_DISCUSSION_CATEGORIES.map((category, position) => ({
			repoId,
			name: category.name,
			slug: discussionCategorySlug(category.name),
			emoji: category.emoji,
			description: category.description,
			format: category.format,
			position,
		})),
	);
}

export interface DiscussionRow {
	issue: Issue;
	author: PublicUser;
	category: DiscussionCategoryView;
	answerCommentId: number | null;
	answerChosenAt: Date | null;
	answerChosenById: string | null;
	locked: boolean;
	pinnedAt: Date | null;
	stateReason: DiscussionStateReason | null;
	upvoteCount: number;
	viewerHasUpvoted: boolean;
	commentsCount: number;
	labels: LabelView[];
	total: number;
}

export interface DiscussionCommentRow {
	comment: Comment;
	author: PublicUser;
	replyCount: number;
	upvoteCount: number;
	viewerHasUpvoted: boolean;
	total: number;
}

const json = <T>(value: unknown): T =>
	(typeof value === "string" ? JSON.parse(value) : value) as T;

const discussionLabels = sql`coalesce((select json_agg(json_build_object(
	'id', ${labels.id}, 'name', ${labels.name}, 'color', ${labels.color},
	'description', ${labels.description}) order by lower(${labels.name}))
	from ${threadLabels} inner join ${labels} on ${labels.id} = ${threadLabels.labelId}
	where ${threadLabels.issueId} = ${issues.id}), '[]'::json)`.mapWith(
	json<LabelView[]>,
);

function discussionColumns(viewerId: string) {
	return {
		issue: issues,
		author: publicUserColumns,
		category: discussionCategories,
		discussion: discussions,
		upvoteCount: sql<number>`(select count(*)::int from ${discussionUpvotes}
			where ${discussionUpvotes.issueId} = ${issues.id}
			and ${discussionUpvotes.commentId} is null)`.mapWith(Number),
		viewerHasUpvoted: sql<boolean>`exists (select 1 from ${discussionUpvotes}
			where ${discussionUpvotes.issueId} = ${issues.id}
			and ${discussionUpvotes.commentId} is null
			and ${discussionUpvotes.userId} = ${viewerId})`,
		commentsCount: sql<number>`(select count(*)::int from ${comments}
			where ${comments.issueId} = ${issues.id}
			and ${comments.replyToId} is null)`.mapWith(Number),
		labels: discussionLabels,
		total: sql<number>`count(*) over ()`.mapWith(Number),
	};
}

type DiscussionRecord = {
	issue: Issue;
	author: PublicUser;
	category: typeof discussionCategories.$inferSelect;
	discussion: typeof discussions.$inferSelect;
	upvoteCount: number;
	viewerHasUpvoted: boolean;
	commentsCount: number;
	labels: LabelView[];
	total: number;
};

function toDiscussion(record: DiscussionRecord): DiscussionRow {
	const {
		issueId: _,
		categoryId: _categoryId,
		...discussion
	} = record.discussion;
	return {
		issue: record.issue,
		author: record.author,
		category: record.category,
		...discussion,
		upvoteCount: record.upvoteCount,
		viewerHasUpvoted: record.viewerHasUpvoted,
		commentsCount: record.commentsCount,
		labels: record.labels,
		total: record.total,
	};
}

export interface DiscussionFilter {
	repoId: number;
	categoryId?: number;
	/** Answered (true) or unanswered (false) only; absent means both. */
	answered?: boolean;
}

export interface DiscussionSort {
	by: "created" | "updated";
	direction: "asc" | "desc";
}

function discussionOrder(sort: DiscussionSort): SQL[] {
	const key = sort.by === "updated" ? issues.updatedAt : issues.createdAt;
	const order = sort.direction === "asc" ? asc : desc;
	// Pinned discussions lead their category, as on GitHub; then the order.
	return [
		desc(sql`${discussions.pinnedAt} is not null`),
		order(key),
		order(issues.number),
	];
}

function discussionWhere(filter: DiscussionFilter): SQL {
	return and(
		eq(issues.repoId, filter.repoId),
		eq(issues.kind, "discussion"),
		filter.categoryId === undefined
			? undefined
			: eq(discussions.categoryId, filter.categoryId),
		filter.answered === undefined
			? undefined
			: filter.answered
				? isNotNull(discussions.answerCommentId)
				: isNull(discussions.answerCommentId),
	) as SQL;
}

/**
 * One page of discussions and the total matching, in one query: the page
 * carries its own upvote, top-level comment and reply counts.
 */
export async function listDiscussions(
	filter: DiscussionFilter,
	viewerId: string,
	options: { sort: DiscussionSort; limit: number; offset?: number },
): Promise<{ discussions: DiscussionRow[]; total: number }> {
	const records = (await db
		.select(discussionColumns(viewerId))
		.from(issues)
		.innerJoin(user, eq(user.id, issues.authorId))
		.innerJoin(discussions, eq(discussions.issueId, issues.id))
		.innerJoin(
			discussionCategories,
			eq(discussionCategories.id, discussions.categoryId),
		)
		.where(discussionWhere(filter))
		.orderBy(...discussionOrder(options.sort))
		.limit(options.limit)
		.offset(options.offset ?? 0)) as DiscussionRecord[];
	const first = records[0];
	if (first)
		return { discussions: records.map(toDiscussion), total: first.total };
	if (!options.offset) return { discussions: [], total: 0 };
	const [row] = await db
		.select({ total: sql<number>`count(*)::int`.mapWith(Number) })
		.from(issues)
		.innerJoin(discussions, eq(discussions.issueId, issues.id))
		.where(discussionWhere(filter));
	return { discussions: [], total: row?.total ?? 0 };
}

export async function findDiscussion(
	repoId: number,
	number: number,
	viewerId: string,
): Promise<DiscussionRow | null> {
	const [record] = (await db
		.select(discussionColumns(viewerId))
		.from(issues)
		.innerJoin(user, eq(user.id, issues.authorId))
		.innerJoin(discussions, eq(discussions.issueId, issues.id))
		.innerJoin(
			discussionCategories,
			eq(discussionCategories.id, discussions.categoryId),
		)
		.where(
			and(
				eq(issues.repoId, repoId),
				eq(issues.number, number),
				eq(issues.kind, "discussion"),
			),
		)
		.limit(1)) as DiscussionRecord[];
	return record ? toDiscussion(record) : null;
}

export async function findDiscussionById(
	issueId: number,
	viewerId: string,
): Promise<DiscussionRow | null> {
	const [record] = (await db
		.select(discussionColumns(viewerId))
		.from(issues)
		.innerJoin(user, eq(user.id, issues.authorId))
		.innerJoin(discussions, eq(discussions.issueId, issues.id))
		.innerJoin(
			discussionCategories,
			eq(discussionCategories.id, discussions.categoryId),
		)
		.where(and(eq(issues.id, issueId), eq(issues.kind, "discussion")))
		.limit(1)) as DiscussionRecord[];
	return record ? toDiscussion(record) : null;
}

export function findDiscussionCategoryById(
	categoryId: number,
): Promise<DiscussionCategoryView | undefined> {
	return db
		.select(categoryColumns)
		.from(discussionCategories)
		.where(eq(discussionCategories.id, categoryId))
		.limit(1)
		.then((rows) => rows[0]);
}

export function findDiscussionCategoryBySlug(
	repoId: number,
	slug: string,
): Promise<DiscussionCategoryView | undefined> {
	return db
		.select(categoryColumns)
		.from(discussionCategories)
		.where(
			and(
				eq(discussionCategories.repoId, repoId),
				eq(discussionCategories.slug, slug),
			),
		)
		.limit(1)
		.then((rows) => rows[0]);
}

function discussionCommentColumns(viewerId: string) {
	return {
		comment: comments,
		author: publicUserColumns,
		replyCount: sql<number>`(select count(*)::int from ${comments} reply
			where reply.reply_to_id = ${comments.id})`.mapWith(Number),
		upvoteCount: sql<number>`(select count(*)::int from ${discussionUpvotes}
			where ${discussionUpvotes.commentId} = ${comments.id})`.mapWith(Number),
		viewerHasUpvoted: sql<boolean>`exists (select 1 from ${discussionUpvotes}
			where ${discussionUpvotes.commentId} = ${comments.id}
			and ${discussionUpvotes.userId} = ${viewerId})`,
		total: sql<number>`count(*) over ()`.mapWith(Number),
	};
}

export async function countDiscussionComments(
	discussionId: number,
): Promise<number> {
	const [row] = await db
		.select({ total: count() })
		.from(comments)
		.where(and(eq(comments.issueId, discussionId), isNull(comments.replyToId)));
	return Number(row?.total ?? 0);
}

/** A discussion's top-level comments, oldest first, each with its reply count. */
export async function listDiscussionComments(
	discussionId: number,
	viewerId: string,
	options: { limit: number; offset?: number },
): Promise<{ comments: DiscussionCommentRow[]; total: number }> {
	const rows = (await db
		.select(discussionCommentColumns(viewerId))
		.from(comments)
		.innerJoin(user, eq(user.id, comments.authorId))
		.where(and(eq(comments.issueId, discussionId), isNull(comments.replyToId)))
		.orderBy(asc(comments.createdAt), asc(comments.id))
		.limit(options.limit)
		.offset(options.offset ?? 0)) as Array<{
		comment: Comment;
		author: PublicUser;
		replyCount: number;
		upvoteCount: number;
		viewerHasUpvoted: boolean;
		total: number;
	}>;
	const first = rows[0];
	if (first)
		return {
			comments: rows as DiscussionCommentRow[],
			total: first.total,
		};
	if (!options.offset) return { comments: [], total: 0 };
	const total = await countDiscussionComments(discussionId);
	return { comments: [], total };
}

export async function listDiscussionReplies(
	parentId: number,
	viewerId: string,
	options: { limit: number; offset?: number },
): Promise<{ replies: DiscussionCommentRow[]; total: number }> {
	const rows = (await db
		.select(discussionCommentColumns(viewerId))
		.from(comments)
		.innerJoin(user, eq(user.id, comments.authorId))
		.where(eq(comments.replyToId, parentId))
		.orderBy(asc(comments.createdAt), asc(comments.id))
		.limit(options.limit)
		.offset(options.offset ?? 0)) as DiscussionCommentRow[];
	const first = rows[0];
	if (first) return { replies: rows, total: first.total };
	if (!options.offset) return { replies: [], total: 0 };
	const [row] = await db
		.select({ total: count() })
		.from(comments)
		.where(eq(comments.replyToId, parentId));
	return { replies: [], total: Number(row?.total ?? 0) };
}

export async function findDiscussionComment(
	commentId: number,
	viewerId: string,
): Promise<DiscussionCommentRow | null> {
	const [row] = (await db
		.select(discussionCommentColumns(viewerId))
		.from(comments)
		.innerJoin(user, eq(user.id, comments.authorId))
		.where(eq(comments.id, commentId))
		.limit(1)) as DiscussionCommentRow[];
	return row ?? null;
}

/** The comment's own parent: `null` for a top-level comment, undefined when absent. */
export async function findDiscussionCommentParent(
	commentId: number,
): Promise<number | null | undefined> {
	const [row] = await db
		.select({ replyToId: comments.replyToId })
		.from(comments)
		.where(eq(comments.id, commentId))
		.limit(1);
	return row ? row.replyToId : undefined;
}

/**
 * Create a discussion with its `discussions` row. All-or-nothing, as
 * `createIssueForUser` is: a failure after the issue row exists deletes it
 * again (cascading to the discussion), so a retry creates one.
 */
export async function createDiscussionForUser(
	repoId: number,
	userId: string,
	data: { title: string; body?: string; categoryId: number },
): Promise<Issue> {
	const [issue] = await db
		.insert(issues)
		.values({
			repoId,
			number: await claimNextIssueOrPrNumber(repoId),
			kind: "discussion",
			authorId: userId,
			title: data.title,
			body: data.body || null,
		})
		.returning();
	if (!issue) throw new Error("Discussion insert returned no row");
	let activityId: number | undefined;
	try {
		await db
			.insert(discussions)
			.values({ issueId: issue.id, categoryId: data.categoryId });
		await recordCrossReferences(
			repoId,
			issue.id,
			{ kind: "discussion", number: issue.number, title: issue.title },
			issue.body,
			userId,
		);
		activityId = await recordActivity(userId, repoId, {
			type: "discussion",
			metadata: {
				number: issue.number,
				title: issue.title,
				action: "opened",
			},
		});
		await recordThreadActivity({
			thread: issue,
			actorId: userId,
			actorReason: "author",
			text: issue.body,
		});
		return issue;
	} catch (error) {
		if (activityId !== undefined)
			await deleteActivity(activityId).catch((cleanup: unknown) =>
				logError(
					"discussion-store",
					`Activity ${activityId} was not removed after a failed discussion write`,
					cleanup,
				),
			);
		await db
			.delete(issues)
			.where(eq(issues.id, issue.id))
			.catch((cleanup: unknown) =>
				logError(
					"discussion-store",
					`Discussion ${issue.id} was not removed after a failed write`,
					cleanup,
				),
			);
		throw error;
	}
}

export class DiscussionReplyError extends Error {
	constructor(message: string) {
		super(message);
	}
}

/** A comment on a discussion, or a reply to one of its top-level comments. */
export async function createDiscussionCommentForUser(
	discussion: Issue,
	userId: string,
	body: string,
	replyToId?: number,
): Promise<Comment> {
	if (replyToId !== undefined) {
		const parent = await findDiscussionCommentParent(replyToId);
		if (parent === undefined || parent !== null) {
			// The row is missing, or it is itself a reply: one level only.
			throw new DiscussionReplyError("A reply targets a top-level comment");
		}
	}
	const { locked } = (await db
		.select({ locked: discussions.locked })
		.from(discussions)
		.where(eq(discussions.issueId, discussion.id))
		.limit(1)
		.then((rows) => rows[0] ?? { locked: false })) as { locked: boolean };
	if (locked) throw new DiscussionReplyError("The discussion is locked");
	const { createCommentForUser } = await import("./comment-store");
	return createCommentForUser(
		{ ...discussion, kind: "discussion" },
		userId,
		body,
		replyToId,
	);
}

export async function setDiscussionAnswer(
	issueId: number,
	userId: string,
	commentId: number | null,
): Promise<void> {
	await db
		.update(discussions)
		.set({
			answerCommentId: commentId,
			answerChosenAt: commentId === null ? null : new Date(),
			answerChosenById: commentId === null ? null : userId,
		})
		.where(eq(discussions.issueId, issueId));
}

/** One upvote per viewer and subject, enforced by the partial unique indexes. */
export async function addDiscussionUpvote(
	issueId: number,
	userId: string,
	commentId?: number,
): Promise<void> {
	await db
		.insert(discussionUpvotes)
		.values({ issueId, userId, commentId: commentId ?? null })
		.onConflictDoNothing();
}

export async function removeDiscussionUpvote(
	issueId: number,
	userId: string,
	commentId?: number,
): Promise<void> {
	await db
		.delete(discussionUpvotes)
		.where(
			and(
				eq(discussionUpvotes.issueId, issueId),
				eq(discussionUpvotes.userId, userId),
				commentId === undefined
					? isNull(discussionUpvotes.commentId)
					: eq(discussionUpvotes.commentId, commentId),
			),
		);
}

/**
 * Close or reopen a discussion. The issue row carries the state (a discussion
 * shares the thread), the discussion row its own `stateReason`.
 */
export async function setDiscussionState(
	issue: Issue,
	userId: string,
	status: "open" | "closed",
	stateReason?: DiscussionStateReason,
): Promise<void> {
	const now = new Date();
	await db
		.update(issues)
		.set({
			status,
			closedAt: status === "closed" ? now : null,
			closedById: status === "closed" ? userId : null,
			updatedAt: now,
		})
		.where(eq(issues.id, issue.id));
	await db
		.update(discussions)
		.set({
			stateReason:
				status === "closed" ? (stateReason ?? "resolved") : "reopened",
		})
		.where(eq(discussions.issueId, issue.id));
	await bestEffort(
		"discussion-store",
		`The status event of #${issue.number}`,
		() =>
			recordTimelineEvent(issue.id, userId, {
				event: status === "closed" ? "closed" : "reopened",
			}),
	);
	await bestEffort(
		"discussion-store",
		`The status activity of #${issue.number}`,
		() =>
			recordActivity(userId, issue.repoId, {
				type: "discussion",
				metadata: {
					number: issue.number,
					title: issue.title,
					action: status === "closed" ? "closed" : "reopened",
				},
			}),
	);
}

export async function updateDiscussionFields(
	issue: Issue,
	userId: string,
	fields: { title?: string; body?: string; categoryId?: number },
): Promise<void> {
	if (fields.title !== undefined || fields.body !== undefined) {
		const { updateIssueThreadFields } = await import("./issue-store");
		await updateIssueThreadFields(issue, userId, {
			...(fields.title !== undefined && { title: fields.title }),
			...(fields.body !== undefined && { body: fields.body }),
		});
	}
	if (fields.categoryId !== undefined) {
		await db
			.update(discussions)
			.set({ categoryId: fields.categoryId })
			.where(eq(discussions.issueId, issue.id));
	}
}

export async function deleteDiscussion(issue: Issue): Promise<void> {
	await db.delete(issues).where(eq(issues.id, issue.id));
}

export { deleteCommentRow, updateCommentRow };

type Comment = typeof comments.$inferSelect;

/** Comments of a discussion by id, for mutations that address one. */
export async function findCommentOfDiscussion(
	commentId: number,
): Promise<Comment | undefined> {
	const [row] = await db
		.select()
		.from(comments)
		.where(eq(comments.id, commentId))
		.limit(1);
	return row;
}

/** Fails when a category does not belong to `repoId`. */
export function assertCategoryInRepository(
	category: DiscussionCategoryView | undefined,
	repoId: number,
): DiscussionCategoryView {
	if (!category || category.repoId !== repoId)
		throw new Error("Discussion category does not belong to this repository");
	return category;
}

/** The repository's answerable categories only exist for Q&A. */
export function isAnswerable(category: DiscussionCategoryView): boolean {
	return category.format === "q_and_a";
}

/** Records the discussion's own numbering, used by the web server functions. */
export async function countDiscussions(repoId: number): Promise<number> {
	const [row] = await db
		.select({ total: count() })
		.from(issues)
		.where(and(eq(issues.repoId, repoId), eq(issues.kind, "discussion")));
	return Number(row?.total ?? 0);
}

/** The `#N`s of a repository's discussions (the web list links to them). */
export async function listDiscussionNumbers(repoId: number): Promise<number[]> {
	const rows = await db
		.select({ number: issues.number })
		.from(issues)
		.where(and(eq(issues.repoId, repoId), eq(issues.kind, "discussion")))
		.orderBy(asc(issues.number));
	return rows.map((row) => row.number);
}
