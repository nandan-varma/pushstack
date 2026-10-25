/**
 * GitHub issues over the shared thread store: `Repository.issue`, `issues`
 * and `issueOrPullRequest`, `Issue`, and `node(id:)`. Pull requests stay in
 * pulls.ts; an issue-or-pull lookup hands those to its node.
 */
import { inArray } from "drizzle-orm";
import { db } from "#/db";
import { labels as labelsTable } from "#/db/app-schema";
import {
	MAX_ASSIGNEES,
	MAX_BODY_CHARS,
	MAX_LABELS_PER_THREAD,
	MAX_LIST_SKIP,
	MAX_THREAD_TITLE_CHARS,
} from "#/lib/limits";
import { REACTION_CONTENTS, type ReactionContent } from "#/lib/reactions";
import { tokenAllows } from "#/lib/token-scopes";
import { htmlUrl, isoTimestamp } from "../../api/http";
import { replaceThreadAssignees } from "../../assignees-store";
import {
	countCommentsForThread,
	createCommentForUser,
	listCommentsForThread,
} from "../../comment-store";
import { createIssueForUser, updateIssueThreadFields } from "../../issue-store";
import { setThreadLabels, UnknownLabelError } from "../../label-store";
import { listThreadReactions } from "../../reaction-store";
import { getAccessForRepository } from "../../repo-access";
import {
	findIssueById,
	findThread,
	findThreadById,
	listThreads,
	pullRequestOfThread,
	type Thread,
	type ThreadFilter,
} from "../../thread-store";
import { encodeCursor, offsetConnection } from "../connection";
import type { GraphQLContext } from "../context";
import {
	forbidden,
	GitHubGraphQLError,
	notFound,
	unprocessable,
} from "../errors";
import { decodeNodeId, encodeNodeId, rowIdOfNodeKey } from "../node-id";
import { loadUser, userNode } from "./core";
import type {
	AddAssigneesToAssignableInput,
	AddCommentInput,
	AddLabelsToLabelableInput,
	CloseIssueInput,
	CreateIssueInput,
	IssueAssigneesArgs,
	IssueCommentsArgs,
	IssueLabelsArgs,
	IssueSubIssuesArgs,
	RemoveAssigneesFromAssignableInput,
	RemoveLabelsFromLabelableInput,
	RepositoryIssueArgs,
	RepositoryIssueOrPullRequestArgs,
	RepositoryIssuesArgs,
	UpdateIssueInput,
} from "./generated";
import { pullNode } from "./pulls";
import {
	arrayConnection,
	assertTextBytes,
	groups,
	userFor,
} from "./pulls-detail";
import { type RepositoryNode, readableRepositoryNode } from "./repository";
import type { DomainResolvers, NodeLoader } from "./types";

export interface IssueNode {
	__typename: "Issue";
	id: string;
	databaseId: number;
	number: number;
	title: string;
	body: string;
	state: "OPEN" | "CLOSED";
	stateReason: "COMPLETED" | "NOT_PLANNED" | "REOPENED" | null;
	url: string;
	resourcePath: string;
	createdAt: string;
	updatedAt: string;
	closedAt: string | null;
	closed: boolean;
	row: Thread;
	repo: RepositoryNode;
}

const STATE_REASONS = {
	completed: "COMPLETED",
	not_planned: "NOT_PLANNED",
	reopened: "REOPENED",
} as const;

function issueNode(repo: RepositoryNode, row: Thread): IssueNode {
	const path = `/${repo.nameWithOwner}/issues/${row.number}`;
	return {
		__typename: "Issue",
		id: encodeNodeId("Issue", row.id),
		databaseId: row.id,
		number: row.number,
		title: row.title,
		body: row.body ?? "",
		state: row.status === "open" ? "OPEN" : "CLOSED",
		stateReason: row.stateReason ? STATE_REASONS[row.stateReason] : null,
		url: htmlUrl(path),
		resourcePath: path,
		createdAt: isoTimestamp(row.createdAt),
		updatedAt: isoTimestamp(row.updatedAt),
		closedAt: row.closedAt ? isoTimestamp(row.closedAt) : null,
		closed: row.status !== "open",
		row,
		repo,
	};
}

