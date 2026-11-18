/**
 * GitHub discussions over the shared thread store: `Repository.discussion`,
 * `discussions`, `discussionCategories` and `discussionCategory`, the
 * `Discussion`, `DiscussionComment` and `DiscussionCategory` types, their
 * mutations and `node(id:)`. A discussion is an `issues` row, so reactions,
 * labels, subscriptions and notifications are the thread's.
 */
import { db } from "#/db";
import {
	MAX_BODY_CHARS,
	MAX_LIST_SKIP,
	MAX_THREAD_TITLE_CHARS,
} from "#/lib/limits";
import { REACTION_CONTENTS, type ReactionContent } from "#/lib/reactions";
import { tokenAllows } from "#/lib/token-scopes";
import { htmlUrl, isoTimestamp } from "../../api/http";
import { findComment, updateCommentRow } from "../../comment-store";
import {
	addDiscussionUpvote,
	createDiscussionCommentForUser,
	createDiscussionForUser,
	type DiscussionCommentRow,
	DiscussionReplyError,
	type DiscussionRow,
	deleteDiscussion,
	findDiscussion,
	findDiscussionById,
	findDiscussionCategoryById,
	findDiscussionCategoryBySlug,
	findDiscussionComment,
	isAnswerable,
	listDiscussionCategories,
	listDiscussionComments,
	listDiscussionReplies,
	listDiscussions,
	removeDiscussionUpvote,
	setDiscussionAnswer,
	setDiscussionState,
	updateDiscussionFields,
} from "../../discussion-store";
import { listThreadReactions } from "../../reaction-store";
import { getAccessForRepository } from "../../repo-access";
import {
	type Connection,
	countedConnection,
	offsetConnection,
} from "../connection";
import type { GraphQLContext } from "../context";
import {
	forbidden,
	GitHubGraphQLError,
	notFound,
	unprocessable,
} from "../errors";
import {
	decodeGlobalNodeId,
	decodeNodeId,
	encodeGlobalNodeId,
	encodeNodeId,
	rowIdOfNodeKey,
} from "../node-id";
import { loadUser, userNode } from "./core";
import type {
	AddDiscussionCommentInput,
	AddUpvoteInput,
	CloseDiscussionInput,
	CreateDiscussionInput,
	DeleteDiscussionCommentInput,
	DeleteDiscussionInput,
	DiscussionCommentsArgs,
	DiscussionLabelsArgs,
	MarkDiscussionCommentAsAnswerInput,
	RemoveUpvoteInput,
	RepositoryDiscussionArgs,
	RepositoryDiscussionCategoriesArgs,
	RepositoryDiscussionCategoryArgs,
	RepositoryDiscussionsArgs,
	UnmarkDiscussionCommentAsAnswerInput,
	UpdateDiscussionCommentInput,
	UpdateDiscussionInput,
} from "./generated";
import { arrayConnection, assertTextBytes, groups } from "./pulls-detail";
import {
	type RepositoryNode,
	readableRepositoryNode,
	repositoryNodeById,
} from "./repository";
import type { DomainResolvers, NodeLoader } from "./types";

export interface DiscussionCategoryNode {
	__typename: "DiscussionCategory";
	id: string;
	name: string;
	slug: string;
	emoji: string;
	description: string | null;
	isAnswerable: boolean;
	createdAt: string;
	updatedAt: string;
	/** Internal: the repository the category belongs to. */
	repo: RepositoryNode;
}

export interface DiscussionNode {
	__typename: "Discussion";
	id: string;
	databaseId: number;
	number: number;
	title: string;
	body: string;
	closed: boolean;
	closedAt: string | null;
	stateReason: "DUPLICATE" | "OUTDATED" | "REOPENED" | "RESOLVED" | null;
	createdAt: string;
	updatedAt: string;
	url: string;
	resourcePath: string;
	upvoteCount: number;
	viewerHasUpvoted: boolean;
	locked: boolean;
	isAnswered: boolean;
	answerChosenAt: string | null;
	answerCommentId: number | null;
	category: DiscussionCategoryNode;
	/** Internal: the discussion row. */
	row: DiscussionRow;
	repo: RepositoryNode;
}

export interface DiscussionCommentNode {
	__typename: "DiscussionComment";
	id: string;
	databaseId: number;
	body: string;
	createdAt: string;
	updatedAt: string;
	includesCreatedEdit: boolean;
	isAnswer: boolean;
	url: string;
	resourcePath: string;
	upvoteCount: number;
	viewerHasUpvoted: boolean;
	/** Internal: the comment row. */
	row: DiscussionCommentRow;
	repo: RepositoryNode;
	discussion: DiscussionRow;
}

