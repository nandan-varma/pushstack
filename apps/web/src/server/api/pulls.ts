/**
 * GitHub's pull requests surface at `/api/v3`: list, get, create, update,
 * merge, files and commits. Pull requests share their `#N` (and their comments,
 * labels and timeline) with issues, so those live on the issues endpoints.
 */

import { and, count, eq, inArray, sql } from "drizzle-orm";
import { isNotFoundError } from "git-fs-s3";
import { DiffLimitError } from "git-fs-s3/ops";
import { db } from "#/db";
import { pullRequestReviewComments, pullRequestReviews } from "#/db/app-schema";
import { user } from "#/db/schema";
import { requestCodeownerReviews } from "../codeowners";
import { commitCommentCounts } from "../commit-comment-store";
import {
	getBranchDiff,
	getBranches,
	getCommit,
	getCommitDiff,
	getCommitsBetween,
	getRebaseable,
} from "../git-read";
import { repoFor } from "../git-repo";
import { ownerKeyOf } from "../git-storage-naming";
import { perfStep } from "../perf-log";
import {
	createPullRequest,
	PullCreateError,
	PullForbiddenError,
} from "../pull-create";
import {
	isCrossRepository,
	readableHeadRepository,
	refreshPullHead,
	tipOf,
} from "../pull-head";
import {
	disallowedMergeMethodMessage,
	mergePullRequestBranches,
	updatePullRequestFields,
} from "../pull-request-store";
import { readableForkCounts } from "../repository-fork";
import {
	publicUserColumns,
	type RepositoryRowWithOwner,
} from "../repository-lookup";
import {
	listRequestedReviewers,
	ReviewRequestError,
	removeReviewRequests,
	requestReviewers,
} from "../review-request-store";
import { reviewSummaryFor } from "../review-store";
import {
	findPullRequestByNumber,
	findThread,
	listThreads,
	type PullRequest,
	pullRequestOfThread,
	type Thread,
} from "../thread-store";
import { createTtlCoalescedCache } from "../ttl-cache";
import { type ApiContext, callerIdentity, requireScope } from "./auth";
import { apiCaps } from "./caps";
import { diffFileObjects, UNKNOWN_SHA } from "./diff-files";
import {
	ApiError,
	apiUrl,
	type FieldError,
	forbiddenError,
	json,
	linkHeader,
	mediaFormat,
	mediaResponse,
	noContent,
	notFoundError,
	pageParams,
	validationFailedError,
} from "./http";
import { pathParams, queryParams, requestBody } from "./input";
import { formatPatchSections, unifiedDiff, withinDiffCap } from "./patches";
import { readableRepository } from "./repo-lookup";
import { openIssueCounts, starCounts } from "./repos";
import {
	commitObject,
	pullRequest as pullRequestShape,
	repository,
	simpleUser,
} from "./serializers";
import { fullNameOf } from "./threads";

/** The Commits tab and `GET …/commits` are capped at 250, as on GitHub. */
const PULL_COMMITS_LIMIT = 250;
/** `GET …/files` lists at most 3000 files, as on GitHub. */
const PULL_FILES_LIMIT = 3000;
/**
 * Recent pull request diffs, keyed by the tips they compare. Entries are capped
 * by count, so a diff whose patches exceed this is served but not kept: four
 * pathological diffs must not pin hundreds of MB in a serverless instance.
 */
const DIFF_CACHE_MAX_PATCH_CHARS = 8 * 1024 * 1024;
const diffCache = createTtlCoalescedCache<
	Awaited<ReturnType<typeof getBranchDiff>>
>({
	ttlMs: 30_000,
	maxEntries: 4,
});
async function cachedDiff(
	key: string,
	compute: () => ReturnType<typeof getBranchDiff>,
) {
	const diff = await diffCache.get(key, compute);
	let patchChars = 0;
	for (const file of diff.files) {
		if (file.kind === "text") patchChars += file.patch?.length ?? 0;
	}
	if (patchChars > DIFF_CACHE_MAX_PATCH_CHARS) diffCache.delete(key);
	return diff;
}