const loadIssue: NodeLoader = async (key, ctx) => {
	const id = rowIdOfNodeKey(key);
	const issue = id === null ? null : await findIssueById(id);
	if (!issue) return null;
	const thread = await findThread(issue.repoId, issue.number, "issue");
	if (!thread) return null;
	const repoRow = await db.query.repositories.findFirst({
		where: { id: issue.repoId },
		with: { owner: true },
	});
	if (!repoRow) throw new Error("Issue repository missing");
	const repo = await readableRepositoryNode(
		ctx,
		repoRow.owner.username,
		repoRow.name,
	);
	return repo ? issueNode(repo, thread) : null;
};

/** GitHub's IssueOrder mapped onto the thread store's sorts. */
function sortOf(
	orderBy: { field: string; direction: string } | null | undefined,
) {
	const by = orderBy?.field;
	return {
		by:
			by === "UPDATED_AT"
				? ("updated" as const)
				: by === "COMMENTS"
					? ("comments" as const)
					: ("created" as const),
		direction:
			orderBy?.direction === "ASC" ? ("asc" as const) : ("desc" as const),
	};
}

async function issues(repo: RepositoryNode, args: RepositoryIssuesArgs) {
	const filterBy = args.filterBy ?? {};
	if (filterBy.since != null || filterBy.viewerSubscribed === true)
		throw unprocessable(
			"The since and viewerSubscribed issue filters are not supported",
		);
	const labels = [...(args.labels ?? []), ...(filterBy.labels ?? [])].filter(
		(s): s is string => s != null,
	);
	if (labels.length > MAX_LABELS_PER_THREAD)
		throw unprocessable(
			`At most ${MAX_LABELS_PER_THREAD} labels can be filtered`,
		);
	// `states` and `filterBy.states` both narrow; an absent one narrows nothing,
	// and a list naming neither state (an empty one) matches nothing.
	const stateSets = [args.states, filterBy.states].flatMap((list) =>
		list == null ? [] : [list.filter((s) => s != null)],
	);
	const open = stateSets.every((set) => set.includes("OPEN"));
	const closed = stateSets.every((set) => set.includes("CLOSED"));
	const matchesNothing = !open && !closed;
	const filter: ThreadFilter = {
		repoId: repo.row.id,
		kind: "issue",
		state: open && !closed ? "open" : closed && !open ? "closed" : undefined,
		labels: labels.length ? labels : undefined,
		assignees: filterBy.assignee != null ? [filterBy.assignee] : undefined,
		authors: filterBy.createdBy != null ? [filterBy.createdBy] : undefined,
		mentions: filterBy.mentioned != null ? [filterBy.mentioned] : undefined,
		milestones: filterBy.milestone != null ? [filterBy.milestone] : undefined,
	};
	const sort = sortOf(args.orderBy);
	const total = matchesNothing
		? 0
		: (await listThreads(filter, { limit: 1, sort })).total;
	return offsetConnection(args, total, async (offset, limit) => {
		if (offset > MAX_LIST_SKIP)
			throw unprocessable("Pagination offset exceeds the maximum");
		const { threads } = await listThreads(filter, { offset, limit, sort });
		assertTextBytes(threads);
		return threads.map((row) => issueNode(repo, row));
	});
}

const noReactions = () =>
	Object.fromEntries(
		REACTION_CONTENTS.map((content) => [content, 0]),
	) as Record<ReactionContent, number>;

const threadReactions = (node: IssueNode, ctx: GraphQLContext) =>
	ctx.memo(`issue-reactions:${node.row.id}`, () =>
		listThreadReactions(node.row.id, ctx.caller.userId),
	);

type AuthorAssociation = "OWNER" | "NONE" | "COLLABORATOR";