const STATE_REASONS = {
	duplicate: "DUPLICATE",
	outdated: "OUTDATED",
	reopened: "REOPENED",
	resolved: "RESOLVED",
} as const;

function pathOf(discussion: DiscussionRow, repo: RepositoryNode): string {
	return `/${repo.nameWithOwner}/discussions/${discussion.issue.number}`;
}

export function discussionCategoryNode(
	repo: RepositoryNode,
	category: DiscussionRow["category"],
): DiscussionCategoryNode {
	return {
		__typename: "DiscussionCategory",
		id: encodeGlobalNodeId("DiscussionCategory", repo.row.id, category.id),
		name: category.name,
		slug: category.slug,
		emoji: category.emoji,
		description: category.description,
		isAnswerable: isAnswerable(category),
		createdAt: isoTimestamp(category.createdAt),
		updatedAt: isoTimestamp(category.createdAt),
		repo,
	};
}

export function discussionNode(
	repo: RepositoryNode,
	row: DiscussionRow,
): DiscussionNode {
	const path = pathOf(row, repo);
	return {
		__typename: "Discussion",
		id: encodeGlobalNodeId("Discussion", repo.row.id, row.issue.id),
		databaseId: row.issue.id,
		number: row.issue.number,
		title: row.issue.title,
		body: row.issue.body ?? "",
		closed: row.issue.status !== "open",
		closedAt: row.issue.closedAt ? isoTimestamp(row.issue.closedAt) : null,
		stateReason: row.stateReason ? STATE_REASONS[row.stateReason] : null,
		createdAt: isoTimestamp(row.issue.createdAt),
		updatedAt: isoTimestamp(row.issue.updatedAt),
		url: htmlUrl(path),
		resourcePath: path,
		upvoteCount: row.upvoteCount,
		viewerHasUpvoted: row.viewerHasUpvoted,
		locked: row.locked,
		isAnswered: row.answerCommentId !== null,
		answerChosenAt: row.answerChosenAt
			? isoTimestamp(row.answerChosenAt)
			: null,
		answerCommentId: row.answerCommentId,
		category: discussionCategoryNode(repo, row.category),
		row,
		repo,
	};
}

export function discussionCommentNode(
	repo: RepositoryNode,
	row: DiscussionCommentRow,
	discussion: DiscussionRow,
): DiscussionCommentNode {
	const number = discussion.issue.number;
	const path = `/${repo.nameWithOwner}/discussions/${number}#discussioncomment-${row.comment.id}`;
	return {
		__typename: "DiscussionComment",
		id: encodeGlobalNodeId("DiscussionComment", repo.row.id, row.comment.id),
		databaseId: row.comment.id,
		body: row.comment.body,
		createdAt: isoTimestamp(row.comment.createdAt),
		updatedAt: isoTimestamp(row.comment.updatedAt),
		includesCreatedEdit: row.comment.editedAt !== null,
		isAnswer: discussion.answerCommentId === row.comment.id,
		url: htmlUrl(path),
		resourcePath: path,
		upvoteCount: row.upvoteCount,
		viewerHasUpvoted: row.viewerHasUpvoted,
		row,
		repo,
		discussion,
	};
}

const noReactions = () =>
	Object.fromEntries(
		REACTION_CONTENTS.map((content) => [content, 0]),
	) as Record<ReactionContent, number>;

const viewerIs = (ctx: GraphQLContext, authorId: string) =>
	authorId === ctx.caller.userId;

const canWrite = (repo: RepositoryNode) =>
	["owner", "admin", "write"].includes(repo.role);

async function authorAssociation(repo: RepositoryNode, userId: string) {
	const access = await getAccessForRepository(repo.row, userId);
	return access.role === "owner"
		? ("OWNER" as const)
		: access.role === "anonymous"
			? ("NONE" as const)
			: ("COLLABORATOR" as const);
}

async function threadReactions(
	ctx: GraphQLContext,
	row: DiscussionRow,
): Promise<Awaited<ReturnType<typeof listThreadReactions>>> {
	return ctx.memo(`discussion-reactions:${row.issue.id}`, () =>
		listThreadReactions(row.issue.id, ctx.caller.userId),
	);
}

