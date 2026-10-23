/**
 * CODEOWNERS at a ref: find the file (GitHub's lookup order), parse it, and
 * auto-request reviews from the owners of a new pull request's changed paths.
 * Plain server-only helpers.
 */
import { isNotFoundError } from "git-fs-s3";
import { db } from "#/db";
import {
	CODEOWNERS_PATHS,
	type CodeownersRule,
	ownersOfPaths,
	parseCodeowners,
	ruleFor,
} from "#/lib/codeowners";
import { MAX_CODEOWNERS_BYTES } from "#/lib/limits";
import {
	getBlobByOid,
	getBlobSize,
	getBranchDiff,
	getEntryOid,
} from "./git-read";
import { ownerKeyOf } from "./git-storage-naming";
import { logWarn } from "./perf-log";
import { ReviewRequestError, requestReviewers } from "./review-request-store";
import type { PullRequest } from "./thread-store";

type RepoRef = { name: string; owner: { username: string } };

export interface LoadedCodeowners {
	path: string;
	rules: CodeownersRule[];
}

/** The repository's CODEOWNERS at `ref`, or null when it has none. */
export async function loadCodeowners(
	repo: RepoRef,
	ref: string,
): Promise<LoadedCodeowners | null> {
	for (const path of CODEOWNERS_PATHS) {
		let bytes: Uint8Array;
		try {
			// The size comes from the pack entry, so an oversized file is never read.
			const oid = await getEntryOid(ownerKeyOf(repo), repo.name, ref, path);
			if (!oid) continue;
			if (
				(await getBlobSize(ownerKeyOf(repo), repo.name, oid)) >
				MAX_CODEOWNERS_BYTES
			) {
				return null;
			}
			bytes = await getBlobByOid(ownerKeyOf(repo), repo.name, oid);
		} catch (error) {
			if (isNotFoundError(error)) continue;
			throw error;
		}
		return {
			path,
			rules: parseCodeowners(new TextDecoder().decode(bytes)),
		};
	}
	return null;
}

/** The owners of one file at `ref` (for the blob view), or null without a rule. */
export async function ownersOfFile(
	repo: RepoRef,
	ref: string,
	filePath: string,
): Promise<{ pattern: string; owners: string[]; file: string } | null> {
	const loaded = await loadCodeowners(repo, ref);
	const rule = loaded && ruleFor(loaded.rules, filePath);
	return rule && loaded
		? { pattern: rule.pattern, owners: rule.owners, file: loaded.path }
		: null;
}

/**
 * Request reviews from the CODEOWNERS (at the base branch) of the paths `pr`
 * changes (not for a draft: marking it ready does). Owners who aren't collaborators, and the author, are skipped. A
 * failure never fails the pull request being opened; it is logged.
 */
export async function requestCodeownerReviews(
	repo: RepoRef & { id: number },
	pr: Pick<
		PullRequest,
		"id" | "repoId" | "authorId" | "sourceBranch" | "targetBranch" | "isDraft"
	>,
): Promise<void> {
	// As on GitHub, a draft requests no one until it is marked ready for review.
	if (pr.isDraft) return;
	try {
		const loaded = await loadCodeowners(repo, pr.targetBranch);
		if (!loaded || loaded.rules.length === 0) return;
		const diff = await getBranchDiff(
			ownerKeyOf(repo),
			repo.name,
			pr.targetBranch,
			pr.sourceBranch,
		);
		const owners = ownersOfPaths(
			loaded.rules,
			diff.files.map((file) => file.path),
		);
		if (owners.length === 0) return;
		// One request per owner so a non-collaborator doesn't void the rest.
		for (const owner of owners) {
			try {
				await requestReviewers(pr, [owner], pr.authorId);
			} catch (error) {
				if (error instanceof ReviewRequestError) continue;
				throw error;
			}
		}
	} catch (error) {
		logWarn("codeowners", `auto-request failed for PR ${pr.id}`, error);
	}
}

/** {@link requestCodeownerReviews} for a pull request whose repository isn't at hand. */
export async function requestCodeownerReviewsFor(
	pr: Parameters<typeof requestCodeownerReviews>[1],
): Promise<void> {
	const repo = await db.query.repositories.findFirst({
		columns: { id: true, name: true },
		where: { id: pr.repoId },
		with: { owner: { columns: { username: true } } },
	});
	if (repo) await requestCodeownerReviews(repo, pr);
}
