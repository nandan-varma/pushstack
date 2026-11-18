/**
 * Classic branch protection rules and the matcher every reader shares. A
 * branch is protected by the oldest rule whose `fnmatch` pattern matches its
 * name — GitHub's model, where a branch has exactly one rule — so the rules
 * are read oldest first and the first match wins.
 */
import { asc, eq } from "drizzle-orm";
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
	if (!rule) return null;
	// `(rule_id, context)` is the primary key, and the REST object's order.
	const statusChecks = await db
		.select({
			context: branchProtectionStatusChecks.context,
			appId: branchProtectionStatusChecks.appId,
		})
		.from(branchProtectionStatusChecks)
		.where(eq(branchProtectionStatusChecks.ruleId, rule.id))
		.orderBy(asc(branchProtectionStatusChecks.context));
	return { rule, statusChecks };
}