/** `discussionCategory(slug:)` and a `categoryId` argument's node id, as a row id. */
function categoryKeyOf(nodeId: string): number | null {
	const global = decodeGlobalNodeId(nodeId);
	if (global?.type === "DiscussionCategory") return rowIdOfNodeKey(global.key);
	const legacy = decodeNodeId(nodeId);
	return legacy?.type === "DiscussionCategory"
		? rowIdOfNodeKey(legacy.key)
		: null;
}

function requireScope(ctx: GraphQLContext) {
	if (!tokenAllows(ctx.caller.scopes, "repo:write"))
		throw new GitHubGraphQLError(
			"INSUFFICIENT_SCOPES",
			"Your token has not been granted the required scopes to execute this mutation.",
		);
}

const unknownNode = (id: string) =>
	notFound(`Could not resolve to a node with the global id of '${id}'`);

function requireDiscussions(repo: RepositoryNode): void {
	if (!repo.hasDiscussionsEnabled)
		throw notFound("Discussions are disabled for this repository.");
}

async function discussionByNodeId(
	id: string,
	ctx: GraphQLContext,
	requireWritable = false,
): Promise<{ repo: RepositoryNode; row: DiscussionRow }> {
	const decoded = decodeGlobalNodeId(id);
	const key =
		decoded?.type === "Discussion" ? rowIdOfNodeKey(decoded.key) : null;
	const repoId =
		decoded?.type === "Discussion" ? decoded.repositoryId : undefined;
	const repo =
		repoId === undefined ? null : await repositoryNodeById(ctx, repoId);
	if (key === null || !repo) throw unknownNode(id);
	if (requireWritable) requireDiscussions(repo);
	const row = await findDiscussionById(key, ctx.caller.userId);
	if (!row) throw unknownNode(id);
	return { repo, row };
}

async function commentByNodeId(id: string, ctx: GraphQLContext) {
	const decoded = decodeGlobalNodeId(id);
	const key =
		decoded?.type === "DiscussionComment" ? rowIdOfNodeKey(decoded.key) : null;
	const row =
		key === null ? null : await findDiscussionComment(key, ctx.caller.userId);
	if (!decoded || !row) throw unknownNode(id);
	const repo = await repositoryNodeById(ctx, decoded.repositoryId);
	if (!repo) throw unknownNode(id);
	const discussion = await findDiscussionById(
		row.comment.issueId,
		ctx.caller.userId,
	);
	if (!discussion) throw unknownNode(id);
	return { repo, row, discussion };
}

const loadDiscussion: NodeLoader = async (key, ctx, id) => {
	const rowId = rowIdOfNodeKey(key);
	const repoId = id?.repositoryId;
	if (rowId === null || repoId === undefined) return null;
	const repo = await repositoryNodeById(ctx, repoId);
	if (!repo) return null;
	const row = await findDiscussionById(rowId, ctx.caller.userId);
	return row ? discussionNode(repo, row) : null;
};

const loadDiscussionComment: NodeLoader = async (key, ctx, id) => {
	const rowId = rowIdOfNodeKey(key);
	const repoId = id?.repositoryId;
	if (rowId === null || repoId === undefined) return null;
	const repo = await repositoryNodeById(ctx, repoId);
	if (!repo) return null;
	const row = await findDiscussionComment(rowId, ctx.caller.userId);
	if (!row) return null;
	const discussion = await findDiscussionById(
		row.comment.issueId,
		ctx.caller.userId,
	);
	return discussion ? discussionCommentNode(repo, row, discussion) : null;
};

const loadDiscussionCategory: NodeLoader = async (key, ctx, id) => {
	const rowId = rowIdOfNodeKey(key);
	const repoId = id?.repositoryId;
	if (rowId === null || repoId === undefined) return null;
	const repo = await repositoryNodeById(ctx, repoId);
	if (!repo) return null;
	const category = await findDiscussionCategoryById(rowId);
	return category ? discussionCategoryNode(repo, category) : null;
};

