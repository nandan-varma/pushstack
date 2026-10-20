/**
 * `GET /repos/{owner}/{repo}/commits`, `…/commits/{ref}` and
 * `…/compare/{basehead}`, in GitHub's shapes.
 */
import type { CommitInfo, DiffResult } from "git-fs-s3/ops";
import { MAX_HISTORY_WALK } from "#/lib/limits";
import {
	getBranchDiff,
	getBranches,
	getCommit,
	getCommitDiff,
	getCommitHistory,
	getCommitsBetween,
	getFileHistory,
} from "../git-read";
import { safeCommitRevSchema, safeRepoPathSchema } from "../git-ref-name";
import { ownerKeyOf } from "../git-storage-naming";
import type { RepositoryRowWithOwner } from "../repository-lookup";
import type { ApiContext } from "./auth";
import { diffFileObjects } from "./diff-files";
import {
	ApiError,
	apiUrl,
	encodePath,
	htmlUrl,
	json,
	linkHeader,
	notFoundError,
	pageParams,
} from "./http";
import { readableRepository } from "./repo-lookup";
import { commitObject } from "./serializers";
import { fullNameOf } from "./threads";

/** A single commit or a comparison lists at most 300 files, as GitHub does. */
export const MAX_DIFF_FILES = 300;
/** A comparison lists at most 250 commits, as GitHub does. */
export const MAX_COMPARE_COMMITS = 250;

const noCommitError = (rev: string) =>
	new ApiError(422, `No commit found for SHA: ${rev}`);

/** GitHub answers 409 for history reads of a repository with no commits. */
async function assertNotEmpty(repo: RepositoryRowWithOwner) {
	const branches = await getBranches(ownerKeyOf(repo), repo.name);
	if (branches.length === 0)
		throw new ApiError(409, "Git Repository is empty.");
}

/** `GET /repos/{owner}/{repo}/commits`: `sha` (a branch, tag or sha), `path`, pagination. */
export async function listCommits(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const query = ctx.url.searchParams;
	const rev = query.get("sha") || repo.defaultBranch;
	const path = (query.get("path") ?? "").replace(/^\/+|\/+$/g, "");
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
	let infos: CommitInfo[];
	if (path) {
		const { entries } = await getFileHistory(
			ownerKey,
			repo.name,
			rev,
			path,
			params.offset + want,
		);
		infos = await Promise.all(
			entries
				.slice(params.offset, params.offset + want)
				.map((entry) => getCommit(ownerKey, repo.name, entry.sha)),
		);
	} else {
		infos = await getCommitHistory(
			ownerKey,
			repo.name,
			rev,
			want,
			params.offset,
		);
	}
	const page = infos.slice(0, params.perPage);
	const hasMore = infos.length > params.perPage;
	return json(
		page.map((info) => commitObject(fullName, info)),
		200,
		linkHeader(
			ctx.url,
			params,
			params.offset + page.length + (hasMore ? 1 : 0),
		),
	);
}

/** Totals and files of a diff, as a single commit and compare carry them. */
async function diffSummary(repo: RepositoryRowWithOwner, diff: DiffResult) {
	const files = await diffFileObjects(
		ownerKeyOf(repo),
		repo.name,
		fullNameOf(repo),
		diff,
		diff.files.slice(0, MAX_DIFF_FILES),
	);
	return {
		stats: {
			total: diff.totalAdditions + diff.totalDeletions,
			additions: diff.totalAdditions,
			deletions: diff.totalDeletions,
		},
		files,
	};
}

/** `GET /repos/{owner}/{repo}/commits/{ref}`: the commit with `stats` and `files`. */
export async function getCommitDetail(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const rev = ctx.params.ref ?? "";
	if (!safeCommitRevSchema.safeParse(rev).success) throw noCommitError(rev);
	await assertNotEmpty(repo);
	const ownerKey = ownerKeyOf(repo);
	const info = await getCommit(ownerKey, repo.name, rev).catch(() => {
		throw noCommitError(rev);
	});
	const diff = await getCommitDiff(ownerKey, repo.name, info.oid);
	const { stats, files } = await diffSummary(repo, diff);
	return json({ ...commitObject(fullNameOf(repo), info), stats, files });
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

/** `GET /repos/{owner}/{repo}/compare/{base}...{head}` (`..` is accepted too). */
export async function compareCommits(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const basehead = ctx.params.basehead ?? "";
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
		getBranchDiff(ownerKey, repo.name, baseInfo.oid, headInfo.oid),
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
	const mergeBase = diff.oldRef
		? await getCommit(ownerKey, repo.name, diff.oldRef)
		: baseInfo;

	// Without pagination parameters GitHub returns up to 250 commits; with
	// them, one page.
	const query = ctx.url.searchParams;
	const paginated = query.has("page") || query.has("per_page");
	const params = pageParams(query);
	const listed = ahead.commits.slice(0, MAX_COMPARE_COMMITS);
	const pageItems = paginated
		? params.reachable
			? listed.slice(params.offset, params.offset + params.perPage)
			: []
		: listed;
	const commits = await Promise.all(
		pageItems.map((commit) => getCommit(ownerKey, repo.name, commit.sha)),
	);
	const { files } = await diffSummary(repo, diff);
	const spec = `${encodePath(base)}...${encodePath(head)}`;
	return json(
		{
			url: apiUrl(`/repos/${fullName}/compare/${spec}`),
			html_url: htmlUrl(`/repo/${fullName}/compare/${spec}`),
			permalink_url: htmlUrl(
				`/repo/${fullName}/compare/${baseInfo.oid}...${headInfo.oid}`,
			),
			diff_url: htmlUrl(`/repo/${fullName}/compare/${spec}.diff`),
			patch_url: htmlUrl(`/repo/${fullName}/compare/${spec}.patch`),
			base_commit: commitObject(fullName, baseInfo),
			merge_base_commit: commitObject(fullName, mergeBase),
			status,
			ahead_by: aheadBy,
			behind_by: behindBy,
			total_commits: aheadBy,
			commits: commits.map((info) => commitObject(fullName, info)),
			files,
		},
		200,
		paginated ? linkHeader(ctx.url, params, listed.length) : {},
	);
}