async function commentNodes(
	node: IssueNode,
	ctx: GraphQLContext,
	offset: number,
	limit: number,
) {
	const rows = await listCommentsForThread(node.row, { offset, limit });
	assertTextBytes(rows);
	const reactions = await threadReactions(node, ctx);
	// One access lookup per distinct author on the page, not per comment.
	const associations = new Map<string, Promise<AuthorAssociation>>();
	const associationOf = (userId: string) => {
		let association = associations.get(userId);
		if (!association) {
			association = getAccessForRepository(node.repo.row, userId).then(
				(access): AuthorAssociation =>
					access.role === "owner"
						? "OWNER"
						: access.role === "anonymous"
							? "NONE"
							: "COLLABORATOR",
			);
			associations.set(userId, association);
		}
		return association;
	};
	return Promise.all(
		rows.map(async (row) => {
			const author = await loadUser(ctx, row.authorId);
			if (!author) throw new Error("Comment author missing");
			const association = await associationOf(row.authorId);
			return {
				id: encodeNodeId("IssueComment", row.id),
				author: userNode(author),
				authorAssociation: association,
				body: row.body,
				createdAt: isoTimestamp(row.createdAt),
				includesCreatedEdit: row.editedAt !== null,
				isMinimized: false,
				minimizedReason: null,
				reactionGroups: groups(
					reactions.comments[row.id]?.reactions ?? noReactions(),
				),
				url: htmlUrl(
					`/${node.repo.nameWithOwner}/issues/${node.row.number}#issuecomment-${row.id}`,
				),
				viewerDidAuthor: row.authorId === ctx.caller.userId,
			};
		}),
	);
}

export const issuesResolvers: DomainResolvers = {
	types: {
		Repository: {
			issue: async (repo: RepositoryNode, args: RepositoryIssueArgs) => {
				const row = await findThread(repo.row.id, args.number, "issue");
				if (!row)
					throw notFound(
						`Could not resolve to an Issue with the number of ${args.number}.`,
					);
				return issueNode(repo, row);
			},
			issueOrPullRequest: async (
				repo: RepositoryNode,
				args: RepositoryIssueOrPullRequestArgs,
			) => {
				const row = await findThread(repo.row.id, args.number);
				if (!row)
					throw notFound(
						`Could not resolve to an issue or pull request with the number of ${args.number}.`,
					);
				return row.kind === "pull_request"
					? pullNode(repo, pullRequestOfThread(row))
					: issueNode(repo, row);
			},
			issues: (repo: RepositoryNode, args: RepositoryIssuesArgs) =>
				issues(repo, args),
		},
		Issue: {
			author: async (node: IssueNode, _args, ctx: GraphQLContext) => {
				const row = await loadUser(ctx, node.row.authorId);
				if (!row) throw new Error("Issue author missing");
				return userNode(row);
			},
			repository: (node: IssueNode) => node.repo,
			milestone: (node: IssueNode) => {
				const row = node.row.milestone;
				return row
					? {
							number: row.number,
							title: row.title,
							description: row.description,
							dueOn: row.dueOn ? isoTimestamp(row.dueOn) : null,
						}
					: null;
			},
			labels: (node: IssueNode, args: IssueLabelsArgs) =>
				arrayConnection(
					args,
					node.row.labels.map((row) => ({
						...row,
						id: encodeNodeId("Label", row.id),
					})),
				),
			assignees: async (
				node: IssueNode,
				args: IssueAssigneesArgs,
				ctx: GraphQLContext,
			) =>
				arrayConnection(
					args,
					await Promise.all(
						node.row.assignees.map((row) => userFor(ctx, row.id)),
					),
				),
			comments: async (
				node: IssueNode,
				args: IssueCommentsArgs,
				ctx: GraphQLContext,
			) =>
				offsetConnection(
					args,
					await countCommentsForThread(node.row),
					async (offset, limit) => {
						if (offset > MAX_LIST_SKIP)
							throw unprocessable("Pagination offset exceeds the maximum");
						return commentNodes(node, ctx, offset, limit);
					},
				),
			reactionGroups: async (node: IssueNode, _args, ctx: GraphQLContext) =>
				groups(
					(await threadReactions(node, ctx)).issue?.reactions ?? noReactions(),
				),
			// PushStack has no issue types, parent issues or sub-issues.
			issueType: () => null,
			parent: () => null,
			subIssues: (_node: IssueNode, args: IssueSubIssuesArgs) =>
				offsetConnection(args, 0, async () => []),
			subIssuesSummary: () => ({ total: 0, completed: 0, percentCompleted: 0 }),
		},
	},
	nodes: { Issue: loadIssue },
};

const canWrite = (repo: RepositoryNode) =>
	["owner", "admin", "write"].includes(repo.role);

