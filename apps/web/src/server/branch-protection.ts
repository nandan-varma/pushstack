/**
 * The read model of classic branch protection: what GitHub's REST protection
 * object says about the rule protecting one branch. Enforcement (push, merge,
 * direct writes) reads the same rule through `branch-protection-store.ts`.
 */

import { apiUrl, encodePath } from "./api/http";
import type { Shape } from "./api/serializers";
import type { BranchProtection } from "./branch-protection-store";

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