async function repositoryDiscussions(
	repo: RepositoryNode,
	args: RepositoryDiscussionsArgs,
	ctx: GraphQLContext,
) {
	if (!repo.hasDiscussionsEnabled)
		return countedConnection(args, async () => ({ items: [], total: 0 }));
	let categoryId: number | undefined;
	if (args.categoryId != null) {
		const key = categoryKeyOf(args.categoryId);
		if (key === null) throw unknownNode(args.categoryId);
		const category = await findDiscussionCategoryById(key);
		if (!category || category.repoId !== repo.row.id)
			throw notFound("Could not resolve to a DiscussionCategory node.");
		categoryId = category.id;
	}
	const orderBy = args.orderBy;
	return countedConnection(args, async (offset, limit) => {
		if (offset > MAX_LIST_SKIP)
			throw unprocessable("Pagination offset exceeds the maximum");
		const { discussions: rows, total } = await listDiscussions(
			{ repoId: repo.row.id, categoryId, answered: args.answered ?? undefined },
			ctx.caller.userId,
			{
				sort: {
					by: orderBy?.field === "CREATED_AT" ? "created" : "updated",
					direction: orderBy?.direction === "ASC" ? "asc" : "desc",
				},
				limit,
				offset,
			},
		);
		assertTextBytes(rows.map((row) => row.issue));
		return { items: rows.map((row) => discussionNode(repo, row)), total };
	});
}

async function repositoryDiscussionCategories(
	repo: RepositoryNode,
	args: RepositoryDiscussionCategoriesArgs,
): Promise<Connection<DiscussionCategoryNode>> {
	if (!repo.hasDiscussionsEnabled)
		return offsetConnection(args, 0, async () => []);
	const rows = await listDiscussionCategories(repo.row.id);
	return offsetConnection(args, rows.length, async (offset, limit) =>
		rows
			.slice(offset, offset + limit)
			.map((category) => discussionCategoryNode(repo, category)),
	);
}

async function discussionComments(
	node: DiscussionNode,
	args: DiscussionCommentsArgs,
	ctx: GraphQLContext,
) {
	return countedConnection(args, async (offset, limit) => {
		if (offset > MAX_LIST_SKIP)
			throw unprocessable("Pagination offset exceeds the maximum");
		const { comments: rows, total } = await listDiscussionComments(
			node.row.issue.id,
			ctx.caller.userId,
			{ limit, offset },
		);
		assertTextBytes(rows.map((row) => row.comment));
		return {
			items: rows.map((row) => discussionCommentNode(node.repo, row, node.row)),
			total,
		};
	});
}

function authorOrWrite(
	ctx: GraphQLContext,
	repo: RepositoryNode,
	authorId: string,
) {
	if (authorId !== ctx.caller.userId && !canWrite(repo))
		throw forbidden("You do not have permission to do that.");
}

function checkTitleAndBody(
	title: string | null | undefined,
	body: string | null | undefined,
) {
	const text = (title ?? "").trim();
	if (
		!text ||
		text.length > MAX_THREAD_TITLE_CHARS ||
		(body?.length ?? 0) > MAX_BODY_CHARS
	)
		throw unprocessable("Invalid discussion title or body");
	return text;
}

async function reloadDiscussion(
	repo: RepositoryNode,
	number: number,
	ctx: GraphQLContext,
) {
	const row = await findDiscussion(repo.row.id, number, ctx.caller.userId);
	if (!row) throw new Error("Discussion missing after a mutation");
	return discussionNode(repo, row);
}

async function createDiscussionMutation(
	input: CreateDiscussionInput,
	ctx: GraphQLContext,
) {
	requireScope(ctx);
	const repoDecoded = decodeNodeId(input.repositoryId);
	const repoId =
		repoDecoded?.type === "Repository" ? rowIdOfNodeKey(repoDecoded.key) : null;
	const repoRow =
		repoId === null
			? undefined
			: await db.query.repositories.findFirst({
					where: { id: repoId },
					with: { owner: true },
				});
	const repo = repoRow
		? await readableRepositoryNode(ctx, repoRow.owner.username, repoRow.name)
		: null;
	if (!repo) throw unknownNode(input.repositoryId);
	requireDiscussions(repo);
	if (repo.row.archived) throw forbidden("Repository is archived");
	const categoryKey = categoryKeyOf(input.categoryId);
	const category =
		categoryKey === null
			? undefined
			: await findDiscussionCategoryById(categoryKey);
	if (!category || category.repoId !== repo.row.id)
		throw notFound("Could not resolve to a DiscussionCategory node.");
	if (category.format === "announcement" && !canWrite(repo))
		throw forbidden("Only maintainers can post in this category.");
	const title = checkTitleAndBody(input.title, input.body);
	const issue = await createDiscussionForUser(repo.row.id, ctx.caller.userId, {
		title,
		body: input.body,
		categoryId: category.id,
	});
	return {
		clientMutationId: input.clientMutationId ?? null,
		discussion: await reloadDiscussion(repo, issue.number, ctx),
	};
}