const pullError = (field: string, code: FieldError["code"], message?: string) =>
	({
		resource: "PullRequest",
		field,
		code,
		...(message && { message }),
	}) as FieldError;

const customError = (message: string): FieldError => ({
	resource: "PullRequest",
	code: "custom",
	message,
});

/**
 * Every branch tip of the repository, plus the pinned head of each fork pull
 * request in `pulls` (keyed by its `headRef`), so a range resolves through
 * one map.
 */
async function branchTips(
	repo: RepositoryRowWithOwner,
	pulls: readonly PullRequest[] = [],
): Promise<Map<string, string>> {
	const branches = await getBranches(ownerKeyOf(repo), repo.name);
	const tips = new Map(branches.map((branch) => [branch.name, branch.commit]));
	const base = repoFor(ownerKeyOf(repo), repo.name);
	await Promise.all(
		pulls.filter(isCrossRepository).map(async (pr) => {
			const tip = await tipOf(base, pr.headRef);
			if (tip) tips.set(pr.headRef, tip);
		}),
	);
	return tips;
}

/**
 * Where each fork pull request's head lives, as `viewerId` may see it: the
 * owner (by login, so it outlives a deleted fork) and the repository, or null
 * when it is deleted or the viewer cannot read it.
 */
async function headSides(
	pulls: readonly PullRequest[],
	viewerId: string | null,
): Promise<
	Map<number, NonNullable<Parameters<typeof pullRequestShape>[0]["head"]>>
> {
	const cross = pulls.filter(isCrossRepository);
	const sides = new Map<
		number,
		NonNullable<Parameters<typeof pullRequestShape>[0]["head"]>
	>();
	if (cross.length === 0) return sides;
	const logins = [...new Set(cross.map((pr) => pr.headOwner as string))];
	const users = await db
		.select(publicUserColumns)
		.from(user)
		.where(inArray(user.username, logins));
	const byLogin = new Map(users.map((row) => [row.username, row]));
	const repos = new Map<number, RepositoryRowWithOwner | null>();
	for (const pr of cross) {
		if (pr.headRepoId !== null && !repos.has(pr.headRepoId)) {
			repos.set(pr.headRepoId, await readableHeadRepository(pr, viewerId));
		}
	}
	const readable = [...repos.values()].filter(
		(row): row is RepositoryRowWithOwner => row !== null,
	);
	const ids = readable.map((row) => row.id);
	const [stargazers, openIssues, forks] = await Promise.all([
		starCounts(ids),
		openIssueCounts(ids),
		readableForkCounts(ids, viewerId),
	]);
	for (const pr of cross) {
		const owner = byLogin.get(pr.headOwner as string);
		if (!owner) continue;
		const row = pr.headRepoId === null ? null : repos.get(pr.headRepoId);
		sides.set(pr.id, {
			user: owner,
			repoShape: row
				? repository(row, {
						stars: stargazers.get(row.id) ?? 0,
						openIssues: openIssues.get(row.id) ?? 0,
						forksCount: forks.get(row.id) ?? 0,
						role: undefined,
					})
				: null,
		});
	}
	return sides;
}

/**
 * The commit range a pull request shows. A merged one is pinned to the tips
 * recorded at merge time, so later pushes don't change it.
 */
function pullRange(pr: PullRequest): { base: string; head: string } {
	if (pr.status === "merged" && pr.baseSha && pr.headSha) {
		return { base: pr.baseSha, head: pr.headSha };
	}
	return { base: pr.targetBranch, head: pr.headRef };
}

function tipShas(pr: PullRequest, tips: Map<string, string>) {
	const range = pullRange(pr);
	return {
		baseSha: tips.get(range.base) ?? pr.baseSha ?? UNKNOWN_SHA,
		headSha: tips.get(range.head) ?? pr.headSha ?? UNKNOWN_SHA,
	};
}

/** Run a git read that yields `fallback` when a ref (a deleted branch) is gone. */
async function orWhenGone<T>(read: () => Promise<T>, fallback: T): Promise<T> {
	try {
		return await read();
	} catch (error) {
		if (isNotFoundError(error)) return fallback;
		throw error;
	}
}

