/**
 * `GET` of a branch's classic protection and of each part of it. The rule
 * comes from `branch-protection-store.ts`; the object from
 * `branch-protection.ts`. Nothing here writes.
 */
import { branchProtectionView } from "../branch-protection";
import { findBranchProtection } from "../branch-protection-store";
import { safeBranchNameSchema } from "../git-ref-name";
import type { ApiContext } from "./auth";
import { json, notFoundError } from "./http";
import { pathParams } from "./input";
import { readableRepository } from "./repo-lookup";

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
