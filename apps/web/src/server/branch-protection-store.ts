/**
 * Classic branch protection rules and the matcher every reader shares. A
 * branch is protected by the oldest rule whose `fnmatch` pattern matches its
 * name — GitHub's model, where a branch has exactly one rule — so the rules
 * are read oldest first and the first match wins.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "#/db";
import {
	branchProtectionRules,
	branchProtectionStatusChecks,
} from "#/db/app-schema";
import {
	MAX_BRANCH_PROTECTION_PATTERN_CHARS,
	MAX_BRANCH_PROTECTION_RULES_PER_REPO,
} from "#/lib/limits";

export interface BranchProtectionStatusCheck {
	context: string;
	/** The app that must report the context; null means any app. */
	appId: number | null;
}

export type BranchProtectionRule = typeof branchProtectionRules.$inferSelect;

/** The rule protecting a branch, with the contexts it requires. */
export interface BranchProtection {
	rule: BranchProtectionRule;
	statusChecks: BranchProtectionStatusCheck[];
}

/**
 * A pattern is literal except for `*` (any run, slashes included) and `?` (one
 * character), so every other regex metacharacter is escaped: a caller's
 * pattern can never become regex syntax of its own.
 */
export function matchBranchPattern(pattern: string, branch: string): boolean {
	// The write path caps the length; refusing a longer stored row keeps the
	// compile bounded even if one arrives by another route.
	if (pattern.length > MAX_BRANCH_PROTECTION_PATTERN_CHARS) return false;
	const source = pattern.replace(/[.*+?^${}()|[\]\\]/g, (character) =>
		character === "*" ? ".*" : character === "?" ? "." : `\\${character}`,
	);
	return new RegExp(`^${source}$`).test(branch);
}

/** The rule protecting `branch`, or null: the oldest matching pattern wins. */
export function matchBranchProtection(
	rules: BranchProtectionRule[],
	branch: string,
): BranchProtectionRule | null {
	return rules.find((rule) => matchBranchPattern(rule.pattern, branch)) ?? null;
}

/** Every rule of a repository, oldest first: the matcher's order. */
export async function listBranchProtectionRules(
	repoId: number,
): Promise<BranchProtectionRule[]> {
	return db
		.select()
		.from(branchProtectionRules)
		.where(eq(branchProtectionRules.repoId, repoId))
		.orderBy(
			asc(branchProtectionRules.createdAt),
			asc(branchProtectionRules.id),
		)
		.limit(MAX_BRANCH_PROTECTION_RULES_PER_REPO);
}

/** The rule protecting `branch` of a repository with its contexts, or null. */
export async function findBranchProtection(
	repoId: number,
	branch: string,
): Promise<BranchProtection | null> {
	const rule = matchBranchProtection(
		await listBranchProtectionRules(repoId),
		branch,
	);
	return rule ? { rule, statusChecks: await statusChecksFor(rule.id) } : null;
}

/** Every rule of a repository with its contexts, oldest first. */
export async function listBranchProtections(
	repoId: number,
): Promise<BranchProtection[]> {
	const rules = await listBranchProtectionRules(repoId);
	if (rules.length === 0) return [];
	const checks = await db
		.select({
			ruleId: branchProtectionStatusChecks.ruleId,
			context: branchProtectionStatusChecks.context,
			appId: branchProtectionStatusChecks.appId,
		})
		.from(branchProtectionStatusChecks)
		.where(
			inArray(
				branchProtectionStatusChecks.ruleId,
				rules.map((rule) => rule.id),
			),
		)
		.orderBy(asc(branchProtectionStatusChecks.context));
	return rules.map((rule) => ({
		rule,
		statusChecks: checks
			.filter((check) => check.ruleId === rule.id)
			.map(({ context, appId }) => ({ context, appId })),
	}));
}

/** The rule whose pattern is exactly `pattern` with its contexts, or null. */
export async function findBranchProtectionRule(
	repoId: number,
	pattern: string,
): Promise<BranchProtection | null> {
	const [rule] = await db
		.select()
		.from(branchProtectionRules)
		.where(
			and(
				eq(branchProtectionRules.repoId, repoId),
				eq(branchProtectionRules.pattern, pattern),
			),
		);
	return rule ? { rule, statusChecks: await statusChecksFor(rule.id) } : null;
}

