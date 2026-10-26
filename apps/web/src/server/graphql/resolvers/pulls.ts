/** GitHub pull requests over the shared thread and pull request stores. */
import { db } from "#/db";
import {
	MAX_BODY_CHARS,
	MAX_COMMIT_MESSAGE_CHARS,
	MAX_LABELS_PER_THREAD,
	MAX_LIST_SKIP,
	MAX_THREAD_TITLE_CHARS,
} from "#/lib/limits";
import { tokenAllows } from "#/lib/token-scopes";
import { callerIdentity } from "../../api/auth";
import { htmlUrl, isoTimestamp } from "../../api/http";
import {
	requestCodeownerReviews,
	requestCodeownerReviewsFor,
} from "../../codeowners";
import {
	analyzeMerge,
	getBranches,
	getCommitsBetween,
	getTags,
} from "../../git-read";
import { safeBranchNameSchema } from "../../git-ref-name";
import { withRepositoryLock } from "../../git-repo-lock";
import { ownerKeyOf } from "../../git-storage-naming";
import {
	disallowedMergeMethodMessage,
	insertPullRequest,
	mergePullRequestBranches,
	setPullRequestDraft,
	updatePullRequestFields,
} from "../../pull-request-store";
import {
	ARCHIVED_MESSAGE,
	canMergePullRequest,
	canModerateRepo,
	canWriteRepo,
} from "../../repo-access";
import {
	findOrCreatePendingReview,
	reviewSummaryFor,
	submitPendingReview,
} from "../../review-store";
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
	AddPullRequestReviewInput,
	CreatePullRequestInput,
	MergePullRequestInput,
	RepositoryPullRequestsArgs,
	UpdatePullRequestInput,
} from "./generated";
import {
	commitDetailResolvers,
	detailTypeResolvers,
	pullDetailResolvers,
	reviewNodeFor,
} from "./pulls-detail";
import {
	branchRef,
	type RepositoryNode,
	readableRepositoryNode,
} from "./repository";
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
export function pullNode(
	repo: RepositoryNode,
	row: PullRequest,
): PullRequestNode {
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
	// Check-then-insert must be atomic per repository, or two concurrent
	// creates for the same head both pass the duplicate check.
	const row = await withRepositoryLock(
		ownerKeyOf(repo.row),
		repo.name,
		async () => {
			const duplicate = await listThreads(
				{
					repoId: repo.row.id,
					kind: "pull_request",
					state: "open",
					head,
					base,
				},
				{ limit: 1 },
			);
			if (duplicate.total)
				throw unprocessable(
					`A pull request already exists for ${repo.row.owner.username}:${head}.`,
				);
			return insertPullRequest(repo.row.id, ctx.caller.userId, {
				title,
				body: input.body ?? undefined,
				sourceBranch: head,
				targetBranch: base,
				draft: input.draft ?? false,
			});
		},
	);
	await requestCodeownerReviews(repo.row, row);
	return {
		clientMutationId: input.clientMutationId ?? null,
		pullRequest: pullNode(repo, row),
	};
}
/** The pull request a mutation names, with the repo:write scope checked. */
async function mutationPull(
	input: { pullRequestId: string },
	ctx: GraphQLContext,
) {
	requireScope(ctx);
	const decoded = decodeNodeId(input.pullRequestId);
	const node =
		decoded?.type === "PullRequest" ? await loadPull(decoded.key, ctx) : null;
	if (!node)
		throw notFound(
			`Could not resolve to a node with the global id of '${input.pullRequestId}'`,
		);
	return node;
}

/** The pull request a mutation may change: its author or a writer, in an unarchived repository. */
async function writablePull(
	input: { pullRequestId: string },
	ctx: GraphQLContext,
) {
	const node = await mutationPull(input, ctx);
	if (node.row.authorId !== ctx.caller.userId && !canWrite(node.repo))
		throw forbidden("You do not have permission to update this pull request");
	if (node.repo.row.archived) throw forbidden("Repository is archived");
	return node;
}

/** The caller, as the actor who performed a mutation. */
async function actorOf(_payload: unknown, _args: unknown, ctx: GraphQLContext) {
	const row = await loadUser(ctx, ctx.caller.userId);
	if (!row) throw new Error("Authenticated user missing");
	return userNode(row);
}

