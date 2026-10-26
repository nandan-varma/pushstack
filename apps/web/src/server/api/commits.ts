import { eq, sql } from "drizzle-orm";
import {
	type CommitInfo,
	DiffLimitError,
	type DiffResult,
} from "git-fs-s3/ops";
import { db } from "#/db";
import { user } from "#/db/schema";
import { MAX_HISTORY_WALK } from "#/lib/limits";
import { commitCommentCounts } from "../commit-comment-store";
import {
	getBranchDiff,
	getBranches,
	getCommit,
	getCommitDiff,
	getCommitHistory,
	getCommitsBetween,
	getDirectDiff,
	getFileHistory,
	getMergeBase,
} from "../git-read";
import { safeCommitRevSchema, safeRepoPathSchema } from "../git-ref-name";
import { ownerKeyOf } from "../git-storage-naming";
import type { RepositoryRowWithOwner } from "../repository-lookup";
import type { ApiContext } from "./auth";
import { apiCaps } from "./caps";
import { diffFileObjects } from "./diff-files";
import {
	ApiError,
	apiUrl,
	encodePath,
	htmlUrl,
	json,
	linkHeader,
	mediaFormat,
	mediaResponse,
	notFoundError,
	pageParams,
} from "./http";
import { pathParams, queryParams } from "./input";
import {
	formatPatches,
	formatPatchSections,
	unifiedDiff,
	withinDiffCap,
} from "./patches";
import { readableRepository } from "./repo-lookup";
import { commitObject } from "./serializers";
import { fullNameOf } from "./threads";

const noCommitError = (rev: string) =>
	new ApiError(422, `No commit found for SHA: ${rev}`);

/** GitHub answers 409 for history reads of a repository with no commits. */
async function assertNotEmpty(repo: RepositoryRowWithOwner) {
	const branches = await getBranches(ownerKeyOf(repo), repo.name);
	if (branches.length === 0)
		throw new ApiError(409, "Git Repository is empty.");
}

/** How many commits one filtered walk step reads. */
const FILTER_BATCH = 200;

type Identity = CommitInfo["commit"]["author"];

/**
 * An `author`/`committer` filter: an email matches the identity's email; a
 * login matches the emails of that account (never revealed — the filter
 * only selects). Null when the filter can match nothing.
 */
async function identityFilter(
	value: string | undefined,
): Promise<((identity: Identity) => boolean) | null | undefined> {
	if (value === undefined) return undefined;
	if (value.includes("@")) {
		const email = value.toLowerCase();
		return (identity) => identity.email.toLowerCase() === email;
	}
	const [account] = await db
		.select({ email: user.email })
		.from(user)
		.where(eq(sql`lower(${user.username})`, value.toLowerCase()))
		.limit(1);
	if (!account) return null;
	const email = account.email.toLowerCase();
	return (identity) => identity.email.toLowerCase() === email;
}

/**
 * `GET /repos/{owner}/{repo}/commits`: newest first from `sha` (default
 * branch), optionally only those touching `path`, by `author`/`committer`,
 * or committed in `[since, until]`.
 */
export async function listCommits(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const query = ctx.url.searchParams;
	const filters = queryParams(ctx, "repos/list-commits", "Commit");
	const rev = filters.sha || repo.defaultBranch;
	const path = (filters.path ?? "").replace(/^\/+|\/+$/g, "");
	if (
		!safeCommitRevSchema.safeParse(rev).success ||
		!safeRepoPathSchema.safeParse(path).success
	) {
		throw notFoundError();
	}
	await assertNotEmpty(repo);
	const params = pageParams(query);
	const ownerKey = ownerKeyOf(repo);
	const fullName = fullNameOf(repo);
	// One extra commit says whether a next page exists. History walks are
	// bounded (MAX_HISTORY_WALK), so deeper pages are empty.
	const want = params.perPage + 1;
	if (!params.reachable || params.offset + want > MAX_HISTORY_WALK) {
		return json([]);
	}
	const [byAuthor, byCommitter] = await Promise.all([
		identityFilter(filters.author),
		identityFilter(filters.committer),
	]);
	if (byAuthor === null || byCommitter === null) return json([]);
	const since = filters.since ? Date.parse(filters.since) / 1000 : null;
	const until = filters.until ? Date.parse(filters.until) / 1000 : null;
	const filtered =
		byAuthor !== undefined ||
		byCommitter !== undefined ||
		since !== null ||
		until !== null;
	const keep = (info: CommitInfo) => {
		const { author, committer } = info.commit;
		return (
			(!byAuthor || byAuthor(author)) &&
			(!byCommitter || byCommitter(committer)) &&
			(since === null || committer.timestamp >= since) &&
			(until === null || committer.timestamp <= until)
		);
	};

	/** `count` commits from `offset` of the (path-limited) history. */
	const walk = async (offset: number, count: number) => {
		if (!path) {
			return getCommitHistory(ownerKey, repo.name, rev, count, offset);
		}
		const { entries } = await getFileHistory(
			ownerKey,
			repo.name,
			rev,
			path,
			offset + count,
		);
		return Promise.all(
			entries
				.slice(offset, offset + count)
				.map((entry) => getCommit(ownerKey, repo.name, entry.sha)),
		);
	};

	let infos: CommitInfo[];
	if (!filtered) {
		infos = await walk(params.offset, want);
	} else {
		// Filter the bounded walk batch by batch until the page (plus one) fills.
		const matches: CommitInfo[] = [];
		for (
			let offset = 0;
			offset < MAX_HISTORY_WALK && matches.length < params.offset + want;
			offset += FILTER_BATCH
		) {
			const batch = await walk(offset, FILTER_BATCH);
			matches.push(...batch.filter(keep));
			if (batch.length < FILTER_BATCH) break;
		}
		infos = matches.slice(params.offset, params.offset + want);
	}
	const page = infos.slice(0, params.perPage);
	const hasMore = infos.length > params.perPage;
	const counts = await commitCommentCounts(
		repo.id,
		page.map((info) => info.oid),
	);
	return json(
		page.map((info) => commitObject(fullName, info, counts.get(info.oid))),
		200,
		linkHeader(
			ctx.url,
			params,
			params.offset + page.length + (hasMore ? 1 : 0),
		),
	);
}