function requireScope(ctx: GraphQLContext) {
	if (!tokenAllows(ctx.caller.scopes, "repo:write"))
		throw new GitHubGraphQLError(
			"INSUFFICIENT_SCOPES",
			"Your token has not been granted the required scopes to execute this mutation.",
		);
}

const unknownNode = (id: string) =>
	notFound(`Could not resolve to a node with the global id of '${id}'`);

async function readableRepoOf(repoId: number, ctx: GraphQLContext) {
	const row = await db.query.repositories.findFirst({
		where: { id: repoId },
		with: { owner: true },
	});
	if (!row) throw new Error("Repository missing for a thread");
	return readableRepositoryNode(ctx, row.owner.username, row.name);
}

/**
 * The issue a node id names, with its readable repository. Pull requests are
 * refused: their label, assignee, close and comment mutations are not served
 * yet. Anything unreadable is NOT_FOUND.
 */
async function issueByNodeId(id: string, ctx: GraphQLContext) {
	const decoded = decodeNodeId(id);
	const key = decoded ? rowIdOfNodeKey(decoded.key) : null;
	const ref = key === null ? null : await findThreadById(key);
	const repo = ref ? await readableRepoOf(ref.repoId, ctx) : null;
	if (!ref || !repo) throw unknownNode(id);
	if (ref.kind === "pull_request")
		throw unprocessable(
			"Labels, assignees, closing and comments on pull requests are not supported yet",
		);
	const thread = await findThread(ref.repoId, ref.number, "issue");
	if (!thread) throw unknownNode(id);
	return { repo, thread };
}

/** Label node ids as names in this repository; unknown or foreign ids are NOT_FOUND. */
async function labelNamesOf(ids: string[], repoId: number): Promise<string[]> {
	if (ids.length > MAX_LABELS_PER_THREAD)
		throw unprocessable(
			`At most ${MAX_LABELS_PER_THREAD} labels can be applied`,
		);
	const keys = ids.map((id) => {
		const decoded = decodeNodeId(id);
		const key = decoded?.type === "Label" ? rowIdOfNodeKey(decoded.key) : null;
		if (key === null) throw unknownNode(id);
		return key;
	});
	if (keys.length === 0) return [];
	const rows = await db
		.select({
			id: labelsTable.id,
			name: labelsTable.name,
			repoId: labelsTable.repoId,
		})
		.from(labelsTable)
		.where(inArray(labelsTable.id, keys));
	if (rows.length !== new Set(keys).size)
		throw notFound("Could not resolve a label node id");
	if (rows.some((row) => row.repoId !== repoId))
		throw notFound("Could not resolve a label node id");
	return rows.map((row) => row.name);
}

/** User node ids as usernames; each must name an existing user. */
async function assigneeNamesOf(ids: string[], ctx: GraphQLContext) {
	if (ids.length > MAX_ASSIGNEES)
		throw unprocessable(`A thread can have at most ${MAX_ASSIGNEES} assignees`);
	return Promise.all(
		ids.map(async (id) => {
			const decoded = decodeNodeId(id);
			const row =
				decoded?.type === "User" ? await loadUser(ctx, decoded.key) : undefined;
			if (!row) throw unknownNode(id);
			return row.username;
		}),
	);
}

/** The label store's unknown-name error, as GraphQL's UNPROCESSABLE. */
async function withLabelErrors<T>(run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (error) {
		if (error instanceof UnknownLabelError)
			throw unprocessable("A label does not exist in this repository");
		throw error;
	}
}

function checkTitleAndBody(title: string, body: string | null | undefined) {
	const text = title.trim();
	if (
		!text ||
		text.length > MAX_THREAD_TITLE_CHARS ||
		(body?.length ?? 0) > MAX_BODY_CHARS
	)
		throw unprocessable("Invalid issue title or body");
	return text;
}

async function reloadIssue(repo: RepositoryNode, number: number) {
	const thread = await findThread(repo.row.id, number, "issue");
	if (!thread) throw new Error("Issue missing after a mutation");
	return issueNode(repo, thread);
}

