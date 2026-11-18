/**
 * Classic branch protection at `/api/v3`: the `GET`s of one branch's rule and
 * of each part of it, and the writes that create, replace or remove them.
 * Reads find the rule that matches the branch name; writes address the rule
 * whose pattern is exactly the requested branch path, which is also the
 * pattern a create stores.
 */
import { branchProtectionView } from "../branch-protection";
import {
	type BranchProtection,
	BranchProtectionLimitError,
	type BranchProtectionStatusCheck,
	type BranchProtectionWrite,
	branchProtectionWrite,
	deleteBranchProtection as deleteRule,
	findBranchProtection,
	findBranchProtectionRule,
	writeBranchProtection,
} from "../branch-protection-store";
import { safeBranchNameSchema, safeBranchPatternSchema } from "../git-ref-name";
import { type ApiContext, requireScope } from "./auth";
import {
	forbiddenError,
	json,
	noContent,
	notFoundError,
	validationFailedError,
} from "./http";
import { pathParams, type RequestBody, requestBody } from "./input";
import { readableRepository } from "./repo-lookup";

type StatusChecksBody = RequestBody<"repos/update-status-check-protection">;
type ContextsBody = RequestBody<"repos/add-status-check-contexts">;

/** Every protection route takes the same `{owner}/{repo}/{+branch}` params. */
async function protectedBranch(ctx: ApiContext) {
	const { repo } = await readableRepository(ctx);
	const { branch } = pathParams(ctx, "repos/get-branch-protection");
	if (!safeBranchNameSchema.safeParse(branch).success) throw notFoundError();
	const protection = await findBranchProtection(repo.id, branch);
	if (!protection) throw notFoundError("Branch not protected");
	return {
		fullName: `${repo.owner.username}/${repo.name}`,
		branch,
		protection,
	};
}

/** The repository and rule pattern a write acts on; owner/admin only. */
async function writableProtection(ctx: ApiContext) {
	requireScope(ctx, "repo:write");
	const { repo, access } = await readableRepository(ctx);
	if (!access.canModerate) {
		throw forbiddenError("Must have admin rights to Repository.");
	}
	const { branch } = pathParams(ctx, "repos/get-branch-protection");
	const pattern = safeBranchPatternSchema.safeParse(branch);
	if (!pattern.success) throw notFoundError();
	return {
		repo,
		pattern: pattern.data,
		fullName: `${repo.owner.username}/${repo.name}`,
	};
}

/** The rule whose pattern the path names; `404 Branch not protected` when absent. */
async function addressedProtection(
	repoId: number,
	pattern: string,
): Promise<BranchProtection> {
	const protection = await findBranchProtectionRule(repoId, pattern);
	if (!protection) throw notFoundError("Branch not protected");
	return protection;
}

/**
 * Writes one field of the addressed rule and returns the result. Every
 * sub-resource is the same write: the rule as it stands, one field changed.
 */
async function rewrite(
	ctx: ApiContext,
	patch: (current: BranchProtectionWrite) => Partial<BranchProtectionWrite>,
) {
	const { repo, pattern, fullName } = await writableProtection(ctx);
	const current = branchProtectionWrite(
		await addressedProtection(repo.id, pattern),
	);
	try {
		const protection = await writeBranchProtection(repo.id, pattern, {
			...current,
			...patch(current),
		});
		return { fullName, pattern, protection };
	} catch (error) {
		throwLimitError(error);
	}
}

/** The 422 for a repository already holding its maximum rules. */
function throwLimitError(error: unknown): never {
	if (error instanceof BranchProtectionLimitError) {
		throw validationFailedError("Validation Failed", [
			{
				resource: "Branch protection",
				field: "pattern",
				code: "custom",
				message: error.message,
			},
		]);
	}
	throw error;
}

/** The contexts a status-checks write requires; `checks` wins over `contexts`. */
function checksOf(body: StatusChecksBody): BranchProtectionStatusCheck[] {
	if (body.checks) {
		return body.checks.map(({ context, app_id }) => ({
			context,
			// GitHub's `-1` is "any app", which is a null `app_id` stored.
			appId: app_id === undefined || app_id === -1 ? null : app_id,
		}));
	}
	return (body.contexts ?? []).map((context) => ({ context, appId: null }));
}