async function diffSummary(
	repo: RepositoryRowWithOwner,
	diff: DiffResult,
	files: DiffResult["files"] = diff.files.slice(0, apiCaps.diffFiles),
) {
	return {
		stats: {
			total: diff.totalAdditions + diff.totalDeletions,
			additions: diff.totalAdditions,
			deletions: diff.totalDeletions,
		},
		files: await diffFileObjects(
			ownerKeyOf(repo),
			repo.name,
			fullNameOf(repo),
			diff,
			files,
		),
	};
}

const TEXT = "text/plain; charset=utf-8" as const;

/**
 * `GET /repos/{owner}/{repo}/commits/{ref}`: JSON with `stats` and `files`
 * (the first 300; `page`/`per_page` page through up to 3,000, as on GitHub),
 * or the `diff`, `patch` or `sha` media type. A `diff` or `patch` past
 * `apiCaps.diffMediaBytes` is 406.
 */
export async function getCommitDetail(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const { ref: rev } = pathParams(ctx, "repos/get-commit");
	if (!safeCommitRevSchema.safeParse(rev).success) throw noCommitError(rev);
	await assertNotEmpty(repo);
	const ownerKey = ownerKeyOf(repo);
	const info = await getCommit(ownerKey, repo.name, rev).catch(() => {
		throw noCommitError(rev);
	});
	const format = mediaFormat(ctx.request);
	if (format === "sha") return mediaResponse(info.oid, format, TEXT);
	const [diff, counts] = await Promise.all([
		getCommitDiff(ownerKey, repo.name, info.oid),
		commitCommentCounts(repo.id, [info.oid]),
	]);
	const commentCount = counts.get(info.oid);
	if (format === "diff") {
		return mediaResponse(withinDiffCap(unifiedDiff(diff)), format, TEXT);
	}
	if (format === "patch") {
		return mediaResponse(
			withinDiffCap(formatPatches([{ info, diff }])),
			format,
			TEXT,
		);
	}
	const query = ctx.url.searchParams;
	if (!(query.has("page") || query.has("per_page"))) {
		const { stats, files } = await diffSummary(repo, diff);
		return json({
			...commitObject(fullNameOf(repo), info, commentCount),
			stats,
			files,
		});
	}
	const params = pageParams(query);
	const listed = diff.files.slice(0, apiCaps.pagedDiffFiles);
	const { stats, files } = await diffSummary(
		repo,
		diff,
		params.reachable
			? listed.slice(params.offset, params.offset + params.perPage)
			: [],
	);
	return json(
		{ ...commitObject(fullNameOf(repo), info, commentCount), stats, files },
		200,
		linkHeader(ctx.url, params, listed.length),
	);
}

/**
 * One side of `base...head`: a ref, optionally `owner:ref`. There are no
 * forks, so another owner (or `owner:repo:ref`) names nothing here.
 */
function compareSide(side: string, repo: RepositoryRowWithOwner): string {
	const colon = side.indexOf(":");
	let rev = side;
	if (colon !== -1) {
		const owner = side.slice(0, colon);
		if (owner.toLowerCase() !== repo.owner.username.toLowerCase()) {
			throw notFoundError();
		}
		rev = side.slice(colon + 1);
	}
	if (!safeCommitRevSchema.safeParse(rev).success) throw notFoundError();
	return rev;
}