async function createIssueMutation(
	input: CreateIssueInput,
	ctx: GraphQLContext,
) {
	requireScope(ctx);
	const decoded = decodeNodeId(input.repositoryId);
	const key =
		decoded?.type === "Repository" ? rowIdOfNodeKey(decoded.key) : null;
	const row =
		key === null
			? undefined
			: await db.query.repositories.findFirst({
					where: { id: key },
					with: { owner: true },
				});
	const repo = row
		? await readableRepositoryNode(ctx, row.owner.username, row.name)
		: null;
	if (!repo) throw unknownNode(input.repositoryId);
	if (repo.row.archived) throw forbidden("Repository is archived");
	if (input.milestoneId != null)
		throw unprocessable("Milestones on issues are not supported yet");
	const title = checkTitleAndBody(input.title, input.body);
	// Labels and assignees are triage: a reader opens the issue bare, as on REST.
	const triage = canWrite(repo);
	if (!triage && (input.labelIds?.length || input.assigneeIds?.length))
		throw forbidden("You do not have permission to label or assign this issue");
	const labelNames =
		triage && input.labelIds
			? await labelNamesOf(input.labelIds, repo.row.id)
			: [];
	const assignees =
		triage && input.assigneeIds
			? await assigneeNamesOf(input.assigneeIds, ctx)
			: undefined;
	// Names are resolved before the insert, and createIssueForUser removes the
	// issue again if a later step fails: a rejected create leaves no row.
	const created = await withLabelErrors(() =>
		createIssueForUser(repo.row.id, ctx.caller.userId, {
			title,
			body: input.body ?? undefined,
			labels: labelNames,
			assignees,
		}),
	);
	return {
		clientMutationId: input.clientMutationId ?? null,
		issue: await reloadIssue(repo, created.number),
	};
}

async function updateIssueMutation(
	input: UpdateIssueInput,
	ctx: GraphQLContext,
) {
	requireScope(ctx);
	const { repo, thread } = await issueByNodeId(input.id, ctx);
	if (repo.row.archived) throw forbidden("Repository is archived");
	const triage = canWrite(repo);
	if (thread.authorId !== ctx.caller.userId && !triage)
		throw forbidden("You do not have permission to update this issue");
	if (!triage && (input.labelIds != null || input.assigneeIds != null))
		throw forbidden("You do not have permission to label or assign this issue");
	if (input.milestoneId != null)
		throw unprocessable("Milestones on issues are not supported yet");
	if (input.title != null || input.body != null)
		checkTitleAndBody(input.title ?? thread.title, input.body ?? thread.body);
	const labelNames =
		input.labelIds != null
			? await labelNamesOf(input.labelIds, repo.row.id)
			: undefined;
	const assignees =
		input.assigneeIds != null
			? await assigneeNamesOf(input.assigneeIds, ctx)
			: undefined;
	await updateIssueThreadFields(thread, ctx.caller.userId, {
		...(input.title != null && { title: input.title }),
		...(input.body != null && { body: input.body }),
		...(input.state != null && {
			status: input.state === "OPEN" ? "open" : "closed",
		}),
	});
	if (labelNames !== undefined)
		await withLabelErrors(() =>
			setThreadLabels(thread, labelNames, ctx.caller.userId),
		);
	if (assignees !== undefined)
		await replaceThreadAssignees(thread, assignees, ctx.caller.userId);
	return {
		clientMutationId: input.clientMutationId ?? null,
		issue: await reloadIssue(repo, thread.number),
	};
}

async function setStateMutation(
	input: { issueId: string; clientMutationId?: string | null },
	ctx: GraphQLContext,
	status: "open" | "closed",
	stateReason?: "completed" | "not_planned",
) {
	requireScope(ctx);
	const { repo, thread } = await issueByNodeId(input.issueId, ctx);
	if (repo.row.archived) throw forbidden("Repository is archived");
	if (thread.authorId !== ctx.caller.userId && !canWrite(repo))
		throw forbidden("You do not have permission to update this issue");
	await updateIssueThreadFields(thread, ctx.caller.userId, {
		status,
		...(stateReason && { stateReason }),
	});
	return {
		clientMutationId: input.clientMutationId ?? null,
		issue: await reloadIssue(repo, thread.number),
	};
}

