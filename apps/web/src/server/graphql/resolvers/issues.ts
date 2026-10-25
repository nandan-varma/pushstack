/**
 * GitHub issues over the shared thread store: `Repository.issue`, `issues`
 * and `issueOrPullRequest`, `Issue`, and `node(id:)`. Pull requests stay in
 * pulls.ts; an issue-or-pull lookup hands those to its node.
 */
import { db } from "#/db";
import { MAX_LABELS_PER_THREAD, MAX_LIST_SKIP } from "#/lib/limits";
import { REACTION_CONTENTS, type ReactionContent } from "#/lib/reactions";
import { htmlUrl, isoTimestamp } from "../../api/http";
import {
	countCommentsForThread,
	listCommentsForThread,
} from "../../comment-store";
import { listThreadReactions } from "../../reaction-store";
import { getAccessForRepository } from "../../repo-access";
import {
	findIssueById,
	findThread,
	listThreads,
	pullRequestOfThread,
	type Thread,
	type ThreadFilter,
} from "../../thread-store";
import { offsetConnection } from "../connection";
import type { GraphQLContext } from "../context";
import { notFound, unprocessable } from "../errors";
import { encodeNodeId, rowIdOfNodeKey } from "../node-id";
import { loadUser, userNode } from "./core";
import type {
	IssueAssigneesArgs,
	IssueCommentsArgs,
	IssueLabelsArgs,
	IssueSubIssuesArgs,
	RepositoryIssueArgs,
	RepositoryIssueOrPullRequestArgs,
	RepositoryIssuesArgs,
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
		return (await listThreads(filter, { offset, limit, sort })).threads.map(
			(row) => issueNode(repo, row),
		);
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

async function commentNodes(
	node: IssueNode,
	ctx: GraphQLContext,
	offset: number,
	limit: number,
) {
	const rows = await listCommentsForThread(node.row, { offset, limit });
	assertTextBytes(rows);
	const reactions = await threadReactions(node, ctx);
	return Promise.all(
		rows.map(async (row) => {
			const author = await loadUser(ctx, row.authorId);
			if (!author) throw new Error("Comment author missing");
			const access = await getAccessForRepository(node.repo.row, row.authorId);
			return {
				id: encodeNodeId("IssueComment", row.id),
				author: userNode(author),
				authorAssociation:
					access.role === "owner"
						? ("OWNER" as const)
						: access.role === "anonymous"
							? ("NONE" as const)
							: ("COLLABORATOR" as const),
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