/** A rule's contexts in the read order: `(rule_id, context)` is the key. */
async function statusChecksFor(
	ruleId: number,
): Promise<BranchProtectionStatusCheck[]> {
	return db
		.select({
			context: branchProtectionStatusChecks.context,
			appId: branchProtectionStatusChecks.appId,
		})
		.from(branchProtectionStatusChecks)
		.where(eq(branchProtectionStatusChecks.ruleId, ruleId))
		.orderBy(asc(branchProtectionStatusChecks.context));
}

/** The fields a write sets; the status checks replace the rule's whole list. */
export interface BranchProtectionWrite {
	requiresPullRequest: boolean;
	requiredApprovingReviewCount: number;
	dismissStaleReviews: boolean;
	requireCodeOwnerReviews: boolean;
	/** Null is GitHub's `required_status_checks: null`. */
	requiredStatusChecksStrict: boolean | null;
	enforceAdmins: boolean;
	allowForcePushes: boolean;
	allowDeletions: boolean;
	statusChecks: BranchProtectionStatusCheck[];
}

/** A repository is already at {@link MAX_BRANCH_PROTECTION_RULES_PER_REPO}. */
export class BranchProtectionLimitError extends Error {
	constructor() {
		super(
			`A repository may hold at most ${MAX_BRANCH_PROTECTION_RULES_PER_REPO} branch protection rules`,
		);
	}
}

/** The write that reproduces a rule: every field the sub-resources reset. */
export function branchProtectionWrite(
	protection: BranchProtection,
): BranchProtectionWrite {
	const { rule, statusChecks } = protection;
	return {
		requiresPullRequest: rule.requiresPullRequest,
		requiredApprovingReviewCount: rule.requiredApprovingReviewCount,
		dismissStaleReviews: rule.dismissStaleReviews,
		requireCodeOwnerReviews: rule.requireCodeOwnerReviews,
		requiredStatusChecksStrict: rule.requiredStatusChecksStrict,
		enforceAdmins: rule.enforceAdmins,
		allowForcePushes: rule.allowForcePushes,
		allowDeletions: rule.allowDeletions,
		statusChecks,
	};
}

/** One check per context, the last app winning, in the read order (name). */
function uniqueChecks(
	checks: BranchProtectionStatusCheck[],
): BranchProtectionStatusCheck[] {
	const byContext = new Map<string, BranchProtectionStatusCheck>();
	for (const check of checks) byContext.set(check.context, check);
	return [...byContext.values()].sort((a, b) =>
		a.context < b.context ? -1 : a.context > b.context ? 1 : 0,
	);
}

/**
 * Creates or replaces the rule for exactly `pattern` (the rule's identity, as
 * the write endpoints address it) and replaces its status check contexts.
 */
export async function writeBranchProtection(
	repoId: number,
	pattern: string,
	write: BranchProtectionWrite,
): Promise<BranchProtection> {
	const { statusChecks, ...fields } = write;
	const existing = await findBranchProtectionRule(repoId, pattern);
	if (!existing) {
		const rules = await listBranchProtectionRules(repoId);
		if (rules.length >= MAX_BRANCH_PROTECTION_RULES_PER_REPO) {
			throw new BranchProtectionLimitError();
		}
	}
	const values = { ...fields, updatedAt: new Date() };
	const [rule] = await db
		.insert(branchProtectionRules)
		.values({ repoId, pattern, ...values })
		.onConflictDoUpdate({
			target: [branchProtectionRules.repoId, branchProtectionRules.pattern],
			set: values,
		})
		.returning();
	if (!rule) throw new Error("branch protection write returned no row");
	await db
		.delete(branchProtectionStatusChecks)
		.where(eq(branchProtectionStatusChecks.ruleId, rule.id));
	// GitHub disables the contexts with `required_status_checks`; keeping them
	// would make a later re-enable silently require what was never resubmitted.
	const contexts =
		rule.requiredStatusChecksStrict === null ? [] : uniqueChecks(statusChecks);
	if (contexts.length > 0) {
		await db.insert(branchProtectionStatusChecks).values(
			contexts.map((check) => ({
				ruleId: rule.id,
				context: check.context,
				appId: check.appId,
			})),
		);
	}
	return { rule, statusChecks: contexts };
}

/** Deletes the rule whose pattern is exactly `pattern`; false when absent. */
export async function deleteBranchProtection(
	repoId: number,
	pattern: string,
): Promise<boolean> {
	const deleted = await db
		.delete(branchProtectionRules)
		.where(
			and(
				eq(branchProtectionRules.repoId, repoId),
				eq(branchProtectionRules.pattern, pattern),
			),
		)
		.returning({ id: branchProtectionRules.id });
	return deleted.length > 0;
}