async function addDiscussionCommentMutation(
	input: AddDiscussionCommentInput,
	ctx: GraphQLContext,
) {
	requireScope(ctx);
	const { repo, row } = await discussionByNodeId(input.discussionId, ctx, true);
	if (repo.row.archived) throw forbidden("Repository is archived");
	if (!input.body.trim() || input.body.length > MAX_BODY_CHARS)
		throw unprocessable("Invalid comment body");
	let replyToId: number | undefined;
	if (input.replyToId != null) {
		const parentKey = decodeGlobalNodeId(input.replyToId);
		const key =
			parentKey?.type === "DiscussionComment"
				? rowIdOfNodeKey(parentKey.key)
				: null;
		const parent = key === null ? null : await findComment(key);
		if (!parent || parent.issueId !== row.issue.id)
			throw notFound("Could not resolve to a DiscussionComment node.");
		replyToId = parent.id;
	}
	let comment: Awaited<ReturnType<typeof createDiscussionCommentForUser>>;
	try {
		comment = await createDiscussionCommentForUser(
			row.issue,
			ctx.caller.userId,
			input.body,
			replyToId,
		);
	} catch (error) {
		if (error instanceof DiscussionReplyError)
			throw unprocessable(error.message);
		throw error;
	}
	const fresh = await findDiscussionComment(comment.id, ctx.caller.userId);
	if (!fresh) throw new Error("Comment missing after insert");
	return {
		clientMutationId: input.clientMutationId ?? null,
		comment: discussionCommentNode(repo, fresh, row),
	};
}

async function markAnswerMutation(
	input:
		| MarkDiscussionCommentAsAnswerInput
		| UnmarkDiscussionCommentAsAnswerInput,
	ctx: GraphQLContext,
	marked: boolean,
) {
	requireScope(ctx);
	const { repo, row, discussion } = await commentByNodeId(input.id, ctx);
	requireDiscussions(repo);
	if (repo.row.archived) throw forbidden("Repository is archived");
	if (!isAnswerable(discussion.category))
		throw unprocessable("Only Q&A discussions have an answer.");
	authorOrWrite(ctx, repo, discussion.issue.authorId);
	if (marked)
		await setDiscussionAnswer(
			discussion.issue.id,
			ctx.caller.userId,
			row.comment.id,
		);
	else await setDiscussionAnswer(discussion.issue.id, ctx.caller.userId, null);
	return {
		clientMutationId: input.clientMutationId ?? null,
		discussion: await reloadDiscussion(repo, discussion.issue.number, ctx),
	};
}

async function upvoteMutation(
	input: AddUpvoteInput | RemoveUpvoteInput,
	ctx: GraphQLContext,
	add: boolean,
) {
	requireScope(ctx);
	const decoded = decodeGlobalNodeId(input.subjectId);
	if (!decoded) throw unknownNode(input.subjectId);
	let repo: RepositoryNode | null;
	let row: DiscussionRow;
	let commentId: number | undefined;
	if (decoded.type === "Discussion") {
		const found = await discussionByNodeId(input.subjectId, ctx, true);
		repo = found.repo;
		row = found.row;
	} else if (decoded.type === "DiscussionComment") {
		const found = await commentByNodeId(input.subjectId, ctx);
		repo = found.repo;
		row = found.discussion;
		commentId = found.row.comment.id;
	} else {
		throw unknownNode(input.subjectId);
	}
	if (!repo) throw unknownNode(input.subjectId);
	requireDiscussions(repo);
	if (repo.row.archived) throw forbidden("Repository is archived");
	const access = await getAccessForRepository(repo.row, ctx.caller.userId);
	if (!access.canParticipate)
		throw forbidden("You do not have permission to upvote.");
	if (add)
		await addDiscussionUpvote(row.issue.id, ctx.caller.userId, commentId);
	else await removeDiscussionUpvote(row.issue.id, ctx.caller.userId, commentId);
	const fresh = await findDiscussion(
		row.issue.repoId,
		row.issue.number,
		ctx.caller.userId,
	);
	if (!fresh) throw new Error("Discussion missing after an upvote");
	if (commentId === undefined) {
		return {
			clientMutationId: input.clientMutationId ?? null,
			subject: discussionNode(repo, fresh),
		};
	}
	const freshComment = await findDiscussionComment(
		commentId,
		ctx.caller.userId,
	);
	if (!freshComment) throw new Error("Comment missing after an upvote");
	return {
		clientMutationId: input.clientMutationId ?? null,
		subject: discussionCommentNode(repo, freshComment, fresh),
	};
}