function findPull(repoId: number, number: number): Promise<Thread | null> {
	return findThread(repoId, number, "pull_request");
}

function pullShapeOf(thread: Thread) {
	return {
		requestedReviewers: thread.requestedReviewers,
		row: pullRequestOfThread(thread),
		author: thread.author,
		labels: thread.labels,
		assignees: thread.assignees,
		milestone: thread.milestone,
		commentsCount: thread.commentsCount,
	};
}

async function serializeList(
	repo: RepositoryRowWithOwner,
	threads: Thread[],
	role: Parameters<typeof repository>[1]["role"],
	viewerId: string | null,
) {
	const shapes = threads.map(pullShapeOf);
	const rows = shapes.map((shape) => shape.row);
	const [tips, stargazers, openIssues, forks, heads] = await Promise.all([
		branchTips(repo, rows),
		starCounts([repo.id]),
		openIssueCounts([repo.id]),
		readableForkCounts([repo.id], viewerId),
		headSides(rows, viewerId),
	]);
	const repoShape = repository(repo, {
		stars: stargazers.get(repo.id) ?? 0,
		openIssues: openIssues.get(repo.id) ?? 0,
		forksCount: forks.get(repo.id) ?? 0,
		role,
	});
	return shapes.map((shape) =>
		pullRequestShape({
			repo,
			repoShape,
			...shape,
			...tipShas(shape.row, tips),
			head: heads.get(shape.row.id),
		}),
	);
}

async function serializeDetail(
	repo: RepositoryRowWithOwner,
	thread: Thread,
	role: Parameters<typeof repository>[1]["role"],
	viewerId: string | null,
) {
	const shape = pullShapeOf(thread);
	const { row } = shape;
	const ownerKey = ownerKeyOf(repo);
	const range = pullRange(row);
	const empty = {
		commits: { commits: [], truncated: false, incomplete: false },
		diff: { totalAdditions: 0, totalDeletions: 0, totalFiles: 0 },
	};
	const [
		tips,
		stargazers,
		openIssues,
		forks,
		reviewComments,
		commits,
		diff,
		heads,
		rebaseable,
	] = await perfStep("pull detail", () =>
		Promise.all([
			branchTips(repo, [row]),
			starCounts([repo.id]),
			openIssueCounts([repo.id]),
			readableForkCounts([repo.id], viewerId),
			db
				.select({ total: count() })
				.from(pullRequestReviewComments)
				.innerJoin(
					pullRequestReviews,
					eq(pullRequestReviews.id, pullRequestReviewComments.reviewId),
				)
				.where(
					and(
						eq(pullRequestReviewComments.pullRequestId, row.id),
						sql`${pullRequestReviews.state} <> 'pending'`,
					),
				)
				.then(([found]) => found?.total ?? 0),
			orWhenGone(
				() =>
					getCommitsBetween(
						ownerKey,
						repo.name,
						range.base,
						range.head,
						PULL_COMMITS_LIMIT,
					),
				empty.commits,
			),
			orWhenGone(
				() => getBranchDiff(ownerKey, repo.name, range.base, range.head),
				empty.diff,
			),
			headSides([row], viewerId),
			// Only an open pull request can be rebase-merged; a closed or
			// merged one is not computed, as GitHub leaves it unknown.
			row.status === "open"
				? orWhenGone(
						() => getRebaseable(ownerKey, repo.name, range.head, range.base),
						null,
					)
				: null,
		]),
	);
	const repoShape = repository(repo, {
		stars: stargazers.get(repo.id) ?? 0,
		openIssues: openIssues.get(repo.id) ?? 0,
		forksCount: forks.get(repo.id) ?? 0,
		role,
	});
	return pullRequestShape({
		repo,
		repoShape,
		...shape,
		...tipShas(row, tips),
		head: heads.get(row.id),
		detail: {
			mergedBy: thread.pullRequest?.mergedByUser ?? null,
			reviewComments,
			commits: commits.commits.length,
			additions: diff.totalAdditions,
			deletions: diff.totalDeletions,
			changedFiles: diff.totalFiles,
			rebaseable,
		},
	});
}

