import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
	MAX_BODY_CHARS,
	MAX_DISCUSSION_CATEGORY_SLUG_CHARS,
	MAX_LIST_SKIP,
	MAX_THREAD_TITLE_CHARS,
	THREAD_PAGE_SIZE,
} from "#/lib/limits";
import { findComment } from "./comment-store";
import {
	addDiscussionUpvote,
	setDiscussionAnswer as chooseDiscussionAnswer,
	createDiscussionCommentForUser,
	createDiscussionForUser,
	type DiscussionCommentRow,
	DiscussionReplyError,
	findDiscussion,
	findDiscussionCategoryById,
	isAnswerable,
	listDiscussionCategories,
	listDiscussionComments,
	listDiscussionReplies,
	listDiscussions,
	removeDiscussionUpvote,
} from "./discussion-store";
import { readInput, threadNumberSchema } from "./read-input";
import {
	canWriteRepo,
	getViewerRepositoryAccess,
	readWithAccess,
	requireNotArchived,
	requireParticipateAccess,
} from "./repo-access";
import { readRepoByName } from "./repository-lookup";
import { getCurrentUser, getCurrentUserOptional } from "./session";
import { findThread, findThreadById } from "./thread-store";

export interface DiscussionView {
	id: number;
	repoId: number;
	number: number;
	title: string;
	body: string;
	status: "open" | "closed";
	createdAt: Date;
	updatedAt: Date;
	author: {
		id: string;
		username: string;
		name: string;
		image: string | null;
	};
	category: {
		id: number;
		name: string;
		slug: string;
		emoji: string;
		format: "open" | "announcement" | "q_and_a";
	};
	locked: boolean;
	isAnswered: boolean;
	answerCommentId: number | null;
	upvoteCount: number;
	viewerHasUpvoted: boolean;
	commentsCount: number;
	labels: { id: number; name: string; color: string }[];
}

function discussionView(
	row: NonNullable<Awaited<ReturnType<typeof findDiscussion>>>,
): DiscussionView {
	return {
		id: row.issue.id,
		repoId: row.issue.repoId,
		number: row.issue.number,
		title: row.issue.title,
		body: row.issue.body ?? "",
		status: row.issue.status,
		createdAt: row.issue.createdAt,
		updatedAt: row.issue.updatedAt,
		author: row.author,
		category: {
			id: row.category.id,
			name: row.category.name,
			slug: row.category.slug,
			emoji: row.category.emoji,
			format: row.category.format,
		},
		locked: row.locked,
		isAnswered: row.answerCommentId != null,
		answerCommentId: row.answerCommentId,
		upvoteCount: row.upvoteCount,
		viewerHasUpvoted: row.viewerHasUpvoted,
		commentsCount: row.commentsCount,
		labels: row.labels,
	};
}

export interface DiscussionCommentView {
	id: number;
	body: string;
	createdAt: Date;
	updatedAt: Date;
	editedAt: Date | null;
	author: {
		id: string;
		username: string;
		name: string;
		image: string | null;
	};
	isAnswer: boolean;
	upvoteCount: number;
	viewerHasUpvoted: boolean;
	replyToId: number | null;
	replies: DiscussionCommentView[];
}

function commentView(
	row: DiscussionCommentRow,
	answerCommentId: number | null,
	replies: DiscussionCommentRow[] = [],
): DiscussionCommentView {
	return {
		id: row.comment.id,
		body: row.comment.body,
		createdAt: row.comment.createdAt,
		updatedAt: row.comment.updatedAt,
		editedAt: row.comment.editedAt,
		author: row.author,
		isAnswer: row.comment.id === answerCommentId,
		upvoteCount: row.upvoteCount,
		viewerHasUpvoted: row.viewerHasUpvoted,
		replyToId: row.comment.replyToId,
		replies: replies.map((reply) => commentView(reply, answerCommentId)),
	};
}

export const getDiscussions = createServerFn({ method: "GET" })
	.validator(
		z.object({
			repoId: z.number().int().positive(),
			category: z.string().max(MAX_DISCUSSION_CATEGORY_SLUG_CHARS).optional(),
		}),
	)
	.handler(({ data }) =>
		readWithAccess("getDiscussions", data.repoId, async () => {
			const [viewer, user] = await Promise.all([
				getViewerRepositoryAccess(data.repoId),
				getCurrentUserOptional(),
			]);
			const categories = await listDiscussionCategories(data.repoId);
			const category = data.category
				? categories.find((row) => row.slug === data.category)
				: undefined;
			if (data.category && !category) {
				return { categories, discussions: [], viewer };
			}
			const { discussions } = await listDiscussions(
				{ repoId: data.repoId, categoryId: category?.id },
				user?.id ?? "",
				{ sort: { by: "updated", direction: "desc" }, limit: 100 },
			);
			return {
				categories,
				discussions: discussions.map(discussionView),
				viewer,
			};
		}),
	);

export const getDiscussionByNumber = createServerFn({ method: "GET" })
	.validator(
		readInput(
			z.object({
				owner: z.string(),
				name: z.string(),
				number: threadNumberSchema,
			}),
		),
	)
	.handler(({ data }) =>
		readRepoByName(
			`getDiscussionByNumber ${data.owner}/${data.name}#${data.number}`,
			data.owner,
			data.name,
			async (repo) => {
				const [user, viewer] = await Promise.all([
					getCurrentUserOptional(),
					getViewerRepositoryAccess(repo.id),
				]);
				const row = await findDiscussion(repo.id, data.number, user?.id ?? "");
				if (!row) throw notFound();
				return { discussion: discussionView(row), viewer };
			},
		),
	);