async function closeDiscussionMutation(
	input: CloseDiscussionInput,
	ctx: GraphQLContext,
	status: "open" | "closed",
) {
	requireScope(ctx);
	const { repo, row } = await discussionByNodeId(input.discussionId, ctx, true);
	if (repo.row.archived) throw forbidden("Repository is archived");
	authorOrWrite(ctx, repo, row.issue.authorId);
	const reason =
		input.reason === "OUTDATED"
			? ("outdated" as const)
			: input.reason === "DUPLICATE"
				? ("duplicate" as const)
				: ("resolved" as const);
	await setDiscussionState(
		row.issue,
		ctx.caller.userId,
		status,
		status === "closed" ? reason : undefined,
	);
	return {
		clientMutationId: input.clientMutationId ?? null,
		discussion: await reloadDiscussion(repo, row.issue.number, ctx),
	};
}

async function updateDiscussionMutation(
	input: UpdateDiscussionInput,
	ctx: GraphQLContext,
) {
	requireScope(ctx);
	const { repo, row } = await discussionByNodeId(input.discussionId, ctx, true);
	if (repo.row.archived) throw forbidden("Repository is archived");
	authorOrWrite(ctx, repo, row.issue.authorId);
	let categoryId: number | undefined;
	if (input.categoryId != null) {
		const key = categoryKeyOf(input.categoryId);
		const category =
			key === null ? undefined : await findDiscussionCategoryById(key);
		if (!category || category.repoId !== repo.row.id)
			throw notFound("Could not resolve to a DiscussionCategory node.");
		categoryId = category.id;
	}
	if (input.title != null || input.body != null)
		checkTitleAndBody(
			input.title ?? row.issue.title,
			input.body ?? row.issue.body,
		);
	await updateDiscussionFields(row.issue, ctx.caller.userId, {
		...(input.title != null && { title: input.title.trim() }),
		...(input.body != null && { body: input.body }),
		categoryId,
	});
	return {
		clientMutationId: input.clientMutationId ?? null,
		discussion: await reloadDiscussion(repo, row.issue.number, ctx),
	};
}

async function deleteDiscussionMutation(
	input: DeleteDiscussionInput,
	ctx: GraphQLContext,
) {
	requireScope(ctx);
	const { repo, row } = await discussionByNodeId(input.id, ctx, true);
	if (repo.row.archived) throw forbidden("Repository is archived");
	authorOrWrite(ctx, repo, row.issue.authorId);
	const node = discussionNode(repo, row);
	await deleteDiscussion(row.issue);
	return { clientMutationId: input.clientMutationId ?? null, discussion: node };
}

async function updateDiscussionCommentMutation(
	input: UpdateDiscussionCommentInput,
	ctx: GraphQLContext,
) {
	requireScope(ctx);
	const { repo, row, discussion } = await commentByNodeId(input.commentId, ctx);
	requireDiscussions(repo);
	if (repo.row.archived) throw forbidden("Repository is archived");
	if (!input.body.trim() || input.body.length > MAX_BODY_CHARS)
		throw unprocessable("Invalid comment body");
	if (row.comment.authorId !== ctx.caller.userId && !canWrite(repo))
		throw forbidden("You do not have permission to update this comment.");
	const comment = await findComment(row.comment.id);
	const updated = comment
		? await updateCommentRow(comment, ctx.caller.userId, input.body)
		: null;
	if (!updated) throw new Error("Comment missing after update");
	const fresh = await findDiscussionComment(updated.id, ctx.caller.userId);
	if (!fresh) throw new Error("Comment missing after update");
	return {
		clientMutationId: input.clientMutationId ?? null,
		comment: discussionCommentNode(repo, fresh, discussion),
	};
}

async function deleteDiscussionCommentMutation(
	input: DeleteDiscussionCommentInput,
	ctx: GraphQLContext,
) {
	requireScope(ctx);
	const { repo, row, discussion } = await commentByNodeId(input.id, ctx);
	requireDiscussions(repo);
	if (repo.row.archived) throw forbidden("Repository is archived");
	if (row.comment.authorId !== ctx.caller.userId && !canWrite(repo))
		throw forbidden("You do not have permission to delete this comment.");
	const node = discussionCommentNode(repo, row, discussion);
	const comment = await findComment(row.comment.id);
	if (comment) {
		const { deleteCommentRow } = await import("../../comment-store");
		await deleteCommentRow(comment, {
			...discussion.issue,
			kind: "discussion",
		});
	}
	return { clientMutationId: input.clientMutationId ?? null, comment: node };
}