/**
 * The `head` query filter: `branch` or `owner:branch`. An owner other than the
 * repository's names a fork.
 */
function branchFilter(
	raw: string | undefined,
	ownerUsername: string,
): { head?: string; headOwner?: string } {
	if (!raw) return {};
	const colon = raw.indexOf(":");
	if (colon === -1) return { head: raw };
	const owner = raw.slice(0, colon);
	const head = raw.slice(colon + 1);
	return owner.toLowerCase() === ownerUsername.toLowerCase()
		? { head }
		: { head, headOwner: owner };
}

export async function listPulls(ctx: ApiContext) {
	const { repo, access } = await readableRepository(ctx);
	const params = pageParams(ctx.url.searchParams);
	const query = queryParams(ctx, "pulls/list", "PullRequest");
	const { state, sort } = query;
	// GitHub: desc for `created` (and no sort), asc for the others.
	const direction = query.direction ?? (sort === "created" ? "desc" : "asc");
	if (!params.reachable) return json([], 200, {});

	const head = branchFilter(query.head, repo.owner.username);
	const base = query.base || undefined;
	const { threads, total } = await perfStep("db: list pulls", () =>
		listThreads(
			{
				repoId: repo.id,
				kind: "pull_request",
				...(state !== "all" && { state }),
				...head,
				base,
			},
			{
				sort: {
					by:
						sort === "updated"
							? "updated"
							: sort === "popularity"
								? "comments"
								: "created",
					direction,
				},
				limit: params.perPage,
				offset: params.offset,
			},
		),
	);
	const role = ctx.caller ? access.role : undefined;
	return json(
		await serializeList(repo, threads, role, ctx.caller?.userId ?? null),
		200,
		linkHeader(ctx.url, params, total),
	);
}

const PULL_MEDIA_TEXT = "text/plain; charset=utf-8" as const;

/**
 * `GET /repos/{owner}/{repo}/pulls/{n}` with `Accept: application/vnd.github.diff`
 * (the unified diff, base to head) or `.patch` (one format-patch section per
 * commit), as GitHub answers them. Both are bounded by `apiCaps.diffMediaBytes`
 * and streamed; past the bound GitHub's 406 applies.
 */
async function pullMediaResponse(
	repo: RepositoryRowWithOwner,
	pr: PullRequest,
	format: "diff" | "patch",
): Promise<Response> {
	const ownerKey = ownerKeyOf(repo);
	await refreshPullHead(repo, pr);
	const { baseSha, headSha } = tipShas(pr, await branchTips(repo, [pr]));
	if (baseSha === UNKNOWN_SHA || headSha === UNKNOWN_SHA) throw notFoundError();
	if (format === "diff") {
		const diff = await cachedDiff(`${repo.id}:${baseSha}..${headSha}`, () =>
			getBranchDiff(ownerKey, repo.name, baseSha, headSha),
		);
		return mediaResponse(
			withinDiffCap(unifiedDiff(diff)),
			format,
			PULL_MEDIA_TEXT,
		);
	}
	const { commits } = await getCommitsBetween(
		ownerKey,
		repo.name,
		baseSha,
		headSha,
		PULL_COMMITS_LIMIT,
	);
	const sections: string[] = [];
	let bytes = 0;
	for (const [index, commit] of commits.entries()) {
		const [info, commitDiff] = await Promise.all([
			getCommit(ownerKey, repo.name, commit.sha),
			getCommitDiff(ownerKey, repo.name, commit.sha),
		]);
		for (const section of formatPatchSections(
			info,
			commitDiff,
			index,
			commits.length,
		)) {
			bytes += new TextEncoder().encode(section).byteLength;
			if (bytes > apiCaps.diffMediaBytes) {
				throw new DiffLimitError("bytes", apiCaps.diffMediaBytes);
			}
			sections.push(section);
		}
	}
	return mediaResponse(sections.join(""), format, PULL_MEDIA_TEXT);
}