/** The pull request as it reads after a write, with its shared repository node. */
async function reloadedPull(
	node: PullRequestNode,
	clientMutationId?: string | null,
) {
	const row = await findPullRequestById(node.row.id);
	if (!row) throw new Error("Pull request missing after update");
	return {
		clientMutationId: clientMutationId ?? null,
		pullRequest: pullNode(node.repo, row),
	};
}

async function setPullStatus(
	input: { pullRequestId: string; clientMutationId?: string | null },
	ctx: GraphQLContext,
	status: "open" | "closed",
) {
	const node = await writablePull(input, ctx);
	// A merged pull request is CLOSED on GitHub: closing it is a no-op, reopening is refused.
	if (node.row.status === "merged") {
		if (status === "open")
			throw unprocessable("A merged pull request can't be reopened");
		return reloadedPull(node, input.clientMutationId);
	}
	if (node.row.status !== status)
		await updatePullRequestFields(node.row, ctx.caller.userId, { status });
	return reloadedPull(node, input.clientMutationId);
}

async function updatePull(input: UpdatePullRequestInput, ctx: GraphQLContext) {
	const node = await writablePull(input, ctx);
	if (input.baseRefName != null && input.baseRefName !== node.row.targetBranch)
		throw unprocessable("Changing the base branch is not supported");
	if (input.state === "OPEN" && node.row.status === "merged")
		throw unprocessable("A merged pull request can't be reopened");
	const title = input.title?.trim();
	if (title !== undefined && (!title || title.length > MAX_THREAD_TITLE_CHARS))
		throw unprocessable("Invalid pull request title");
	if ((input.body?.length ?? 0) > MAX_BODY_CHARS)
		throw unprocessable("Invalid pull request body");
	await updatePullRequestFields(node.row, ctx.caller.userId, {
		...(title !== undefined && { title }),
		...(input.body != null && { body: input.body }),
		...(input.state != null &&
			node.row.status !== "merged" && {
				status: input.state === "OPEN" ? "open" : "closed",
			}),
	});
	return reloadedPull(node, input.clientMutationId);
}

const MERGE_METHODS = {
	MERGE: "merge",
	SQUASH: "squash",
	REBASE: "rebase",
} as const;

/** `mergePullRequest`: the REST merge rules, with `mergeMethod` as REST's `merge_method`. */
async function mergePull(input: MergePullRequestInput, ctx: GraphQLContext) {
	const node = await mutationPull(input, ctx);
	if (node.repo.row.archived) throw forbidden("Repository is archived");
	if (!(await canMergePullRequest(node.repo.row.id, ctx.caller.userId)))
		throw forbidden("You do not have permission to merge this pull request");
	const method = MERGE_METHODS[input.mergeMethod ?? "MERGE"];
	const refusal = disallowedMergeMethodMessage(node.repo.row, method);
	if (refusal) throw unprocessable(refusal);
	// The REST contract's caps: the same message is the only persisted text here.
	if ((input.commitHeadline?.length ?? 0) > MAX_COMMIT_MESSAGE_CHARS)
		throw unprocessable(
			`Commit headline is too long (maximum is ${MAX_COMMIT_MESSAGE_CHARS} characters)`,
		);
	if ((input.commitBody?.length ?? 0) > MAX_COMMIT_MESSAGE_CHARS)
		throw unprocessable(
			`Commit body is too long (maximum is ${MAX_COMMIT_MESSAGE_CHARS} characters)`,
		);
	if (node.row.status === "open" && node.row.isDraft)
		throw unprocessable("Pull Request is still a draft");
	if (node.row.status !== "open")
		throw unprocessable("Pull Request is not mergeable");
	const headModified = () =>
		unprocessable("Head branch was modified. Review and try the merge again.");
	const expectedHeadOid = input.expectedHeadOid ?? undefined;
	// A fast path; the merge re-checks under the repository lock.
	if (expectedHeadOid) {
		const branches = await getBranches(
			ownerKeyOf(node.repo.row),
			node.repo.row.name,
		);
		const head = branches.find(
			(branch) => branch.name === node.row.sourceBranch,
		);
		if (head?.commit !== expectedHeadOid) throw headModified();
	}
	// GitHub blocks the merge while changes are requested; an owner/admin may override.
	if (
		(await reviewSummaryFor(node.row.id)).blocksMerge &&
		!(await canModerateRepo(node.repo.row.id, ctx.caller.userId))
	)
		throw unprocessable("Pull Request is not mergeable");

	const committer = await callerIdentity(ctx.caller);
	const result = await mergePullRequestBranches(
		node.repo.row,
		node.row,
		committer,
		{
			method,
			commitTitle: input.commitHeadline?.trim() || undefined,
			commitMessage: input.commitBody?.trim() || undefined,
			expectedHeadSha: expectedHeadOid,
		},
	);
	if (!result.success) {
		if (result.refusal) throw unprocessable(result.refusal);
		throw result.headModified
			? headModified()
			: unprocessable("Pull Request is not mergeable");
	}
	return reloadedPull(node, input.clientMutationId);
}