export const getDiscussionComments = createServerFn({ method: "GET" })
	.validator(
		z.object({
			discussionId: z.number().int().positive(),
			skip: z.number().int().min(0).max(MAX_LIST_SKIP).default(0),
		}),
	)
	.handler(async ({ data }) => {
		const thread = await findDiscussionByIdForRead(data.discussionId);
		return readWithAccess("getDiscussionComments", thread.repoId, async () => {
			const user = await getCurrentUserOptional();
			const viewerId = user?.id ?? "";
			const [{ comments }, discussion] = await Promise.all([
				listDiscussionComments(thread.id, viewerId, {
					limit: THREAD_PAGE_SIZE,
					offset: data.skip,
				}),
				findDiscussion(thread.repoId, thread.number, viewerId),
			]);
			if (!discussion) throw notFound();
			const replies = await Promise.all(
				comments.map((comment) =>
					listDiscussionReplies(comment.comment.id, viewerId, { limit: 100 }),
				),
			);
			return comments.map((comment, index) =>
				commentView(
					comment,
					discussion.answerCommentId,
					replies[index]?.replies ?? [],
				),
			);
		});
	});

async function findDiscussionByIdForRead(id: number) {
	const thread = await findThreadById(id);
	if (thread?.kind !== "discussion") throw notFound();
	return thread;
}

export const createDiscussion = createServerFn({ method: "POST" })
	.validator(
		z.object({
			repoId: z.number().int().positive(),
			categoryId: z.number().int().positive(),
			title: z.string().min(1).max(MAX_THREAD_TITLE_CHARS),
			body: z.string().max(MAX_BODY_CHARS),
		}),
	)
	.handler(async ({ data }) => {
		const user = await getCurrentUser();
		await requireParticipateAccess(data.repoId, user.id);
		await requireNotArchived(data.repoId);
		const category = await findDiscussionCategoryById(data.categoryId);
		if (!category || category.repoId !== data.repoId) throw notFound();
		if (
			category.format === "announcement" &&
			!(await canWriteRepo(data.repoId, user.id))
		) {
			throw new Error("Only maintainers can post in this category");
		}
		const issue = await createDiscussionForUser(data.repoId, user.id, {
			title: data.title,
			body: data.body,
			categoryId: category.id,
		});
		return { number: issue.number };
	});

export const commentOnDiscussion = createServerFn({ method: "POST" })
	.validator(
		z.object({
			discussionId: z.number().int().positive(),
			body: z.string().min(1).max(MAX_BODY_CHARS),
			replyToId: z.number().int().positive().optional(),
		}),
	)
	.handler(async ({ data }) => {
		const user = await getCurrentUser();
		const ref = await findDiscussionByIdForRead(data.discussionId);
		await requireParticipateAccess(ref.repoId, user.id);
		await requireNotArchived(ref.repoId);
		const thread = await findThread(ref.repoId, ref.number, "discussion");
		if (!thread) throw notFound();
		try {
			const comment = await createDiscussionCommentForUser(
				thread,
				user.id,
				data.body,
				data.replyToId,
			);
			return { id: comment.id };
		} catch (error) {
			if (error instanceof DiscussionReplyError) throw new Error(error.message);
			throw error;
		}
	});

export const toggleDiscussionUpvote = createServerFn({ method: "POST" })
	.validator(
		z.object({
			discussionId: z.number().int().positive(),
			upvoted: z.boolean(),
		}),
	)
	.handler(async ({ data }) => {
		const user = await getCurrentUser();
		const thread = await findDiscussionByIdForRead(data.discussionId);
		await requireParticipateAccess(thread.repoId, user.id);
		await requireNotArchived(thread.repoId);
		if (data.upvoted) await addDiscussionUpvote(thread.id, user.id);
		else await removeDiscussionUpvote(thread.id, user.id);
		return { upvoted: data.upvoted };
	});

export const markDiscussionAnswer = createServerFn({ method: "POST" })
	.validator(
		z.object({
			commentId: z.number().int().positive(),
			answered: z.boolean(),
		}),
	)
	.handler(async ({ data }) => {
		const user = await getCurrentUser();
		const comment = await findComment(data.commentId);
		if (!comment) throw notFound();
		const thread = await findDiscussionByIdForRead(comment.issueId);
		await requireParticipateAccess(thread.repoId, user.id);
		await requireNotArchived(thread.repoId);
		const discussion = await findDiscussion(
			thread.repoId,
			thread.number,
			user.id,
		);
		if (!discussion) throw notFound();
		if (!isAnswerable(discussion.category)) {
			throw new Error("Only Q&A discussions have an answer");
		}
		const canWrite = await canWriteRepo(thread.repoId, user.id);
		if (discussion.issue.authorId !== user.id && !canWrite) {
			throw new Error("Access denied");
		}
		await chooseDiscussionAnswer(
			thread.id,
			user.id,
			data.answered ? comment.id : null,
		);
		return { answered: data.answered };
	});
