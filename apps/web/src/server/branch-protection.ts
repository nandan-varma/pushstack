/**
 * The read model of classic branch protection: what GitHub's REST protection
 * object says about the rule protecting one branch, and the rules every writer
 * enforces — a push, a direct write, a branch deletion, a merge. Enforcement
 * reads the rule through `branch-protection-store.ts`, so there is one copy.
 */

import { isNotFoundError } from "git-fs-s3";
import type { RefUpdateCommand, RefUpdateVeto } from "git-fs-s3/http";
import type { Repo } from "git-fs-s3/ops";
import git from "isomorphic-git";
import type { Repository } from "#/db/app-schema";
import { apiUrl, encodePath } from "./api/http";
import type { Shape } from "./api/serializers";
import {
	type BranchProtection,
	type BranchProtectionRule,
	findBranchProtection,
} from "./branch-protection-store";
import { getAccessForRepository, type RepositoryAccess } from "./repo-access";

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
