/** Fields selected by stock gh pr view; repository access is checked by the parent. */
import { and, count, eq, ne } from "drizzle-orm";
import { db } from "#/db";
import { pullRequestReviews } from "#/db/app-schema";
import { MAX_HISTORY_WALK, MAX_LIST_SKIP } from "#/lib/limits";
import { REACTION_CONTENTS, type ReactionContent } from "#/lib/reactions";
import { htmlUrl, isoTimestamp } from "../../api/http";
import {
	countCommentsForThread,
	listCommentsForThread,
} from "../../comment-store";
import {
	getBranchDiff,
	getCommit,
	getCommitInfosBetween,
} from "../../git-read";
import { ownerKeyOf } from "../../git-storage-naming";
import { listThreadReactions } from "../../reaction-store";
import { getAccessForRepository } from "../../repo-access";
import { publicUserFields } from "../../repository-lookup";
import { listRequestedReviewers } from "../../review-request-store";
import { findThread } from "../../thread-store";
import { type ConnectionArgs, offsetConnection } from "../connection";
import type { GraphQLContext } from "../context";
import { unprocessable } from "../errors";
import { encodeNodeId } from "../node-id";
import { type CommitNode, commitNode } from "./commit";
import { loadUser, userNode } from "./core";
import type { PullRequestNode } from "./pulls";
import type { RepositoryNode } from "./repository";

export function assertTextBytes(rows: readonly { body: string | null }[]) {
	if (
		rows.reduce(
			(bytes, row) => bytes + Buffer.byteLength(JSON.stringify(row.body)),
			0,
		) > 1_000_000
	)
		throw unprocessable(
			"Comment connection exceeds the response size limit; request fewer items",
		);
}
export async function userFor(ctx: GraphQLContext, id: string) {
	const row = await loadUser(ctx, id);
	if (!row) throw new Error("Thread user missing");
	return userNode(row);
}
function bounds(offset: number) {
	if (offset > MAX_LIST_SKIP)
		throw unprocessable("Pagination offset exceeds the maximum");
}
function range(node: PullRequestNode) {
	return node.row.status === "merged" && node.row.baseSha && node.row.headSha
		? { base: node.row.baseSha, head: node.row.headSha }
		: { base: node.row.targetBranch, head: node.row.sourceBranch };
}
function diff(node: PullRequestNode, ctx: GraphQLContext) {
	const refs = range(node);
	return ctx.memo(`pull-diff:${node.row.id}`, () =>
		getBranchDiff(
			ownerKeyOf(node.repo.row),
			node.repo.name,
			refs.base,
			refs.head,
		),
	);
}
async function thread(node: PullRequestNode, ctx: GraphQLContext) {
	return ctx.memo(`pull-thread:${node.row.id}`, async () => {
		const row = await findThread(node.row.repoId, node.row.number);
		if (!row) throw new Error("Pull request thread missing");
		return row;
	});
}
export function arrayConnection<T>(args: ConnectionArgs, rows: T[]) {
	return offsetConnection(args, rows.length, async (offset, limit) => {
		bounds(offset);
		return rows.slice(offset, offset + limit);
	});
}
const contentNames: Record<
	ReactionContent,
	| "THUMBS_UP"
	| "THUMBS_DOWN"
	| "LAUGH"
	| "HOORAY"
	| "CONFUSED"
	| "HEART"
	| "ROCKET"
	| "EYES"
> = {
	"+1": "THUMBS_UP",
	"-1": "THUMBS_DOWN",
	laugh: "LAUGH",
	hooray: "HOORAY",
	confused: "CONFUSED",
	heart: "HEART",
	rocket: "ROCKET",
	eyes: "EYES",
};
export function groups(counts: Record<ReactionContent, number>) {
	return REACTION_CONTENTS.map((content) => ({
		content: contentNames[content],
		users: {
			totalCount: counts[content],
		},
	}));
}
async function reactions(
	node: PullRequestNode,
	ctx: GraphQLContext,
	commentId?: number,
) {
	const result = await ctx.memo(`pull-reactions:${node.row.id}`, () =>
		listThreadReactions(node.row.id, ctx.caller.userId),
	);
	const summary = commentId == null ? result.issue : result.comments[commentId];
	return summary
		? groups(summary.reactions)
		: groups({
				"+1": 0,
				"-1": 0,
				laugh: 0,
				hooray: 0,
				confused: 0,
				heart: 0,
				rocket: 0,
				eyes: 0,
			});
}
async function association(repo: RepositoryNode, userId: string) {
	const access = await getAccessForRepository(repo.row, userId);
	return access.role === "owner"
		? ("OWNER" as const)
		: access.role === "anonymous"
			? ("NONE" as const)
			: ("COLLABORATOR" as const);
}
const threadRef = (node: PullRequestNode) => ({
	...node.row,
	kind: "pull_request" as const,
});
export type ReviewNode = Awaited<ReturnType<typeof reviewNodes>>[number];
/** One submitted review as the GraphQL type reads it. */
export async function reviewNodeFor(
	repo: RepositoryNode,
	row: typeof pullRequestReviews.$inferSelect,
	ctx: GraphQLContext,
) {
	return {
		id: encodeNodeId("PullRequestReview", row.id),
		author: await userFor(ctx, row.authorId),
		authorAssociation: await association(repo, row.authorId),
		submittedAt: row.submittedAt ? isoTimestamp(row.submittedAt) : null,
		body: row.body ?? "",
		state: row.state.toUpperCase() as
			| "APPROVED"
			| "CHANGES_REQUESTED"
			| "COMMENTED"
			| "DISMISSED"
			| "PENDING",
		commit: row.commitSha
			? commitNode(
					repo,
					await getCommit(ownerKeyOf(repo.row), repo.name, row.commitSha),
				)
			: null,
		// Review reactions are not a stored feature; the supported reaction subjects are threads and comments.
		reactionGroups: groups({
			"+1": 0,
			"-1": 0,
			laugh: 0,
			hooray: 0,
			confused: 0,
			heart: 0,
			rocket: 0,
			eyes: 0,
		}),
	};
}