/** The contexts a `contexts` write sets. */
function contextsOf(body: ContextsBody): string[] {
	return body.contexts;
}

/** Throws unless the rule requires status checks, as GitHub's sub-resource does. */
function requireStatusChecks(current: BranchProtectionWrite): void {
	if (current.requiredStatusChecksStrict === null) {
		throw notFoundError("Required status checks not enabled");
	}
}

export async function getBranchProtection(ctx: ApiContext) {
	const { fullName, branch, protection } = await protectedBranch(ctx);
	return json(branchProtectionView(fullName, branch, protection));
}

export async function getStatusChecksProtection(ctx: ApiContext) {
	const { fullName, branch, protection } = await protectedBranch(ctx);
	const statusChecks = branchProtectionView(
		fullName,
		branch,
		protection,
	).required_status_checks;
	if (!statusChecks) throw notFoundError("Required status checks not enabled");
	return json(statusChecks);
}

export async function getAllStatusCheckContexts(ctx: ApiContext) {
	const { fullName, branch, protection } = await protectedBranch(ctx);
	const statusChecks = branchProtectionView(
		fullName,
		branch,
		protection,
	).required_status_checks;
	if (!statusChecks) throw notFoundError("Required status checks not enabled");
	return json(statusChecks.contexts);
}

export async function getPullRequestReviewProtection(ctx: ApiContext) {
	const { fullName, branch, protection } = await protectedBranch(ctx);
	const reviews = branchProtectionView(
		fullName,
		branch,
		protection,
	).required_pull_request_reviews;
	if (!reviews) {
		throw notFoundError("Required pull request reviews not enabled");
	}
	return json(reviews);
}

export async function getAdminBranchProtection(ctx: ApiContext) {
	const { fullName, branch, protection } = await protectedBranch(ctx);
	return json(
		branchProtectionView(fullName, branch, protection).enforce_admins,
	);
}

export async function getForcePushProtection(ctx: ApiContext) {
	const { fullName, branch, protection } = await protectedBranch(ctx);
	return json(
		branchProtectionView(fullName, branch, protection).allow_force_pushes,
	);
}

export async function getDeletionProtection(ctx: ApiContext) {
	const { fullName, branch, protection } = await protectedBranch(ctx);
	return json(
		branchProtectionView(fullName, branch, protection).allow_deletions,
	);
}

export async function updateBranchProtection(ctx: ApiContext) {
	const { repo, pattern, fullName } = await writableProtection(ctx);
	const body = await requestBody(
		ctx,
		"repos/update-branch-protection",
		"Branch protection",
	);
	const statusChecks = body.required_status_checks;
	const reviews = body.required_pull_request_reviews;
	try {
		const protection = await writeBranchProtection(repo.id, pattern, {
			requiresPullRequest: reviews !== null && reviews !== undefined,
			requiredApprovingReviewCount:
				reviews?.required_approving_review_count ?? 0,
			dismissStaleReviews: reviews?.dismiss_stale_reviews ?? false,
			requireCodeOwnerReviews: reviews?.require_code_owner_reviews ?? false,
			requiredStatusChecksStrict: statusChecks
				? (statusChecks.strict ?? false)
				: null,
			enforceAdmins: body.enforce_admins ?? false,
			allowForcePushes: body.allow_force_pushes ?? false,
			allowDeletions: body.allow_deletions ?? false,
			statusChecks: statusChecks ? checksOf(statusChecks) : [],
		});
		return json(branchProtectionView(fullName, pattern, protection));
	} catch (error) {
		throwLimitError(error);
	}
}

export async function deleteBranchProtection(ctx: ApiContext) {
	const { repo, pattern } = await writableProtection(ctx);
	if (!(await deleteRule(repo.id, pattern))) {
		throw notFoundError("Branch not protected");
	}
	return noContent();
}

export async function updateStatusCheckProtection(ctx: ApiContext) {
	const body = await requestBody(
		ctx,
		"repos/update-status-check-protection",
		"Branch protection",
	);
	const { fullName, pattern, protection } = await rewrite(ctx, () => ({
		requiredStatusChecksStrict: body.strict ?? false,
		statusChecks: checksOf(body),
	}));
	const statusChecks = branchProtectionView(
		fullName,
		pattern,
		protection,
	).required_status_checks;
	if (!statusChecks) throw notFoundError("Required status checks not enabled");
	return json(statusChecks);
}

