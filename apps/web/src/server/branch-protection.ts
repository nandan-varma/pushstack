/**
 * The read model of classic branch protection: what GitHub's REST protection
 * object says about the rule protecting one branch, and the rules every writer
 * enforces — a push, a direct write, a branch deletion, a merge. Enforcement
 * reads the rule through `branch-protection-store.ts`, so there is one copy.
 */

import { inArray } from "drizzle-orm";
import { isNotFoundError, qualifyBranchRef } from "git-fs-s3";
import type { RefUpdateCommand, RefUpdateVeto } from "git-fs-s3/http";
import type { Repo } from "git-fs-s3/ops";
import git from "isomorphic-git";
import { db } from "#/db";
import type { Repository } from "#/db/app-schema";
import { user } from "#/db/schema";
import { checkRunState } from "#/lib/check-rollup";
import { ownersOfPaths } from "#/lib/codeowners";
import { MAX_REQUIRED_STATUS_CONTEXTS } from "#/lib/limits";
import { apiUrl, encodePath } from "./api/http";
import type { Shape } from "./api/serializers";
import {
	type BranchProtection,
	type BranchProtectionRule,
	findBranchProtection,
} from "./branch-protection-store";
import { latestCheckRunsNamed, latestCommitStatuses } from "./check-store";
import { loadCodeowners } from "./codeowners";
import { getBranchDiff } from "./git-read";
import { repoFor } from "./git-repo";
import { ownerKeyOf } from "./git-storage-naming";
import { tipOf } from "./pull-head";
import { getAccessForRepository, type RepositoryAccess } from "./repo-access";
import {
	currentVerdicts,
	type ReviewVerdict,
	reviewVerdicts,
} from "./review-store";
import type { PullRequest } from "./thread-store";

/** `GET …/branches/{branch}/protection`: GitHub's protection object. */
export function branchProtectionView(
	fullName: string,
	branch: string,
	protection: BranchProtection,
): Shape<"branchProtection"> {
	const { rule, statusChecks } = protection;
	const url = apiUrl(
		`/repos/${fullName}/branches/${encodePath(branch)}/protection`,
	);
	const toggle = (path: string, enabled: boolean) => ({
		url: `${url}/${path}`,
		enabled,
	});
	return {
		url,
		required_status_checks:
			rule.requiredStatusChecksStrict === null
				? null
				: {
						url: `${url}/required_status_checks`,
						strict: rule.requiredStatusChecksStrict,
						contexts: statusChecks.map((check) => check.context),
						contexts_url: `${url}/required_status_checks/contexts`,
						checks: statusChecks.map((check) => ({
							context: check.context,
							app_id: check.appId,
						})),
					},
		required_pull_request_reviews: rule.requiresPullRequest
			? {
					url: `${url}/required_pull_request_reviews`,
					dismissal_restrictions: { users: [], teams: [], apps: [] },
					dismiss_stale_reviews: rule.dismissStaleReviews,
					require_code_owner_reviews: rule.requireCodeOwnerReviews,
					required_approving_review_count: rule.requiredApprovingReviewCount,
					bypass_pull_request_allowances: { users: [], teams: [], apps: [] },
				}
			: null,
		required_signatures: { enabled: false },
		enforce_admins: toggle("enforce_admins", rule.enforceAdmins),
		required_linear_history: { enabled: false },
		allow_force_pushes: toggle("allow_force_pushes", rule.allowForcePushes),
		allow_deletions: toggle("allow_deletions", rule.allowDeletions),
		block_creations: { enabled: false },
		required_conversation_resolution: { enabled: false },
		lock_branch: { enabled: false },
		allow_fork_syncing: { enabled: false },
	};
}

/** Git's wording for anyref a protection rule refused, before the reason. */
const PROTECTED_REASON = "protected branch hook declined";

/**
 * GitHub's "Do not allow bypassing the above settings": off (the default) lets
 * the owner and repository admins past every rule of the branch.
 */
