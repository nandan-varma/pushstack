/** GitHub pull requests over the shared thread and pull request stores. */
import { db } from "#/db";
import {
	MAX_BODY_CHARS,
	MAX_LIST_SKIP,
	MAX_THREAD_TITLE_CHARS,
} from "#/lib/limits";
import { tokenAllows } from "#/lib/token-scopes";
import { htmlUrl, isoTimestamp } from "../../api/http";
import {
	requestCodeownerReviews,
	requestCodeownerReviewsFor,
} from "../../codeowners";
import { analyzeMerge, getCommitsBetween, getTags } from "../../git-read";
import { safeBranchNameSchema } from "../../git-ref-name";
import { ownerKeyOf } from "../../git-storage-naming";
import {
	insertPullRequest,
	setPullRequestDraft,
} from "../../pull-request-store";
import {
	findPullRequestById,
	findPullRequestByNumber,
	listThreads,
	type PullRequest,
	pullRequestView,
	type ThreadFilter,
} from "../../thread-store";
import { offsetConnection } from "../connection";
import type { GraphQLContext } from "../context";
import {
	forbidden,
	GitHubGraphQLError,
	notFound,
	unprocessable,
} from "../errors";
import { decodeNodeId, encodeNodeId, rowIdOfNodeKey } from "../node-id";
import { readCommitNode } from "./commit";
import { loadUser, userNode } from "./core";
import type {
	CreatePullRequestInput,
	RepositoryPullRequestsArgs,
} from "./generated";
import {
	commitDetailResolvers,
	detailTypeResolvers,
	pullDetailResolvers,
} from "./pulls-detail";
import { type RepositoryNode, readableRepositoryNode } from "./repository";
import type { DomainResolvers } from "./types";

export interface PullRequestNode {
	__typename: "PullRequest";
	id: string;
	databaseId: number;
	number: number;
	title: string;
	body: string;
	state: "OPEN" | "CLOSED" | "MERGED";
	isDraft: boolean;
	url: string;
	resourcePath: string;
	createdAt: string;
	updatedAt: string;
	closedAt: string | null;
	mergedAt: string | null;
	closed: boolean;
	merged: boolean;
	headRefName: string;
	baseRefName: string;
	isCrossRepository: false;
	row: PullRequest;
	repo: RepositoryNode;
}
function pullNode(repo: RepositoryNode, row: PullRequest): PullRequestNode {
	const path = `/${repo.nameWithOwner}/pull/${row.number}`;
	return {
		__typename: "PullRequest",
		id: encodeNodeId("PullRequest", row.id),
		databaseId: row.id,
		number: row.number,
		title: row.title,
		body: row.body ?? "",
		state:
			row.status === "open"
				? "OPEN"
				: row.status === "merged"
					? "MERGED"
					: "CLOSED",
		isDraft: row.isDraft,
		url: htmlUrl(path),
		resourcePath: path,
		createdAt: isoTimestamp(row.createdAt),
		updatedAt: isoTimestamp(row.updatedAt),
		closedAt: row.closedAt ? isoTimestamp(row.closedAt) : null,
		mergedAt: row.mergedAt ? isoTimestamp(row.mergedAt) : null,
		closed: row.status !== "open",
		merged: row.status === "merged",
		headRefName: row.sourceBranch,
		baseRefName: row.targetBranch,
		isCrossRepository: false,
		row,
		repo,
	};
}
const canWrite = (repo: RepositoryNode) =>
	["owner", "admin", "write"].includes(repo.role);