export async function removeStatusCheckProtection(ctx: ApiContext) {
	await rewrite(ctx, () => ({
		requiredStatusChecksStrict: null,
		statusChecks: [],
	}));
	return noContent();
}

export async function addStatusCheckContexts(ctx: ApiContext) {
	const body = await requestBody(
		ctx,
		"repos/add-status-check-contexts",
		"Branch protection",
	);
	const contexts = contextsOf(body);
	const { protection } = await rewrite(ctx, (current) => {
		requireStatusChecks(current);
		return {
			statusChecks: [
				...current.statusChecks,
				...contexts.map((context) => ({ context, appId: null })),
			],
		};
	});
	return json(protection.statusChecks.map((check) => check.context));
}

export async function setStatusCheckContexts(ctx: ApiContext) {
	const body = await requestBody(
		ctx,
		"repos/set-status-check-contexts",
		"Branch protection",
	);
	const contexts = contextsOf(body);
	const { protection } = await rewrite(ctx, (current) => {
		requireStatusChecks(current);
		return {
			statusChecks: contexts.map((context) => ({ context, appId: null })),
		};
	});
	return json(protection.statusChecks.map((check) => check.context));
}

export async function removeStatusCheckContexts(ctx: ApiContext) {
	const body = await requestBody(
		ctx,
		"repos/remove-status-check-contexts",
		"Branch protection",
	);
	const removed = new Set(contextsOf(body));
	const { protection } = await rewrite(ctx, (current) => {
		requireStatusChecks(current);
		return {
			statusChecks: current.statusChecks.filter(
				(check) => !removed.has(check.context),
			),
		};
	});
	return json(protection.statusChecks.map((check) => check.context));
}

export async function updatePullRequestReviewProtection(ctx: ApiContext) {
	const body = await requestBody(
		ctx,
		"repos/update-pull-request-review-protection",
		"Branch protection",
	);
	const { fullName, pattern, protection } = await rewrite(ctx, (current) => ({
		requiresPullRequest: true,
		requiredApprovingReviewCount:
			body.required_approving_review_count ??
			current.requiredApprovingReviewCount,
		dismissStaleReviews:
			body.dismiss_stale_reviews ?? current.dismissStaleReviews,
		requireCodeOwnerReviews:
			body.require_code_owner_reviews ?? current.requireCodeOwnerReviews,
	}));
	const reviews = branchProtectionView(
		fullName,
		pattern,
		protection,
	).required_pull_request_reviews;
	if (!reviews) {
		throw notFoundError("Required pull request reviews not enabled");
	}
	return json(reviews);
}

export async function deletePullRequestReviewProtection(ctx: ApiContext) {
	await rewrite(ctx, () => ({
		requiresPullRequest: false,
		requiredApprovingReviewCount: 0,
		dismissStaleReviews: false,
		requireCodeOwnerReviews: false,
	}));
	return noContent();
}

export async function setAdminBranchProtection(ctx: ApiContext) {
	const { fullName, pattern, protection } = await rewrite(ctx, () => ({
		enforceAdmins: true,
	}));
	return json(
		branchProtectionView(fullName, pattern, protection).enforce_admins,
	);
}

export async function deleteAdminBranchProtection(ctx: ApiContext) {
	await rewrite(ctx, () => ({ enforceAdmins: false }));
	return noContent();
}

export async function setForcePushProtection(ctx: ApiContext) {
	const { fullName, pattern, protection } = await rewrite(ctx, () => ({
		allowForcePushes: true,
	}));
	return json(
		branchProtectionView(fullName, pattern, protection).allow_force_pushes,
	);
}

export async function deleteForcePushProtection(ctx: ApiContext) {
	await rewrite(ctx, () => ({ allowForcePushes: false }));
	return noContent();
}

export async function setDeletionProtection(ctx: ApiContext) {
	const { fullName, pattern, protection } = await rewrite(ctx, () => ({
		allowDeletions: true,
	}));
	return json(
		branchProtectionView(fullName, pattern, protection).allow_deletions,
	);
}

export async function deleteDeletionProtection(ctx: ApiContext) {
	await rewrite(ctx, () => ({ allowDeletions: false }));
	return noContent();
}