function bypassesRule(
	rule: BranchProtectionRule,
	access: RepositoryAccess,
): boolean {
	if (rule.enforceAdmins) return false;
	return access.role === "owner" || access.role === "admin";
}

const GH006_PREFIX = "error: GH006";

function veto(update: RefUpdateCommand, reason: string): RefUpdateVeto {
	return {
		refName: update.refName,
		reason: PROTECTED_REASON,
		messages: [
			`${GH006_PREFIX}: Protected branch update failed for ${update.refName}.`,
			`error: ${reason}.`,
		],
	};
}

/**
 * Whether `update` rewrites history rather than adding to it. An oid the walk
 * can't reach is either missing or off the branch, and neither is a
 * fast-forward, so both count as a force push.
 */
async function isForcePush(
	repo: Repo,
	update: RefUpdateCommand,
): Promise<boolean> {
	if (update.oldOid === update.newOid) return false;
	try {
		return !(await git.isDescendent({
			...repo,
			oid: update.newOid,
			ancestor: update.oldOid,
		}));
	} catch (error) {
		if (isNotFoundError(error)) return true;
		throw error;
	}
}

/**
 * The ref updates a push may not apply, as GitHub's GH006 refusals. Only
 * branches are judged, and a branch is judged by the same rule its REST
 * protection object reads.
 */
export async function vetPush(
	repository: Repository,
	actorId: string | null,
	updates: RefUpdateCommand[],
	repo: Repo,
): Promise<RefUpdateVeto[]> {
	const branches = updates.filter((update) =>
		update.refName.startsWith("refs/heads/"),
	);
	if (branches.length === 0) return [];
	const access = await getAccessForRepository(repository, actorId);
	const vetoes: RefUpdateVeto[] = [];
	for (const update of branches) {
		const branch = update.refName.slice("refs/heads/".length);
		const protection = await findBranchProtection(repository.id, branch);
		if (!protection || bypassesRule(protection.rule, access)) continue;
		if (update.newOid === "0".repeat(40)) {
			if (!protection.rule.allowDeletions) {
				vetoes.push(veto(update, "Cannot delete a protected branch"));
			}
			continue;
		}
		if (
			!protection.rule.allowForcePushes &&
			(await isForcePush(repo, update))
		) {
			vetoes.push(veto(update, "Cannot force-push to a protected branch"));
		}
	}
	return vetoes;
}

/** GitHub's 422 reason a direct write to `branch` is refused, or null. */
export async function writeBlockedReason(
	repository: Repository,
	branch: string,
	actorId: string | null,
): Promise<string | null> {
	const protection = await findBranchProtection(repository.id, branch);
	if (!protection?.rule.requiresPullRequest) return null;
	if (
		bypassesRule(
			protection.rule,
			await getAccessForRepository(repository, actorId),
		)
	) {
		return null;
	}
	return "Changes must be made through a pull request.";
}

/** GitHub's 422 reason `branch` cannot be deleted, or null. */
export async function deleteBlockedReason(
	repository: Repository,
	branch: string,
	actorId: string | null,
): Promise<string | null> {
	const protection = await findBranchProtection(repository.id, branch);
	if (!protection || protection.rule.allowDeletions) return null;
	if (
		bypassesRule(
			protection.rule,
			await getAccessForRepository(repository, actorId),
		)
	) {
		return null;
	}
	return "Cannot delete a protected branch";
}

/** GitHub's `MergeStateStatus` for a pull request. */
export type MergeStateStatus =
	| "UNKNOWN"
	| "DRAFT"
	| "BEHIND"
	| "BLOCKED"
	| "UNSTABLE"
	| "CLEAN";

export type ReviewDecision =
	| "APPROVED"
	| "CHANGES_REQUESTED"
	| "REVIEW_REQUIRED"
	| null;