async function closeIssueMutation(input: CloseIssueInput, ctx: GraphQLContext) {
	if (input.duplicateIssueId != null)
		throw unprocessable("Closing as a duplicate is not supported yet");
	const reason =
		input.stateReason === "NOT_PLANNED"
			? ("not_planned" as const)
			: ("completed" as const);
	return setStateMutation(
		{ issueId: input.issueId, clientMutationId: input.clientMutationId },
		ctx,
		"closed",
		reason,
	);
}

async function labelsMutation(
	input: AddLabelsToLabelableInput | RemoveLabelsFromLabelableInput,
	ctx: GraphQLContext,
	change: "add" | "remove",
) {
	requireScope(ctx);
	const { repo, thread } = await issueByNodeId(input.labelableId, ctx);
	if (!canWrite(repo))
		throw forbidden("You do not have permission to label this issue");
	const named = await labelNamesOf(input.labelIds ?? [], repo.row.id);
	const current = thread.labels.map((label) => label.name);
	const next =
		change === "add"
			? [...new Set([...current, ...named])]
			: current.filter((name) => !named.includes(name));
	if (next.length > MAX_LABELS_PER_THREAD)
		throw unprocessable(
			`At most ${MAX_LABELS_PER_THREAD} labels can be applied`,
		);
	await withLabelErrors(() => setThreadLabels(thread, next, ctx.caller.userId));
	return {
		clientMutationId: input.clientMutationId ?? null,
		labelable: await reloadIssue(repo, thread.number),
	};
}

async function assigneesMutation(
	input: AddAssigneesToAssignableInput | RemoveAssigneesFromAssignableInput,
	ctx: GraphQLContext,
	change: "add" | "remove",
) {
	requireScope(ctx);
	const { repo, thread } = await issueByNodeId(input.assignableId, ctx);
	if (!canWrite(repo))
		throw forbidden("You do not have permission to assign this issue");
	const named = await assigneeNamesOf(input.assigneeIds ?? [], ctx);
	const current = thread.assignees.map((user) => user.username);
	const next =
		change === "add"
			? [...new Set([...current, ...named])]
			: current.filter((name) => !named.includes(name));
	if (next.length > MAX_ASSIGNEES)
		throw unprocessable(`A thread can have at most ${MAX_ASSIGNEES} assignees`);
	await replaceThreadAssignees(thread, next, ctx.caller.userId);
	return {
		clientMutationId: input.clientMutationId ?? null,
		assignable: await reloadIssue(repo, thread.number),
	};
}

async function addCommentMutation(input: AddCommentInput, ctx: GraphQLContext) {
	requireScope(ctx);
	const { repo, thread } = await issueByNodeId(input.subjectId, ctx);
	if (repo.row.archived) throw forbidden("Repository is archived");
	if (!input.body.trim() || input.body.length > MAX_BODY_CHARS)
		throw unprocessable("Invalid comment body");
	await createCommentForUser(thread, ctx.caller.userId, input.body);
	const index = (await countCommentsForThread(thread)) - 1;
	const [node] = await commentNodes(issueNode(repo, thread), ctx, index, 1);
	if (!node) throw new Error("Comment missing after insert");
	return {
		clientMutationId: input.clientMutationId ?? null,
		commentEdge: { cursor: encodeCursor(index), node },
		subject: await reloadIssue(repo, thread.number),
	};
}

issuesResolvers.types.Mutation = {
	createIssue: (_source, args, ctx) => createIssueMutation(args.input, ctx),
	updateIssue: (_source, args, ctx) => updateIssueMutation(args.input, ctx),
	closeIssue: (_source, args, ctx) => closeIssueMutation(args.input, ctx),
	reopenIssue: (_source, args, ctx) =>
		setStateMutation(args.input, ctx, "open"),
	addLabelsToLabelable: (_source, args, ctx) =>
		labelsMutation(args.input, ctx, "add"),
	removeLabelsFromLabelable: (_source, args, ctx) =>
		labelsMutation(args.input, ctx, "remove"),
	addAssigneesToAssignable: (_source, args, ctx) =>
		assigneesMutation(args.input, ctx, "add"),
	removeAssigneesFromAssignable: (_source, args, ctx) =>
		assigneesMutation(args.input, ctx, "remove"),
	addComment: (_source, args, ctx) => addCommentMutation(args.input, ctx),
};
