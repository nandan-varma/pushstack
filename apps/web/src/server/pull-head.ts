/**
 * The head of a pull request from a fork. The base repository pins a copy of
 * the head commit as `refs/pull/<n>/head` (`PullRequest.headRef`), so the
 * diff, commits and merge read only the base. The pin follows the fork's
 * branch lazily: a read of an open pull request moves it when the branch
 * moved, copying only the missing objects.
 */

import { eq } from "drizzle-orm";
import { isNotFoundError } from "git-fs-s3";
import git from "isomorphic-git";
import { db } from "#/db";
import { pullRequests } from "#/db/app-schema";
import { STORAGE_NAME_RE } from "#/lib/storage-name";
import { repoFor } from "./git-repo";
import { ownerKeyOf } from "./git-storage-naming";
import { pinPullHead } from "./git-write";
import { logWarn } from "./perf-log";
import { getRepositoryAccess } from "./repo-access";
import { forkSourceOf } from "./repository-fork";
import {
	findRepositoryByName,
	publicUserFields,
	type RepositoryRowWithOwner,
} from "./repository-lookup";
import type { PullRequest } from "./thread-store";

export const isCrossRepository = (pr: Pick<PullRequest, "headOwner">) =>
	pr.headOwner !== null;

/** The fork a pull request's head branch lives in, or null once it is deleted. */
export async function headRepositoryOf(
	pr: Pick<PullRequest, "headRepoId">,
): Promise<RepositoryRowWithOwner | null> {
	if (pr.headRepoId === null) return null;
	const row = await db.query.repositories.findFirst({
		where: { id: pr.headRepoId },
		with: { owner: publicUserFields },
	});
	return row ?? null;
}

/** The head repository only when `viewerId` can read it (never named otherwise). */
export async function readableHeadRepository(
	pr: Pick<PullRequest, "headRepoId">,
	viewerId: string | null | undefined,
): Promise<RepositoryRowWithOwner | null> {
	const head = await headRepositoryOf(pr);
	if (!head) return null;
	return (await getRepositoryAccess(head.id, viewerId))?.canRead ? head : null;
}

export async function tipOf(
	repo: ReturnType<typeof repoFor>,
	ref: string,
): Promise<string | null> {
	try {
		return await git.resolveRef({ ...repo, ref });
	} catch (error) {
		if (isNotFoundError(error)) return null;
		throw error;
	}
}

/**
 * Move `refs/pull/<n>/head` to the fork branch's tip when it moved. A deleted
 * fork or branch, a closed or merged pull request and a failed copy leave the
 * pin as it is: the pull request keeps working from what it pinned.
 */
export async function refreshPullHead(
	base: RepositoryRowWithOwner,
	pr: PullRequest,
): Promise<void> {
	if (!isCrossRepository(pr) || pr.status !== "open") return;
	const fork = await headRepositoryOf(pr);
	if (!fork) return;
	const forkRepo = repoFor(ownerKeyOf(fork), fork.name);
	const baseRepo = repoFor(ownerKeyOf(base), base.name);
	const [forkTip, pinned, targetTip] = await Promise.all([
		tipOf(forkRepo, `refs/heads/${pr.sourceBranch}`),
		tipOf(baseRepo, pr.headRef),
		tipOf(baseRepo, `refs/heads/${pr.targetBranch}`),
	]);
	if (forkTip === null || forkTip === pinned) return;
	try {
		await pinPullHead(
			ownerKeyOf(base),
			base.name,
			forkRepo,
			pr.number,
			forkTip,
			targetTip === null ? [] : [targetTip],
		);
	} catch (error) {
		logWarn("pull-head", `refreshing #${pr.number} failed`, error);
		return;
	}
	await db
		.update(pullRequests)
		.set({ headSha: forkTip })
		.where(eq(pullRequests.issueId, pr.id));
}

/**
 * `head` as the head repository of a pull request into `base`: in the same
 * fork network, readable by `viewerId`, and not private when `base` is public
 * (its objects would become readable through the pull request). Null for
 * anything else, so a refusal never says which condition failed.
 */
export async function acceptForkHead(
	base: RepositoryRowWithOwner,
	head: RepositoryRowWithOwner | null,
	viewerId: string,
): Promise<RepositoryRowWithOwner | null> {
	if (!head || head.id === base.id) return null;
	if (head.visibility === "private" && base.visibility === "public")
		return null;
	if (!(await getRepositoryAccess(head.id, viewerId))?.canRead) return null;
	const [headRoot, baseRoot] = await Promise.all([
		forkSourceOf(head),
		forkSourceOf(base),
	]);
	return headRoot && baseRoot && headRoot.id === baseRoot.id ? head : null;
}

/** {@link acceptForkHead} for the repository `owner/name`. */
export async function findForkHead(
	base: RepositoryRowWithOwner,
	owner: string,
	name: string,
	viewerId: string,
): Promise<RepositoryRowWithOwner | null> {
	if (!STORAGE_NAME_RE.test(owner) || !STORAGE_NAME_RE.test(name)) return null;
	return acceptForkHead(
		base,
		await findRepositoryByName(owner, name),
		viewerId,
	);
}