export async function getPull(ctx: ApiContext) {
	const { repo, access } = await readableRepository(ctx);
	const { pull_number } = pathParams(ctx, "pulls/get");
	const format = mediaFormat(ctx.request);
	if (format === "diff" || format === "patch") {
		const pr = await findPullRequestByNumber(repo.id, pull_number);
		if (!pr) throw notFoundError();
		return pullMediaResponse(repo, pr, format);
	}
	const record = await findPull(repo.id, pull_number);
	if (!record) throw notFoundError();
	await refreshPullHead(repo, pullRequestOfThread(record));
	return json(
		await serializeDetail(
			repo,
			record,
			ctx.caller ? access.role : undefined,
			ctx.caller?.userId ?? null,
		),
	);
}

export async function createPull(ctx: ApiContext) {
	const caller = requireScope(ctx, "repo:write");
	const { repo, access } = await readableRepository(ctx);
	if (!access.canParticipate) {
		throw forbiddenError("You do not have permission to create pull requests");
	}
	const data = await requestBody(ctx, "pulls/create", "PullRequest");
	// `head` is `branch` or `owner:branch`; another owner names a fork.
	const colon = data.head.indexOf(":");
	let created: PullRequest;
	try {
		created = await createPullRequest({
			repo,
			userId: caller.userId,
			canWrite: access.canWrite,
			title: data.title,
			body: data.body ?? undefined,
			draft: data.draft ?? false,
			base: data.base,
			head: {
				owner: colon === -1 ? null : data.head.slice(0, colon),
				branch: colon === -1 ? data.head : data.head.slice(colon + 1),
				repoName: data.head_repo,
			},
		});
	} catch (error) {
		if (error instanceof PullForbiddenError)
			throw forbiddenError(error.message);
		if (!(error instanceof PullCreateError)) throw error;
		throw validationFailedError("Validation Failed", [
			error.field
				? pullError(error.field, "invalid")
				: customError(error.message),
		]);
	}
	await requestCodeownerReviews(repo, created);
	const record = await findPull(repo.id, created.number);
	if (!record) throw new Error("Pull request missing after insert");
	return json(
		await serializeDetail(
			repo,
			record,
			access.role,
			ctx.caller?.userId ?? null,
		),
		201,
		{
			Location: apiUrl(`/repos/${fullNameOf(repo)}/pulls/${created.number}`),
		},
	);
}

export async function updatePull(ctx: ApiContext) {
	const caller = requireScope(ctx, "repo:write");
	const { repo, access } = await readableRepository(ctx);
	const pr = await findPullRequestByNumber(
		repo.id,
		pathParams(ctx, "pulls/update").pull_number,
	);
	if (!pr) throw notFoundError();
	if (pr.authorId !== caller.userId && !access.canWrite) {
		throw forbiddenError(
			"You do not have permission to edit this pull request",
		);
	}
	const data = await requestBody(ctx, "pulls/update", "PullRequest");
	if (data.base !== undefined && data.base !== pr.targetBranch) {
		throw validationFailedError("Validation Failed", [
			customError("Changing the base branch is not supported"),
		]);
	}
	// A merged pull request is `closed` on GitHub, so closing it is a no-op;
	// reopening it is refused.
	if (pr.status === "merged" && data.state === "open") {
		throw validationFailedError("Validation Failed", [
			customError("A merged pull request can't be reopened"),
		]);
	}
	await updatePullRequestFields(pr, caller.userId, {
		...(data.title !== undefined && { title: data.title }),
		...(data.body !== undefined && { body: data.body ?? "" }),
		...(data.state !== undefined &&
			pr.status !== "merged" && { status: data.state }),
	});
	const updated = await findPull(repo.id, pr.number);
	if (!updated) throw new Error("Pull request missing after update");
	return json(
		await serializeDetail(
			repo,
			updated,
			ctx.caller ? access.role : undefined,
			ctx.caller?.userId ?? null,
		),
	);
}

const notMergeable = () => new ApiError(405, "Pull Request is not mergeable");