async function reviewNodes(
	node: PullRequestNode,
	ctx: GraphQLContext,
	offset: number,
	limit: number,
) {
	return ctx.memo(
		`pull-reviews:${node.row.id}:${offset}:${limit}`,
		async () => {
			const rows = await db.query.pullRequestReviews.findMany({
				where: { pullRequestId: node.row.id, state: { ne: "pending" } },
				offset,
				limit,
				with: { author: publicUserFields },
				orderBy: { createdAt: "asc", id: "asc" },
			});
			return Promise.all(rows.map((row) => reviewNodeFor(node.repo, row, ctx)));
		},
	);
}
export type CommentNode = Awaited<ReturnType<typeof commentNodes>>[number];
async function commentNodes(
	node: PullRequestNode,
	ctx: GraphQLContext,
	offset: number,
	limit: number,
) {
	const rows = await listCommentsForThread(threadRef(node), { offset, limit });
	assertTextBytes(rows);
	return Promise.all(
		rows.map(async (row) => ({
			id: encodeNodeId("IssueComment", row.id),
			author: await userFor(ctx, row.authorId),
			authorAssociation: await association(node.repo, row.authorId),
			body: row.body,
			createdAt: isoTimestamp(row.createdAt),
			includesCreatedEdit: row.editedAt !== null,
			isMinimized: false,
			minimizedReason: null,
			reactionGroups: await reactions(node, ctx, row.id),
			url: htmlUrl(
				`/${node.repo.nameWithOwner}/pull/${node.row.number}#issuecomment-${row.id}`,
			),
			viewerDidAuthor: row.authorId === ctx.caller.userId,
		})),
	);
}
export const pullDetailResolvers = {
	autoMergeRequest: () => null,
	maintainerCanModify: () => true,
	// GitHub's UNKNOWN describes a mergeability result that has not been computed.
	mergeable: () => "UNKNOWN" as const,
	additions: async (
		node: PullRequestNode,
		_args: unknown,
		ctx: GraphQLContext,
	) => (await diff(node, ctx)).totalAdditions,
	deletions: async (
		node: PullRequestNode,
		_args: unknown,
		ctx: GraphQLContext,
	) => (await diff(node, ctx)).totalDeletions,
	commits: async (
		node: PullRequestNode,
		args: ConnectionArgs,
		ctx: GraphQLContext,
	) => {
		const refs = range(node);
		const result = await ctx.memo(`pull-commits:${node.row.id}`, () =>
			getCommitInfosBetween(
				ownerKeyOf(node.repo.row),
				node.repo.name,
				refs.base,
				refs.head,
				MAX_HISTORY_WALK,
			),
		);
		if (result.truncated || result.incomplete)
			throw unprocessable(
				"Pull request commit history exceeds the supported limit",
			);
		return arrayConnection(
			args,
			result.commits.map((commit) => ({
				commit: commitNode(node.repo, commit),
			})),
		);
	},
	reviewRequests: async (
		node: PullRequestNode,
		args: ConnectionArgs,
		ctx: GraphQLContext,
	) =>
		arrayConnection(
			args,
			await Promise.all(
				(await listRequestedReviewers(node.row.id)).map(async (row) => ({
					requestedReviewer: await userFor(ctx, row.id),
				})),
			),
		),
	reviews: async (
		node: PullRequestNode,
		args: ConnectionArgs,
		ctx: GraphQLContext,
	) => {
		const [total] = await db
			.select({ total: count() })
			.from(pullRequestReviews)
			.where(
				and(
					eq(pullRequestReviews.pullRequestId, node.row.id),
					ne(pullRequestReviews.state, "pending"),
				),
			);
		if (!total) throw new Error("Review count query returned no row");
		return offsetConnection(args, total.total, async (offset, limit) => {
			bounds(offset);
			return reviewNodes(node, ctx, offset, limit);
		});
	},
	assignees: async (
		node: PullRequestNode,
		args: ConnectionArgs,
		ctx: GraphQLContext,
	) =>
		arrayConnection(
			args,
			await Promise.all(
				(await thread(node, ctx)).assignees.map((row) => userFor(ctx, row.id)),
			),
		),
	labels: async (
		node: PullRequestNode,
		args: ConnectionArgs,
		ctx: GraphQLContext,
	) =>
		arrayConnection(
			args,
			(await thread(node, ctx)).labels.map((row) => ({
				...row,
				id: encodeNodeId("Label", row.id),
			})),
		),
	milestone: async (
		node: PullRequestNode,
		_args: unknown,
		ctx: GraphQLContext,
	) => {
		const row = (await thread(node, ctx)).milestone;
		return row
			? {
					number: row.number,
					title: row.title,
					description: row.description,
					dueOn: row.dueOn ? isoTimestamp(row.dueOn) : null,
				}
			: null;
	},
	comments: async (
		node: PullRequestNode,
		args: ConnectionArgs,
		ctx: GraphQLContext,
	) =>
		offsetConnection(
			args,
			await countCommentsForThread(threadRef(node)),
			async (offset, limit) => {
				bounds(offset);
				return commentNodes(node, ctx, offset, limit);
			},
		),
	reactionGroups: (
		node: PullRequestNode,
		_args: unknown,
		ctx: GraphQLContext,
	) => reactions(node, ctx),
};

