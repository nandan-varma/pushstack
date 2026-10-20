/**
 * GitHub's pull requests surface at `/api/v3`: list, get, create, update,
 * merge, files and commits. Pull requests share their `#N` (and their comments,
 * labels and timeline) with issues, so those live on the issues endpoints.
 */
import { and, count, eq, sql } from "drizzle-orm";
import { isNotFoundError } from "git-fs-s3";
import { z } from "zod";
import { db } from "#/db";
import { pullRequestReviewComments, pullRequestReviews } from "#/db/app-schema";
import { user } from "#/db/schema";
import {
	MAX_BODY_CHARS,
	MAX_COMMIT_MESSAGE_CHARS,
	MAX_THREAD_TITLE_CHARS,
} from "#/lib/limits";
import {
	analyzeMerge,
	getBranchDiff,
	getBranches,
	getCommit,
	getCommitsBetween,
} from "../git-read";
import { safeBranchNameSchema } from "../git-ref-name";
import { ownerKeyOf } from "../git-storage-naming";
import { perfStep } from "../perf-log";
import {
	insertPullRequest,
	mergePullRequestBranches,
	updatePullRequestFields,
} from "../pull-request-store";
import type { RepositoryRowWithOwner } from "../repository-lookup";
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
import { type ApiContext, requireScope } from "./auth";
import { diffFileObjects, UNKNOWN_SHA } from "./diff-files";
import {
	ApiError,
	apiUrl,
	type FieldError,
	forbiddenError,
	json,
	linkHeader,
	noContent,
	notFoundError,
	pageParams,
	readJsonObject,
	validationFailedError,
} from "./http";
import { readableRepository } from "./repo-lookup";
import { starCounts } from "./repos";
import {
	commitObject,
	pullRequest as pullRequestShape,
	repository,
} from "./serializers";
import { fullNameOf, threadNumber } from "./threads";

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

const stateSchema = z.enum(["open", "closed", "all"]);
const sortSchema = z
	.enum(["created", "updated", "popularity", "long-running"])
	.catch("created");
const directionSchema = z.enum(["asc", "desc"]);

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

/** Branch name → tip sha, for `head.sha` / `base.sha` of open and closed pulls. */
async function branchTips(
	repo: RepositoryRowWithOwner,
): Promise<Map<string, string>> {
	const branches = await getBranches(ownerKeyOf(repo), repo.name);
	return new Map(branches.map((branch) => [branch.name, branch.commit]));
}

/**
 * The commit range a pull request shows. A merged one is pinned to the tips
 * recorded at merge time, so later pushes don't change it.
 */