/** `GET /repos/{owner}/{repo}/pulls/{number}/merge`: 204 once merged, else 404. */
export async function checkPullMerged(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const pr = await findPullRequestByNumber(
		repo.id,
		pathParams(ctx, "pulls/check-if-merged").pull_number,
	);
	if (pr?.status !== "merged") throw notFoundError();
	return noContent();
}

export async function mergePull(ctx: ApiContext) {
	const caller = requireScope(ctx, "repo:write");
	const { repo, access } = await readableRepository(ctx);
	const pr = await findPullRequestByNumber(
		repo.id,
		pathParams(ctx, "pulls/merge").pull_number,
	);
	if (!pr) throw notFoundError();
	if (!access.canMergePullRequest) {
		throw forbiddenError(
			"You do not have permission to merge this pull request",
		);
	}
	const data = await requestBody(ctx, "pulls/merge", "PullRequest", {
		allowEmpty: true,
	});
	const method = data.merge_method ?? "merge";
	const refusal = disallowedMergeMethodMessage(repo, method);
	if (refusal) throw new ApiError(405, refusal);
	if (pr.status === "open" && pr.isDraft) {
		throw new ApiError(405, "Pull Request is still a draft");
	}
	if (pr.status !== "open") throw notMergeable();
	const headModified = () =>
		new ApiError(
			409,
			"Head branch was modified. Review and try the merge again.",
		);
	// A merge always starts from the fork branch's current tip.
	await refreshPullHead(repo, pr);
	// A fast path; the merge re-checks under the repository lock.
	if (data.sha && (await branchTips(repo, [pr])).get(pr.headRef) !== data.sha) {
		throw headModified();
	}
	// GitHub blocks the merge while changes are requested; an owner/admin may override.
	if ((await reviewSummaryFor(pr.id)).blocksMerge && !access.canModerate) {
		throw notMergeable();
	}

	const committer = await callerIdentity(caller);
	const result = await mergePullRequestBranches(repo, pr, committer, {
		method,
		commitTitle: data.commit_title?.trim() || undefined,
		commitMessage: data.commit_message?.trim() || undefined,
		expectedHeadSha: data.sha ?? undefined,
	});
	if (!result.success) {
		if (result.refusal) throw new ApiError(405, result.refusal);
		throw result.headModified ? headModified() : notMergeable();
	}
	return json({
		sha: result.commitSha,
		merged: true,
		message: "Pull Request successfully merged",
	});
}

export async function listPullCommits(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const pr = await findPullRequestByNumber(
		repo.id,
		pathParams(ctx, "pulls/list-commits").pull_number,
	);
	if (!pr) throw notFoundError();
	await refreshPullHead(repo, pr);
	const params = pageParams(ctx.url.searchParams);
	const range = pullRange(pr);
	const ownerKey = ownerKeyOf(repo);
	const { commits } = await orWhenGone(
		() =>
			getCommitsBetween(
				ownerKey,
				repo.name,
				range.base,
				range.head,
				PULL_COMMITS_LIMIT,
			),
		{ commits: [], truncated: false, incomplete: false },
	);
	const page = params.reachable
		? commits.slice(params.offset, params.offset + params.perPage)
		: [];
	const infos = await Promise.all(
		page.map((commit) => getCommit(ownerKey, repo.name, commit.sha)),
	);
	const counts = await commitCommentCounts(
		repo.id,
		infos.map((info) => info.oid),
	);
	return json(
		infos.map((info) =>
			commitObject(
				{ id: repo.id, fullName: fullNameOf(repo) },
				info,
				counts.get(info.oid),
			),
		),
		200,
		linkHeader(ctx.url, params, commits.length),
	);
}