export async function compareCommits(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const { basehead } = pathParams(ctx, "repos/compare-commits-with-basehead");
	const separator = basehead.includes("...") ? "..." : "..";
	const at = basehead.indexOf(separator);
	if (at <= 0 || at + separator.length >= basehead.length) {
		throw notFoundError();
	}
	const base = compareSide(basehead.slice(0, at), repo);
	const head = compareSide(basehead.slice(at + separator.length), repo);
	const ownerKey = ownerKeyOf(repo);
	const fullName = fullNameOf(repo);
	const [baseInfo, headInfo] = await Promise.all([
		getCommit(ownerKey, repo.name, base),
		getCommit(ownerKey, repo.name, head),
	]);
	const [ahead, behind, diff] = await Promise.all([
		getCommitsBetween(
			ownerKey,
			repo.name,
			baseInfo.oid,
			headInfo.oid,
			MAX_HISTORY_WALK,
		),
		getCommitsBetween(
			ownerKey,
			repo.name,
			headInfo.oid,
			baseInfo.oid,
			MAX_HISTORY_WALK,
		),
		separator === ".."
			? getDirectDiff(ownerKey, repo.name, baseInfo.oid, headInfo.oid)
			: getBranchDiff(ownerKey, repo.name, baseInfo.oid, headInfo.oid),
	]);
	const aheadBy = ahead.commits.length;
	const behindBy = behind.commits.length;
	const status =
		aheadBy === 0 && behindBy === 0
			? "identical"
			: behindBy === 0
				? "ahead"
				: aheadBy === 0
					? "behind"
					: "diverged";
	const format = mediaFormat(ctx.request);
	if (format === "diff") {
		return mediaResponse(withinDiffCap(unifiedDiff(diff)), format, TEXT);
	}
	if (format === "patch") {
		const listed = ahead.commits.slice(0, apiCaps.compareCommits);
		const sections: string[] = [];
		let bytes = 0;
		for (const [index, commit] of listed.entries()) {
			const [info, commitDiff] = await Promise.all([
				getCommit(ownerKey, repo.name, commit.sha),
				getCommitDiff(ownerKey, repo.name, commit.sha),
			]);
			for (const section of formatPatchSections(
				info,
				commitDiff,
				index,
				listed.length,
			)) {
				bytes += new TextEncoder().encode(section).byteLength;
				if (bytes > apiCaps.diffMediaBytes)
					throw new DiffLimitError("bytes", apiCaps.diffMediaBytes);
				sections.push(section);
			}
		}
		return mediaResponse(sections.join(""), format, TEXT);
	}
	const mergeBaseOid =
		separator === ".."
			? await getMergeBase(ownerKey, repo.name, baseInfo.oid, headInfo.oid)
			: diff.oldRef;
	const mergeBase = mergeBaseOid
		? await getCommit(ownerKey, repo.name, mergeBaseOid)
		: baseInfo;

	// Without pagination parameters GitHub returns up to 250 commits; with
	// them, one page.
	const query = ctx.url.searchParams;
	const paginated = query.has("page") || query.has("per_page");
	const params = pageParams(query);
	const listed = ahead.commits.slice(0, apiCaps.compareCommits);
	const pageItems = paginated
		? params.reachable
			? listed.slice(params.offset, params.offset + params.perPage)
			: []
		: listed;
	const commits = await Promise.all(
		pageItems.map((commit) => getCommit(ownerKey, repo.name, commit.sha)),
	);
	const { files } = await diffSummary(repo, diff);
	const counts = await commitCommentCounts(repo.id, [
		baseInfo.oid,
		mergeBase.oid,
		...commits.map((info) => info.oid),
	]);
	const spec = `${encodePath(base)}${separator}${encodePath(head)}`;
	return json(
		{
			url: apiUrl(`/repos/${fullName}/compare/${spec}`),
			html_url: htmlUrl(`/${fullName}/compare/${spec}`),
			permalink_url: htmlUrl(
				`/${fullName}/compare/${baseInfo.oid}${separator}${headInfo.oid}`,
			),
			diff_url: htmlUrl(`/${fullName}/compare/${spec}.diff`),
			patch_url: htmlUrl(`/${fullName}/compare/${spec}.patch`),
			base_commit: commitObject(fullName, baseInfo, counts.get(baseInfo.oid)),
			merge_base_commit: commitObject(
				fullName,
				mergeBase,
				counts.get(mergeBase.oid),
			),
			status,
			ahead_by: aheadBy,
			behind_by: behindBy,
			total_commits: aheadBy,
			commits: commits.map((info) =>
				commitObject(fullName, info, counts.get(info.oid)),
			),
			files,
		},
		200,
		paginated ? linkHeader(ctx.url, params, listed.length) : {},
	);
}
