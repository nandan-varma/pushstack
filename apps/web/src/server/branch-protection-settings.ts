/**
 * Settings → Branches: the repository's rules as the owner edits them. The
 * page saves one whole rule at a time, and the store it writes through is the
 * same one the REST endpoints use, so the two cannot disagree about a field.
 */
import { inputs } from "@pushstack/api-contract";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
	type BranchProtection,
	BranchProtectionLimitError,
	deleteBranchProtection as deleteRule,
	findBranchProtectionRule,
	listBranchProtections,
	writeBranchProtection,
} from "./branch-protection-store";
import { safeBranchPatternSchema } from "./git-ref-name";
import { requireOwner } from "./repo-access";
import { getCurrentUser } from "./session";

/** One rule as the settings page edits it. */
export interface BranchProtectionRuleSettings {
	pattern: string;
	requiresPullRequest: boolean;
	requiredApprovingReviewCount: number;
	dismissStaleReviews: boolean;
	requireCodeOwnerReviews: boolean;
	requireStatusChecks: boolean;
	strictStatusChecks: boolean;
	contexts: string[];
	enforceAdmins: boolean;
	allowForcePushes: boolean;
	allowDeletions: boolean;
}

function settingsOf({ rule, statusChecks }: BranchProtection) {
	return {
		pattern: rule.pattern,
		requiresPullRequest: rule.requiresPullRequest,
		requiredApprovingReviewCount: rule.requiredApprovingReviewCount,
		dismissStaleReviews: rule.dismissStaleReviews,
		requireCodeOwnerReviews: rule.requireCodeOwnerReviews,
		requireStatusChecks: rule.requiredStatusChecksStrict !== null,
		strictStatusChecks: rule.requiredStatusChecksStrict ?? false,
		contexts: statusChecks.map((check) => check.context),
		enforceAdmins: rule.enforceAdmins,
		allowForcePushes: rule.allowForcePushes,
		allowDeletions: rule.allowDeletions,
	} satisfies BranchProtectionRuleSettings;
}

async function requireOwnerOfRepo(repoId: number, message: string) {
	const currentUser = await getCurrentUser();
	await requireOwner(repoId, currentUser.id, message);
}

export const getBranchProtectionRules = createServerFn({ method: "GET" })
	.validator(z.object({ repoId: z.number() }))
	.handler(async ({ data }) => {
		await requireOwnerOfRepo(
			data.repoId,
			"Only the repository owner can see branch protection",
		);
		return (await listBranchProtections(data.repoId)).map(settingsOf);
	});

const saveBranchProtectionRuleInput = z.object({
	repoId: z.number(),
	pattern: safeBranchPatternSchema,
	requiresPullRequest: z.boolean(),
	requiredApprovingReviewCount: inputs.branchProtectionApprovingReviews,
	dismissStaleReviews: z.boolean(),
	requireCodeOwnerReviews: z.boolean(),
	requireStatusChecks: z.boolean(),
	strictStatusChecks: z.boolean(),
	contexts: inputs.branchProtectionContexts,
	enforceAdmins: z.boolean(),
	allowForcePushes: z.boolean(),
	allowDeletions: z.boolean(),
});

export const saveBranchProtectionRule = createServerFn({ method: "POST" })
	.validator(saveBranchProtectionRuleInput)
	.handler(async ({ data }) => {
		await requireOwnerOfRepo(
			data.repoId,
			"Only the repository owner can change branch protection",
		);
		// A context the page did not change keeps the app the API required.
		const existing = await findBranchProtectionRule(data.repoId, data.pattern);
		const appIds = new Map(
			existing?.statusChecks.map((check) => [check.context, check.appId]),
		);
		try {
			return settingsOf(
				await writeBranchProtection(data.repoId, data.pattern, {
					requiresPullRequest: data.requiresPullRequest,
					requiredApprovingReviewCount: data.requiredApprovingReviewCount,
					dismissStaleReviews: data.dismissStaleReviews,
					requireCodeOwnerReviews: data.requireCodeOwnerReviews,
					requiredStatusChecksStrict: data.requireStatusChecks
						? data.strictStatusChecks
						: null,
					enforceAdmins: data.enforceAdmins,
					allowForcePushes: data.allowForcePushes,
					allowDeletions: data.allowDeletions,
					statusChecks: data.contexts.map((context) => ({
						context,
						appId: appIds.get(context) ?? null,
					})),
				}),
			);
		} catch (error) {
			if (error instanceof BranchProtectionLimitError) {
				throw new Error(error.message);
			}
			throw error;
		}
	});

export const deleteBranchProtectionRule = createServerFn({ method: "POST" })
	.validator(z.object({ repoId: z.number(), pattern: safeBranchPatternSchema }))
	.handler(async ({ data }) => {
		await requireOwnerOfRepo(
			data.repoId,
			"Only the repository owner can change branch protection",
		);
		if (!(await deleteRule(data.repoId, data.pattern))) {
			throw new Error(`No branch protection rule for "${data.pattern}"`);
		}
		return { pattern: data.pattern };
	});