function requireScope(ctx: GraphQLContext) {
	if (!tokenAllows(ctx.caller.scopes, "repo:write"))
		throw new GitHubGraphQLError(
			"INSUFFICIENT_SCOPES",
			"Your token has not been granted the required scopes to execute this mutation.",
		);
}
async function repoById(id: string, ctx: GraphQLContext) {
	const decoded = decodeNodeId(id);
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
	if (!repo)
		throw notFound(`Could not resolve to a node with the global id of '${id}'`);
	return repo;
}
async function loadPull(key: string, ctx: GraphQLContext) {
	const id = rowIdOfNodeKey(key);
	const row = id === null ? null : await findPullRequestById(id);
	if (!row) return null;
	const repoRow = await db.query.repositories.findFirst({
		where: { id: row.repoId },
		with: { owner: true },
	});
	if (!repoRow) throw new Error("Pull request repository missing");
	const repo = await readableRepositoryNode(
		ctx,
		repoRow.owner.username,
		repoRow.name,
	);
	return repo ? pullNode(repo, row) : null;
}
async function createPull(input: CreatePullRequestInput, ctx: GraphQLContext) {
	requireScope(ctx);
	const repo = await repoById(input.repositoryId, ctx);
	if (!canWrite(repo))
		throw forbidden("You do not have permission to create pull requests");
	if (repo.row.archived) throw forbidden("Repository is archived");
	if (
		input.headRepositoryId != null &&
		(await repoById(input.headRepositoryId, ctx)).id !== repo.id
	)
		throw unprocessable("Cross-repository pull requests are not supported.");
	if (input.maintainerCanModify === false)
		throw unprocessable(
			"Disabling maintainer modifications is not supported for same-repository pull requests.",
		);
	const parts = input.headRefName.split(":");
	const head =
		parts.length === 2 &&
		parts[0]?.toLowerCase() === repo.row.owner.username.toLowerCase()
			? parts[1]
			: input.headRefName;
	const base = input.baseRefName;
	if (
		!safeBranchNameSchema.safeParse(head).success ||
		!safeBranchNameSchema.safeParse(base).success
	)
		throw unprocessable("Invalid branch name");
	if (!head) throw unprocessable("Invalid head branch");
	const title = input.title.trim();
	if (
		!title ||
		title.length > MAX_THREAD_TITLE_CHARS ||
		(input.body?.length ?? 0) > MAX_BODY_CHARS
	)
		throw unprocessable("Invalid pull request title or body");
	if (head === base)
		throw unprocessable(`No commits between ${base} and ${head}`);
	const duplicate = await listThreads(
		{ repoId: repo.row.id, kind: "pull_request", state: "open", head, base },
		{ limit: 1 },
	);
	if (duplicate.total)
		throw unprocessable(
			`A pull request already exists for ${repo.row.owner.username}:${head}.`,
		);
	const analysis = await analyzeMerge(
		ownerKeyOf(repo.row),
		repo.name,
		head,
		base,
	);
	if (!analysis.canMerge) throw unprocessable("Both branches must exist");
	const range = await getCommitsBetween(
		ownerKeyOf(repo.row),
		repo.name,
		base,
		head,
		1,
	);
	if (range.incomplete)
		throw unprocessable("Pull request history exceeds the supported limit");
	if (!range.commits.length)
		throw unprocessable(`No commits between ${base} and ${head}`);
	const row = await insertPullRequest(repo.row.id, ctx.caller.userId, {
		title,
		body: input.body ?? undefined,
		sourceBranch: head,
		targetBranch: base,
		draft: input.draft ?? false,
	});
	await requestCodeownerReviews(repo.row, row);
	return {
		clientMutationId: input.clientMutationId ?? null,
		pullRequest: pullNode(repo, row),
	};
}
async function draftState(
	input: { pullRequestId: string; clientMutationId?: string | null },
	ctx: GraphQLContext,
	draft: boolean,
) {
	requireScope(ctx);
	const decoded = decodeNodeId(input.pullRequestId);
	const node =
		decoded?.type === "PullRequest" ? await loadPull(decoded.key, ctx) : null;
	if (!node)
		throw notFound(
			`Could not resolve to a node with the global id of '${input.pullRequestId}'`,
		);
	if (node.row.authorId !== ctx.caller.userId && !canWrite(node.repo))
		throw forbidden("You do not have permission to update this pull request");
	if (node.repo.row.archived) throw forbidden("Repository is archived");
	if (node.row.status !== "open")
		throw unprocessable("Only an open pull request can change draft state");
	const row = await setPullRequestDraft(node.row, ctx.caller.userId, draft);
	if (!draft) await requestCodeownerReviewsFor(row);
	return {
		clientMutationId: input.clientMutationId ?? null,
		pullRequest: pullNode(
			node.repo,
			await findPullRequestById(row.id).then((updated) => {
				if (!updated)
					throw new Error("Pull request missing after draft transition");
				return updated;
			}),
		),
	};
}
async function pulls(repo: RepositoryNode, args: RepositoryPullRequestsArgs) {
	const states = args.states?.filter((s) => s != null);
	const filter: ThreadFilter = {
		repoId: repo.row.id,
		kind: "pull_request",
		head: args.headRefName ?? undefined,
		base: args.baseRefName ?? undefined,
		labels: args.labels?.filter((s): s is string => s != null),
		pullRequestStates: states,
	};
	const by = args.orderBy?.field;

	const sort = {
		by:
			by === "UPDATED_AT"
				? ("updated" as const)
				: by === "COMMENTS"
					? ("comments" as const)
					: ("created" as const),
		direction:
			args.orderBy?.direction === "ASC" ? ("asc" as const) : ("desc" as const),
	};
	const total = (await listThreads(filter, { limit: 1, sort })).total;
	return offsetConnection(args, total, async (offset, limit) => {
		if (offset > MAX_LIST_SKIP)
			throw unprocessable("Pagination offset exceeds the maximum");
		return (await listThreads(filter, { offset, limit, sort })).threads.map(
			(row) => pullNode(repo, pullRequestView(row)),
		);
	});
}
export const pullsResolvers: DomainResolvers = {
	types: {
		...detailTypeResolvers,
		Repository: {
			pullRequest: async (repo, args) => {
				const row = await findPullRequestByNumber(repo.row.id, args.number);
				if (!row)
					throw notFound(
						`Could not resolve to a PullRequest with the number of ${args.number}.`,
					);
				return pullNode(repo, row);
			},
			pullRequests: (repo, args) => pulls(repo, args),
		},
		PullRequest: {
			...pullDetailResolvers,
			author: async (node, _args, ctx) => {
				const row = await loadUser(ctx, node.row.authorId);
				if (!row) throw new Error("Pull request author missing");
				return userNode(row);
			},
			repository: (node) => node.repo,
			headRepository: (node) => node.repo,
			headRepositoryOwner: async (node, _args, ctx) => {
				const row = await loadUser(ctx, node.repo.row.ownerId);
				if (!row) throw new Error("Repository owner missing");
				return userNode(row);
			},
		},
		Mutation: {
			createPullRequest: (_source, args, ctx) => createPull(args.input, ctx),
			markPullRequestReadyForReview: (_source, args, ctx) =>
				draftState(args.input, ctx, false),
			convertPullRequestToDraft: (_source, args, ctx) =>
				draftState(args.input, ctx, true),
		},
		Release: {
			tagCommit: async (node, _args, ctx) => {
				const tags = await ctx.memo(`release-tags:${node.repo.row.id}`, () =>
					getTags(ownerKeyOf(node.repo.row), node.repo.name),
				);
				const tag = tags.find((tag) => tag.name === node.tagName);
				return tag ? readCommitNode(node.repo, tag.commit) : null;
			},
		},
		Commit: {
			...commitDetailResolvers,
			zipballUrl: (node) =>
				htmlUrl(`/${node.repository.nameWithOwner}/archive/${node.oid}.zip`),
			tarballUrl: (node) =>
				htmlUrl(`/${node.repository.nameWithOwner}/archive/${node.oid}.tar.gz`),
		},
	},
	nodes: { PullRequest: loadPull },
};