export interface RollupNode {
	repository: RepositoryNode;
	sha: string;
}
export const commitDetailResolvers = {
	statusCheckRollup: async (node: CommitNode) => {
		const [status, run] = await Promise.all([
			db.query.commitStatuses.findFirst({
				where: { repoId: node.repository.row.id, sha: node.oid },
				columns: { id: true },
			}),
			db.query.checkRuns.findFirst({
				where: { repoId: node.repository.row.id, headSha: node.oid },
				columns: { id: true },
			}),
		]);
		return status || run
			? { repository: node.repository, sha: node.oid }
			: null;
	},
};
export const detailTypeResolvers = {
	StatusCheckRollup: {
		contexts: async (node: RollupNode, args: ConnectionArgs) => {
			const [statuses, runs] = await Promise.all([
				db.query.commitStatuses.findMany({
					where: { repoId: node.repository.row.id, sha: node.sha },
					columns: {
						context: true,
						state: true,
						targetUrl: true,
						createdAt: true,
						description: true,
					},
					limit: MAX_HISTORY_WALK + 1,
					orderBy: { id: "desc" },
				}),
				db.query.checkRuns.findMany({
					where: { repoId: node.repository.row.id, headSha: node.sha },
					columns: {
						name: true,
						status: true,
						conclusion: true,
						startedAt: true,
						completedAt: true,
						detailsUrl: true,
					},
					limit: MAX_HISTORY_WALK + 1,
					orderBy: { id: "desc" },
				}),
			]);
			if (statuses.length > MAX_HISTORY_WALK || runs.length > MAX_HISTORY_WALK)
				throw unprocessable(
					"Commit status history exceeds the supported limit",
				);
			const contexts = new Map<
				string,
				{
					__typename: "StatusContext";
					context: string;
					state: "ERROR" | "FAILURE" | "PENDING" | "SUCCESS";
					targetUrl: string | null;
					createdAt: string;
					description: string | null;
				}
			>();
			for (const row of statuses)
				if (!contexts.has(row.context))
					contexts.set(row.context, {
						__typename: "StatusContext",
						context: row.context,
						state: row.state.toUpperCase() as
							| "ERROR"
							| "FAILURE"
							| "PENDING"
							| "SUCCESS",
						targetUrl: row.targetUrl,
						createdAt: isoTimestamp(row.createdAt),
						description: row.description,
					});
			const checks = new Map<
				string,
				{
					__typename: "CheckRun";
					name: string;
					checkSuite: { workflowRun: null };
					status: "QUEUED" | "IN_PROGRESS" | "COMPLETED";
					conclusion: Uppercase<
						NonNullable<(typeof runs)[number]["conclusion"]>
					> | null;
					startedAt: string | null;
					completedAt: string | null;
					detailsUrl: string | null;
				}
			>();
			for (const row of runs)
				if (!checks.has(row.name))
					checks.set(row.name, {
						__typename: "CheckRun",
						name: row.name,
						checkSuite: { workflowRun: null },
						status: row.status.toUpperCase() as
							| "QUEUED"
							| "IN_PROGRESS"
							| "COMPLETED",
						conclusion:
							(row.conclusion?.toUpperCase() as Uppercase<
								NonNullable<typeof row.conclusion>
							> | null) ?? null,
						startedAt: row.startedAt ? isoTimestamp(row.startedAt) : null,
						completedAt: row.completedAt ? isoTimestamp(row.completedAt) : null,
						detailsUrl: row.detailsUrl,
					});
			return arrayConnection<
				| (typeof contexts extends Map<string, infer T> ? T : never)
				| (typeof checks extends Map<string, infer T> ? T : never)
			>(args, [...contexts.values(), ...checks.values()]);
		},
	},
};