/**
 * `addPullRequestReview` with an event: submits the viewer's review in one
 * step, under `submitReview`'s rules. Pending (event-less) reviews and inline
 * comments are not served yet.
 */
async function addReview(
	input: AddPullRequestReviewInput,
	ctx: GraphQLContext,
) {
	const node = await mutationPull(input, ctx);
	const repoId = node.repo.row.id;
	const reviewer = ctx.caller.userId;
	// A reader who can see the pull request can always comment (participate),
	// so the only participate refusal is the archived one, checked here.
	if (node.repo.row.archived) throw forbidden(ARCHIVED_MESSAGE);
	if (!input.event)
		throw unprocessable(
			"A review needs an event; pending reviews are not supported yet",
		);
	if (input.event === "DISMISS")
		throw unprocessable("Reviews can't be dismissed by this mutation");
	if (input.event !== "COMMENT") {
		if (!(await canWriteRepo(repoId, reviewer)))
			throw forbidden("You need write access to approve or request changes");
		if (node.row.authorId === reviewer)
			throw unprocessable("You can't review your own pull request");
	}
	const body = input.body?.trim() ?? "";
	if (body.length > MAX_BODY_CHARS) throw unprocessable("Invalid review body");
	const state =
		input.event === "APPROVE"
			? "approved"
			: input.event === "REQUEST_CHANGES"
				? "changes_requested"
				: "commented";
	const review = await findOrCreatePendingReview(node.row, reviewer);
	const submitted = await submitPendingReview(
		node.repo.row,
		node.row,
		review,
		state,
		body || null,
	);
	return {
		clientMutationId: input.clientMutationId ?? null,
		pullRequestReview: await reviewNodeFor(node.repo, submitted, ctx),
	};
}

async function draftState(
	input: { pullRequestId: string; clientMutationId?: string | null },
	ctx: GraphQLContext,
	draft: boolean,
) {
	const node = await writablePull(input, ctx);
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
	const labels = args.labels?.filter((s): s is string => s != null);
	if (labels && labels.length > MAX_LABELS_PER_THREAD)
		throw unprocessable(
			`At most ${MAX_LABELS_PER_THREAD} labels can be filtered`,
		);
	const filter: ThreadFilter = {
		repoId: repo.row.id,
		kind: "pull_request",
		head: args.headRefName ?? undefined,
		base: args.baseRefName ?? undefined,
		labels,
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
			baseRef: (node, _args, ctx) =>
				branchRef(ctx, node.repo, node.row.targetBranch),
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
			closePullRequest: (_source, args, ctx) =>
				setPullStatus(args.input, ctx, "closed"),
			reopenPullRequest: (_source, args, ctx) =>
				setPullStatus(args.input, ctx, "open"),
			updatePullRequest: (_source, args, ctx) => updatePull(args.input, ctx),
			mergePullRequest: (_source, args, ctx) => mergePull(args.input, ctx),
			addPullRequestReview: (_source, args, ctx) => addReview(args.input, ctx),
		},
		UpdatePullRequestPayload: { actor: actorOf },
		MergePullRequestPayload: { actor: actorOf },
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