export async function listPullFiles(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const pr = await findPullRequestByNumber(
		repo.id,
		pathParams(ctx, "pulls/list-files").pull_number,
	);
	if (!pr) throw notFoundError();
	const params = pageParams(ctx.url.searchParams);
	const ownerKey = ownerKeyOf(repo);
	const fullName = fullNameOf(repo);
	// Pin the diff to the tips so every page of one listing reads one result,
	// kept briefly: the diff (patches included) is computed whole.
	await refreshPullHead(repo, pr);
	const { baseSha, headSha } = tipShas(pr, await branchTips(repo, [pr]));
	const known = baseSha !== UNKNOWN_SHA && headSha !== UNKNOWN_SHA;
	const diff = known
		? await cachedDiff(`${repo.id}:${baseSha}..${headSha}`, () =>
				getBranchDiff(ownerKey, repo.name, baseSha, headSha),
			)
		: null;
	const files = (diff?.files ?? []).slice(0, PULL_FILES_LIMIT);
	const page = params.reachable
		? files.slice(params.offset, params.offset + params.perPage)
		: [];
	const body = await diffFileObjects(ownerKey, repo.name, fullName, diff, page);
	return json(body, 200, linkHeader(ctx.url, params, files.length));
}

/** GitHub answers review-request writes with the pull request's simple shape. */
async function serializeSimple(
	repo: RepositoryRowWithOwner,
	number: number,
	access: { role: Parameters<typeof repository>[1]["role"] },
	ctx: ApiContext,
) {
	const fresh = await findPull(repo.id, number);
	if (!fresh) throw notFoundError();
	const [shape] = await serializeList(
		repo,
		[fresh],
		ctx.caller ? access.role : undefined,
		ctx.caller?.userId ?? null,
	);
	return shape;
}

export async function listPullRequestedReviewers(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const { pull_number } = pathParams(ctx, "pulls/list-requested-reviewers");
	const record = await findPull(repo.id, pull_number);
	if (!record) throw notFoundError();
	const users = await listRequestedReviewers(record.id);
	return json({ users: users.map(simpleUser), teams: [] });
}

/** Shared by request and remove: the pull request, once the caller may manage its reviewers. */
async function pullForReviewerChange(
	ctx: ApiContext,
	operation: "pulls/request-reviewers" | "pulls/remove-requested-reviewers",
) {
	const caller = requireScope(ctx, "repo:write");
	const { repo, access } = await readableRepository(ctx);
	const { pull_number } = pathParams(ctx, operation);
	const record = await findPull(repo.id, pull_number);
	if (!record) throw notFoundError();
	if (record.authorId !== caller.userId && !access.canWrite) {
		throw forbiddenError(
			"You do not have permission to manage review requests on this pull request",
		);
	}
	return { caller, repo, access, record };
}

/** GitHub's wording for a request naming a team: teams don't exist here yet. */
function refuseTeams(
	repo: RepositoryRowWithOwner,
	teams: string[] | undefined,
) {
	if (teams && teams.length > 0) {
		throw validationFailedError(
			`Reviews may only be requested from collaborators. One or more of the users or teams you specified is not a collaborator of the ${fullNameOf(repo)} repository.`,
			[],
		);
	}
}

function reviewerError(error: unknown): never {
	if (error instanceof ReviewRequestError) {
		throw validationFailedError(error.message, []);
	}
	throw error;
}

export async function requestPullReviewers(ctx: ApiContext) {
	const { caller, repo, access, record } = await pullForReviewerChange(
		ctx,
		"pulls/request-reviewers",
	);
	const data = await requestBody(ctx, "pulls/request-reviewers", "PullRequest");
	refuseTeams(repo, data.team_reviewers);
	const reviewers = data.reviewers ?? [];
	if (reviewers.length === 0) {
		throw validationFailedError("Validation Failed", [
			customError("Must provide at least one of reviewers or team_reviewers"),
		]);
	}
	await requestReviewers(record, reviewers, caller.userId).catch(reviewerError);
	return json(await serializeSimple(repo, record.number, access, ctx), 201);
}

export async function removePullRequestedReviewers(ctx: ApiContext) {
	const { caller, repo, access, record } = await pullForReviewerChange(
		ctx,
		"pulls/remove-requested-reviewers",
	);
	const data = await requestBody(
		ctx,
		"pulls/remove-requested-reviewers",
		"PullRequest",
	);
	refuseTeams(repo, data.team_reviewers);
	await removeReviewRequests(record, data.reviewers, caller.userId).catch(
		reviewerError,
	);
	return json(await serializeSimple(repo, record.number, access, ctx));
}