function pullRange(pr: PullRequest): { base: string; head: string } {
	if (pr.status === "merged" && pr.baseSha && pr.headSha) {
		return { base: pr.baseSha, head: pr.headSha };
	}
	return { base: pr.targetBranch, head: pr.sourceBranch };
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

/** Pull request `#number` with its labels, assignees and counts, or null. */
function findPull(repoId: number, number: number): Promise<Thread | null> {
	return findThread(repoId, number, "pull_request");
}

/** The serializer input every pull request shape shares. */
function pullShapeOf(thread: Thread) {
	return {
		row: pullRequestOfThread(thread),
		author: thread.author,
		labels: thread.labels,
		assignees: thread.assignees,
		commentsCount: thread.commentsCount,
	};
}

/** Serialize pull requests as list items (no per-pull git work beyond the tips). */
async function serializeList(
	repo: RepositoryRowWithOwner,
	threads: Thread[],
	role: Parameters<typeof repository>[1]["role"],
) {
	const [tips, stargazers] = await Promise.all([
		branchTips(repo),
		starCounts([repo.id]),
	]);
	const repoShape = repository(repo, {
		stars: stargazers.get(repo.id) ?? 0,
		role,
	});
	return threads.map((thread) => {
		const shape = pullShapeOf(thread);
		return pullRequestShape({
			repo,
			repoShape,
			...shape,
			...tipShas(shape.row, tips),
		});
	});
}

/** A single pull request, with the counts GitHub adds to it. */
async function serializeDetail(
	repo: RepositoryRowWithOwner,
	thread: Thread,
	role: Parameters<typeof repository>[1]["role"],
) {
	const shape = pullShapeOf(thread);
	const { row } = shape;
	const ownerKey = ownerKeyOf(repo);
	const range = pullRange(row);
	const empty = {
		commits: { commits: [], truncated: false, incomplete: false },
		diff: { totalAdditions: 0, totalDeletions: 0, totalFiles: 0 },
	};
	const [tips, stargazers, reviewComments, commits, diff] = await perfStep(
		"pull detail",
		() =>
			Promise.all([
				branchTips(repo),
				starCounts([repo.id]),
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
			]),
	);
	const repoShape = repository(repo, {
		stars: stargazers.get(repo.id) ?? 0,
		role,
	});
	return pullRequestShape({
		repo,
		repoShape,
		...shape,
		...tipShas(row, tips),
		detail: {
			mergedBy: thread.pullRequest?.mergedByUser ?? null,
			reviewComments,
			commits: commits.commits.length,
			additions: diff.totalAdditions,
			deletions: diff.totalDeletions,
			changedFiles: diff.totalFiles,
		},
	});
}

/** The `head` / `base` query filter: `branch` or `owner:branch`. */
function branchFilter(
	raw: string | null,
	ownerUsername: string,
): string | null | undefined {
	if (!raw) return undefined;
	const colon = raw.indexOf(":");
	if (colon === -1) return raw;
	// There are no forks: a head from anyone else matches nothing.
	return raw.slice(0, colon).toLowerCase() === ownerUsername.toLowerCase()
		? raw.slice(colon + 1)
		: null;
}

/** `GET /repos/{owner}/{repo}/pulls` */
export async function listPulls(ctx: ApiContext) {
	const { repo, access } = await readableRepository(ctx);
	const query = ctx.url.searchParams;
	const params = pageParams(query);
	const rawState = query.get("state") ?? "open";
	const state = stateSchema.safeParse(rawState);
	if (!state.success) {
		throw validationFailedError("Validation Failed", [
			{
				resource: "PullRequest",
				field: "state",
				code: "invalid",
				value: rawState,
			},
		]);
	}
	const sort = sortSchema.parse(query.get("sort") ?? undefined);
	// GitHub: desc for `created` (and no sort), asc for the others.
	const direction =
		directionSchema.safeParse(query.get("direction") ?? undefined).data ??
		(sort === "created" ? "desc" : "asc");
	if (!params.reachable) return json([], 200, {});

	const head = branchFilter(query.get("head"), repo.owner.username);
	const base = query.get("base") || undefined;
	const { threads, total } = await perfStep("db: list pulls", () =>
		listThreads(
			{
				repoId: repo.id,
				kind: "pull_request",
				...(state.data !== "all" && { state: state.data }),
				head,
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
		await serializeList(repo, threads, role),
		200,
		linkHeader(ctx.url, params, total),
	);
}

/** `GET /repos/{owner}/{repo}/pulls/{number}` */
export async function getPull(ctx: ApiContext) {
	const { repo, access } = await readableRepository(ctx);
	const record = await findPull(repo.id, threadNumber(ctx.params.number));
	if (!record) throw notFoundError();
	return json(
		await serializeDetail(repo, record, ctx.caller ? access.role : undefined),
	);
}

const createSchema = z.object({
	title: z.string().trim().min(1).max(MAX_THREAD_TITLE_CHARS),
	body: z.string().max(MAX_BODY_CHARS).nullish(),
	head: z.string().min(1).max(300),
	base: z.string().min(1).max(300),
});

const updateSchema = z.object({
	title: z.string().trim().min(1).max(MAX_THREAD_TITLE_CHARS).optional(),
	body: z.string().max(MAX_BODY_CHARS).nullish(),
	state: z.enum(["open", "closed"]).optional(),
	base: z.string().min(1).max(300).optional(),
});

/** GitHub's `errors[]` for a failed pull request body parse. */
function bodyErrors(
	error: z.ZodError,
	body: Record<string, unknown>,
): FieldError[] {
	return error.issues.map((issue) => {
		const field = String(issue.path[0] ?? "");
		return pullError(
			field,
			body[field] === undefined ? "missing_field" : "invalid",
		);
	});
}

/** `POST /repos/{owner}/{repo}/pulls` */
export async function createPull(ctx: ApiContext) {
	const caller = requireScope(ctx, "repo:write");
	const { repo, access } = await readableRepository(ctx);
	if (!access.canWrite) {
		throw forbiddenError("You do not have permission to create pull requests");
	}
	const body = await readJsonObject(ctx.request);
	const parsed = createSchema.safeParse(body);
	if (!parsed.success) {
		throw validationFailedError(
			"Validation Failed",
			bodyErrors(parsed.error, body),
		);
	}
	const data = parsed.data;
	// `head` is `branch` or `owner:branch`; there are no forks, so the owner
	// can only be this repository's.
	const colon = data.head.indexOf(":");
	const headOwner = colon === -1 ? null : data.head.slice(0, colon);
	const sourceBranch = colon === -1 ? data.head : data.head.slice(colon + 1);
	const targetBranch = data.base;
	const errors: FieldError[] = [];
	if (
		(headOwner !== null &&
			headOwner.toLowerCase() !== repo.owner.username.toLowerCase()) ||
		!safeBranchNameSchema.safeParse(sourceBranch).success
	) {
		errors.push(pullError("head", "invalid"));
	}
	if (!safeBranchNameSchema.safeParse(targetBranch).success) {
		errors.push(pullError("base", "invalid"));
	}
	if (errors.length > 0) {
		throw validationFailedError("Validation Failed", errors);
	}
	const tips = await branchTips(repo);
	if (!tips.has(sourceBranch)) errors.push(pullError("head", "invalid"));
	if (!tips.has(targetBranch)) errors.push(pullError("base", "invalid"));
	if (errors.length > 0) {
		throw validationFailedError("Validation Failed", errors);
	}
	if (sourceBranch === targetBranch) {
		throw validationFailedError("Validation Failed", [
			customError(`No commits between ${targetBranch} and ${sourceBranch}`),
		]);
	}
	const duplicate = await listThreads(
		{
			repoId: repo.id,
			kind: "pull_request",
			state: "open",
			head: sourceBranch,
			base: targetBranch,
		},
		{ limit: 1 },
	);
	if (duplicate.total > 0) {
		throw validationFailedError("Validation Failed", [
			customError(
				`A pull request already exists for ${repo.owner.username}:${sourceBranch}.`,
			),
		]);
	}
	// Same check the web UI makes before opening one.
	const { canMerge } = await analyzeMerge(
		ownerKeyOf(repo),
		repo.name,
		sourceBranch,
		targetBranch,
	);
	if (!canMerge) {
		throw validationFailedError("Validation Failed", [
			pullError("head", "invalid"),
		]);
	}

	const created = await insertPullRequest(repo.id, caller.userId, {
		title: data.title,
		body: data.body ?? undefined,
		sourceBranch,
		targetBranch,
	});
	const record = await findPull(repo.id, created.number);
	if (!record) throw new Error("Pull request missing after insert");
	return json(await serializeDetail(repo, record, access.role), 201, {
		Location: apiUrl(`/repos/${fullNameOf(repo)}/pulls/${created.number}`),
	});
}

/** `PATCH /repos/{owner}/{repo}/pulls/{number}` */
export async function updatePull(ctx: ApiContext) {
	const caller = requireScope(ctx, "repo:write");
	const { repo, access } = await readableRepository(ctx);
	const pr = await findPullRequestByNumber(
		repo.id,
		threadNumber(ctx.params.number),
	);
	if (!pr) throw notFoundError();
	if (pr.authorId !== caller.userId && !access.canWrite) {
		throw forbiddenError(
			"You do not have permission to edit this pull request",
		);
	}
	const body = await readJsonObject(ctx.request);
	const parsed = updateSchema.safeParse(body);
	if (!parsed.success) {
		throw validationFailedError(
			"Validation Failed",
			bodyErrors(parsed.error, body),
		);
	}
	const data = parsed.data;
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
		await serializeDetail(repo, updated, ctx.caller ? access.role : undefined),
	);
}

const mergeSchema = z.object({
	commit_title: z.string().max(MAX_COMMIT_MESSAGE_CHARS).nullish(),
	commit_message: z.string().max(MAX_COMMIT_MESSAGE_CHARS).nullish(),
	sha: z.string().max(100).nullish(),
	merge_method: z.enum(["merge", "squash", "rebase"]).nullish(),
});

const notMergeable = () => new ApiError(405, "Pull Request is not mergeable");

/** `GET /repos/{owner}/{repo}/pulls/{number}/merge`: 204 once merged, else 404. */
export async function checkPullMerged(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const pr = await findPullRequestByNumber(
		repo.id,
		threadNumber(ctx.params.number),
	);
	if (pr?.status !== "merged") throw notFoundError();
	return noContent();
}

/** `PUT /repos/{owner}/{repo}/pulls/{number}/merge` */
export async function mergePull(ctx: ApiContext) {
	const caller = requireScope(ctx, "repo:write");
	const { repo, access } = await readableRepository(ctx);
	const pr = await findPullRequestByNumber(
		repo.id,
		threadNumber(ctx.params.number),
	);
	if (!pr) throw notFoundError();
	if (!access.canMergePullRequest) {
		throw forbiddenError(
			"You do not have permission to merge this pull request",
		);
	}
	const body = await readJsonObject(ctx.request, { allowEmpty: true });
	const parsed = mergeSchema.safeParse(body);
	if (!parsed.success) {
		throw validationFailedError(
			"Validation Failed",
			parsed.error.issues.map((issue) =>
				pullError(String(issue.path[0] ?? ""), "invalid"),
			),
		);
	}
	const data = parsed.data;
	if (data.merge_method === "squash" || data.merge_method === "rebase") {
		throw new ApiError(
			405,
			`${data.merge_method === "squash" ? "Squash merges" : "Rebase merges"} are not allowed on this repository.`,
		);
	}
	if (pr.status !== "open") throw notMergeable();
	const headModified = () =>
		new ApiError(
			409,
			"Head branch was modified. Review and try the merge again.",
		);
	// A fast path; the merge re-checks under the repository lock.
	if (data.sha && (await branchTips(repo)).get(pr.sourceBranch) !== data.sha) {
		throw headModified();
	}
	// GitHub blocks the merge while changes are requested; an owner/admin may override.
	if ((await reviewSummaryFor(pr.id)).blocksMerge && !access.canModerate) {
		throw notMergeable();
	}

	const [committer] = await db
		.select({ id: user.id, name: user.name, email: user.email })
		.from(user)
		.where(eq(user.id, caller.userId))
		.limit(1);
	if (!committer) throw new Error("Authenticated user missing");
	const title = data.commit_title?.trim();
	const message = data.commit_message?.trim();
	const commitMessage = title
		? message
			? `${title}\n\n${message}`
			: title
		: message
			? `Merge pull request #${pr.number}: ${pr.title}\n\n${message}`
			: undefined;
	const result = await mergePullRequestBranches(
		repo,
		pr,
		committer,
		commitMessage,
		data.sha ?? undefined,
	);
	if (!result.success) {
		throw result.headModified ? headModified() : notMergeable();
	}
	return json({
		sha: result.commitSha,
		merged: true,
		message: "Pull Request successfully merged",
	});
}

/** `GET /repos/{owner}/{repo}/pulls/{number}/commits`, oldest first. */
export async function listPullCommits(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const pr = await findPullRequestByNumber(
		repo.id,
		threadNumber(ctx.params.number),
	);
	if (!pr) throw notFoundError();
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
	return json(
		infos.map((info) => commitObject(fullNameOf(repo), info)),
		200,
		linkHeader(ctx.url, params, commits.length),
	);
}

/** `GET /repos/{owner}/{repo}/pulls/{number}/files` */
export async function listPullFiles(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const pr = await findPullRequestByNumber(
		repo.id,
		threadNumber(ctx.params.number),
	);
	if (!pr) throw notFoundError();
	const params = pageParams(ctx.url.searchParams);
	const ownerKey = ownerKeyOf(repo);
	const fullName = fullNameOf(repo);
	// Pin the diff to the tips so every page of one listing reads one result,
	// kept briefly: the diff (patches included) is computed whole.
	const { baseSha, headSha } = tipShas(pr, await branchTips(repo));
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