export const discussionsResolvers: DomainResolvers = {
	types: {
		Repository: {
			discussion: async (
				repo: RepositoryNode,
				args: RepositoryDiscussionArgs,
				ctx: GraphQLContext,
			) => {
				if (!repo.hasDiscussionsEnabled)
					throw notFound(
						`Could not resolve to a Discussion with the number of ${args.number}.`,
					);
				const row = await findDiscussion(
					repo.row.id,
					args.number,
					ctx.caller.userId,
				);
				if (!row)
					throw notFound(
						`Could not resolve to a Discussion with the number of ${args.number}.`,
					);
				return discussionNode(repo, row);
			},
			discussions: (
				repo: RepositoryNode,
				args: RepositoryDiscussionsArgs,
				ctx: GraphQLContext,
			) => repositoryDiscussions(repo, args, ctx),
			discussionCategories: (
				repo: RepositoryNode,
				args: RepositoryDiscussionCategoriesArgs,
			) => repositoryDiscussionCategories(repo, args),
			discussionCategory: async (
				repo: RepositoryNode,
				args: RepositoryDiscussionCategoryArgs,
			) => {
				if (!repo.hasDiscussionsEnabled) return null;
				const category = await findDiscussionCategoryBySlug(
					repo.row.id,
					args.slug,
				);
				return category ? discussionCategoryNode(repo, category) : null;
			},
		},
		Discussion: {
			author: async (node: DiscussionNode, _args, ctx: GraphQLContext) => {
				const row = await loadUser(ctx, node.row.issue.authorId);
				if (!row) throw new Error("Discussion author missing");
				return userNode(row);
			},
			answerChosenBy: async (
				node: DiscussionNode,
				_args,
				ctx: GraphQLContext,
			) => {
				if (!node.row.answerChosenById) return null;
				const row = await loadUser(ctx, node.row.answerChosenById);
				return row ? userNode(row) : null;
			},
			authorAssociation: (node: DiscussionNode) =>
				authorAssociation(node.repo, node.row.issue.authorId),
			repository: (node: DiscussionNode) => node.repo,
			answer: async (node: DiscussionNode, _args, ctx: GraphQLContext) => {
				if (node.answerCommentId === null) return null;
				const row = await findDiscussionComment(
					node.answerCommentId,
					ctx.caller.userId,
				);
				return row ? discussionCommentNode(node.repo, row, node.row) : null;
			},
			comments: (node: DiscussionNode, args: DiscussionCommentsArgs, ctx) =>
				discussionComments(node, args, ctx),
			labels: (node: DiscussionNode, args: DiscussionLabelsArgs) =>
				arrayConnection(
					args,
					node.row.labels.map((row) => ({
						...row,
						id: encodeNodeId("Label", row.id),
					})),
				),
			reactionGroups: async (node: DiscussionNode, _args, ctx) =>
				groups(
					(await threadReactions(ctx, node.row)).issue?.reactions ??
						noReactions(),
				),
			viewerDidAuthor: (node: DiscussionNode, _args, ctx) =>
				viewerIs(ctx, node.row.issue.authorId),
			viewerCanDelete: (node: DiscussionNode, _args, ctx) =>
				viewerIs(ctx, node.row.issue.authorId) || canWrite(node.repo),
			viewerCanUpdate: (node: DiscussionNode, _args, ctx) =>
				viewerIs(ctx, node.row.issue.authorId) || canWrite(node.repo),
			viewerCanClose: (node: DiscussionNode, _args, ctx) =>
				node.closed
					? false
					: viewerIs(ctx, node.row.issue.authorId) || canWrite(node.repo),
			viewerCanReopen: (node: DiscussionNode, _args, ctx) =>
				node.closed
					? viewerIs(ctx, node.row.issue.authorId) || canWrite(node.repo)
					: false,
			viewerCanLabel: (node: DiscussionNode) => canWrite(node.repo),
			viewerCanSubscribe: () => true,
			viewerCanReact: () => true,
			viewerCanUpvote: (node: DiscussionNode) => node.repo.role !== "anonymous",
		},
		DiscussionCategory: {
			repository: (node: DiscussionCategoryNode) => node.repo,
		},
		DiscussionComment: {
			author: async (node: DiscussionCommentNode, _args, ctx) => {
				const row = await loadUser(ctx, node.row.comment.authorId);
				if (!row) throw new Error("Comment author missing");
				return userNode(row);
			},
			authorAssociation: (node: DiscussionCommentNode) =>
				authorAssociation(node.repo, node.row.comment.authorId),
			discussion: (node: DiscussionCommentNode) =>
				discussionNode(node.repo, node.discussion),
			replyTo: async (node: DiscussionCommentNode, _args, ctx) => {
				const parentId = node.row.comment.replyToId;
				if (parentId === null) return null;
				const row = await findDiscussionComment(parentId, ctx.caller.userId);
				return row
					? discussionCommentNode(node.repo, row, node.discussion)
					: null;
			},
			replies: (node: DiscussionCommentNode, args, ctx) =>
				countedConnection(args, async (offset, limit) => {
					if (offset > MAX_LIST_SKIP)
						throw unprocessable("Pagination offset exceeds the maximum");
					const { replies, total } = await listDiscussionReplies(
						node.row.comment.id,
						ctx.caller.userId,
						{ limit, offset },
					);
					assertTextBytes(replies.map((row) => row.comment));
					return {
						items: replies.map((row) =>
							discussionCommentNode(node.repo, row, node.discussion),
						),
						total,
					};
				}),
			viewerDidAuthor: (node: DiscussionCommentNode, _args, ctx) =>
				viewerIs(ctx, node.row.comment.authorId),
			viewerCanDelete: (node: DiscussionCommentNode, _args, ctx) =>
				viewerIs(ctx, node.row.comment.authorId) || canWrite(node.repo),
			viewerCanUpdate: (node: DiscussionCommentNode, _args, ctx) =>
				viewerIs(ctx, node.row.comment.authorId) || canWrite(node.repo),
			viewerCanMarkAsAnswer: (node: DiscussionCommentNode, _args, ctx) =>
				isAnswerable(node.discussion.category) &&
				!node.isAnswer &&
				(viewerIs(ctx, node.discussion.issue.authorId) || canWrite(node.repo)),
			viewerCanUnmarkAsAnswer: (node: DiscussionCommentNode, _args, ctx) =>
				node.isAnswer &&
				(viewerIs(ctx, node.discussion.issue.authorId) || canWrite(node.repo)),
			viewerCanMinimize: () => false,
			viewerCanReact: () => true,
			viewerCanUpvote: (node: DiscussionCommentNode) =>
				node.repo.role !== "anonymous",
		},
		Mutation: {
			createDiscussion: (_source, args, ctx) =>
				createDiscussionMutation(args.input, ctx),
			addDiscussionComment: (_source, args, ctx) =>
				addDiscussionCommentMutation(args.input, ctx),
			markDiscussionCommentAsAnswer: (_source, args, ctx) =>
				markAnswerMutation(args.input, ctx, true),
			unmarkDiscussionCommentAsAnswer: (_source, args, ctx) =>
				markAnswerMutation(args.input, ctx, false),
			addUpvote: (_source, args, ctx) => upvoteMutation(args.input, ctx, true),
			removeUpvote: (_source, args, ctx) =>
				upvoteMutation(args.input, ctx, false),
			closeDiscussion: (_source, args, ctx) =>
				closeDiscussionMutation(args.input, ctx, "closed"),
			reopenDiscussion: (_source, args, ctx) =>
				closeDiscussionMutation(
					{
						discussionId: args.input.discussionId,
						clientMutationId: args.input.clientMutationId,
					},
					ctx,
					"open",
				),
			updateDiscussion: (_source, args, ctx) =>
				updateDiscussionMutation(args.input, ctx),
			deleteDiscussion: (_source, args, ctx) =>
				deleteDiscussionMutation(args.input, ctx),
			updateDiscussionComment: (_source, args, ctx) =>
				updateDiscussionCommentMutation(args.input, ctx),
			deleteDiscussionComment: (_source, args, ctx) =>
				deleteDiscussionCommentMutation(args.input, ctx),
		},
	},
	nodes: {
		Discussion: loadDiscussion,
		DiscussionComment: loadDiscussionComment,
		DiscussionCategory: loadDiscussionCategory,
	},
};