/** A repository as the write paths hold it: its row, its owner's login and name. */
export type ProtectedRepository = Repository &
	Parameters<typeof ownerKeyOf>[0] & { name: string };

export interface PullRequestProtection {
	mergeStateStatus: MergeStateStatus;
	reviewDecision: ReviewDecision;
	/** GitHub's reason the merge is refused for this actor, or null. */
	reason: string | null;
}

/** `"ci"`, `"ci, build"`: the first, for one reason line. */
function quoted(contexts: string[]): string {
	return contexts.map((context) => `"${context}"`).join(", ");
}

type RequiredCheckState = "success" | "failure" | "pending";

const CHECK_RANK: Record<RequiredCheckState, number> = {
	success: 0,
	pending: 1,
	failure: 2,
};

/**
 * Each required context's state at `sha`: a status context and a check run of
 * the same name both count, and the worse of the two wins.
 */
async function requiredCheckStates(
	repoId: number,
	sha: string,
	contexts: string[],
): Promise<{ context: string; state: RequiredCheckState }[]> {
	const [statuses, runs] = await Promise.all([
		latestCommitStatuses(repoId, sha, {
			limit: MAX_REQUIRED_STATUS_CONTEXTS,
		}),
		latestCheckRunsNamed(repoId, sha, contexts),
	]);
	const worst = new Map<string, RequiredCheckState>();
	const note = (context: string, state: RequiredCheckState) => {
		const current = worst.get(context);
		if (!current || CHECK_RANK[state] > CHECK_RANK[current]) {
			worst.set(context, state);
		}
	};
	for (const status of statuses) {
		note(
			status.context,
			status.state === "failure" || status.state === "error"
				? "failure"
				: status.state,
		);
	}
	for (const run of runs) note(run.name, checkRunState(run));
	return contexts.map((context) => ({
		context,
		state: worst.get(context) ?? "pending",
	}));
}

/** Whether the base branch has commits the head does not (a strict rule). */
async function behindBase(
	repo: Repo,
	baseBranch: string,
	headSha: string,
): Promise<boolean> {
	const base = await tipOf(repo, qualifyBranchRef(baseBranch));
	if (!base || base === headSha) return false;
	try {
		return !(await git.isDescendent({
			...repo,
			oid: headSha,
			ancestor: base,
		}));
	} catch (error) {
		if (isNotFoundError(error)) return true;
		throw error;
	}
}

/** Whether an approving reviewer owns one of the changed paths (CODEOWNERS). */
async function codeOwnerApproved(input: {
	repository: ProtectedRepository;
	pullRequest: PullRequest;
	verdicts: ReviewVerdict[];
}): Promise<boolean> {
	const { repository, pullRequest } = input;
	const codeowners = await loadCodeowners(repository, pullRequest.targetBranch);
	if (!codeowners || codeowners.rules.length === 0) return true;
	const approvers = input.verdicts
		.filter((verdict) => verdict.state === "approved")
		.map((verdict) => verdict.authorId);
	if (approvers.length === 0) return false;
	const [diff, reviewers] = await Promise.all([
		getBranchDiff(
			ownerKeyOf(repository),
			repository.name,
			pullRequest.targetBranch,
			pullRequest.headRef,
		),
		db
			.select({ username: user.username })
			.from(user)
			.where(inArray(user.id, approvers)),
	]);
	const owners = new Set(
		ownersOfPaths(
			codeowners.rules,
			diff.files.map((file) => file.path),
		),
	);
	return reviewers.some((reviewer) =>
		owners.has(reviewer.username.toLowerCase()),
	);
}

/**
 * What the base branch's rule and the pull request's reviews, checks and
 * ancestry say about merging it: GitHub's `mergeStateStatus`, `reviewDecision`
 * and the reason a merge is refused for `actorId`.
 */
export async function pullRequestProtection(input: {
	repository: ProtectedRepository;
	pullRequest: PullRequest;
	actorId: string | null;
	/** The head commit; read from the head ref when absent. */
	headSha?: string | null;
}): Promise<PullRequestProtection> {
	const { repository, pullRequest } = input;
	const repo = repoFor(ownerKeyOf(repository), repository.name);
	const headSha =
		input.headSha ?? (await tipOf(repo, qualifyBranchRef(pullRequest.headRef)));
	const [protection, access] = await Promise.all([
		findBranchProtection(repository.id, pullRequest.targetBranch),
		getAccessForRepository(repository, input.actorId),
	]);
	const rule = protection?.rule ?? null;
	const verdicts = currentVerdicts(
		await reviewVerdicts(pullRequest.id),
		rule?.dismissStaleReviews ?? false,
		headSha,
	);
	const approved = verdicts.filter(
		(verdict) => verdict.state === "approved",
	).length;
	const changesRequested = verdicts.filter(
		(verdict) => verdict.state === "changes_requested",
	).length;
	const required = rule?.requiredApprovingReviewCount ?? 0;
	const ownersSatisfied = rule?.requireCodeOwnerReviews
		? await codeOwnerApproved({ repository, pullRequest, verdicts })
		: true;
	const reviewsSatisfied = approved >= required && ownersSatisfied;
	const contexts = protection?.statusChecks.map((check) => check.context) ?? [];
	const checks =
		contexts.length === 0
			? []
			: await requiredCheckStates(repository.id, headSha ?? "", contexts);
	const failing = checks
		.filter((check) => check.state === "failure")
		.map((check) => check.context);
	const pending = checks
		.filter((check) => check.state === "pending")
		.map((check) => check.context);
	const strict = rule?.requiredStatusChecksStrict === true;
	const behind =
		strict &&
		headSha !== null &&
		(await behindBase(repo, pullRequest.targetBranch, headSha));

	let reviewDecision: ReviewDecision = null;
	if (changesRequested > 0) reviewDecision = "CHANGES_REQUESTED";
	else if (!reviewsSatisfied) reviewDecision = "REVIEW_REQUIRED";
	else if (approved > 0) reviewDecision = "APPROVED";

	let mergeStateStatus: MergeStateStatus;
	if (pullRequest.status !== "open") mergeStateStatus = "UNKNOWN";
	else if (pullRequest.isDraft) mergeStateStatus = "DRAFT";
	else if (behind) mergeStateStatus = "BEHIND";
	else if (!reviewsSatisfied || failing.length > 0)
		mergeStateStatus = "BLOCKED";
	else if (pending.length > 0) mergeStateStatus = "UNSTABLE";
	else mergeStateStatus = "CLEAN";

	// An owner or admin bypasses review and check rules when the rule doesn't
	// enforce admins; without a rule, only a moderator bypasses a request for
	// changes, as the merge box has always allowed.
	const bypassed = rule ? bypassesRule(rule, access) : access.canModerate;
	const reason = bypassed
		? null
		: (changesRequested > 0 && "Changes were requested on this pull request") ||
			(behind && "Head branch is not up to date with the base branch") ||
			(approved < required &&
				`At least ${required} approving review${required === 1 ? "" : "s"} ${required === 1 ? "is" : "are"} required by reviewers with write access.`) ||
			(!ownersSatisfied && "Review from Code Owners is required") ||
			(failing.length > 0 &&
				`Required status check ${quoted(failing)} is failing`) ||
			(pending.length > 0 &&
				`Required status check ${quoted(pending)} is expected`) ||
			null;
	return { mergeStateStatus, reviewDecision, reason };
}

/**
 * Why the merge of a pull request is refused for `actorId`, or null: the rule's
 * reviews, code owners, status checks and strict up-to-date requirement.
 */
export async function mergeBlockedReason(input: {
	repository: ProtectedRepository;
	pullRequest: PullRequest;
	actorId: string;
}): Promise<string | null> {
	return (await pullRequestProtection(input)).reason;
}
