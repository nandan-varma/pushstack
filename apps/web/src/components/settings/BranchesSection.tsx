import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Section } from "@/components/Section";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { LoadingButton } from "@/components/ui/loading-button";
import { Switch } from "@/components/ui/switch";
import { MAX_REQUIRED_APPROVING_REVIEWS } from "@/lib/limits";
import {
	queryKeys,
	repoBranchProtectionQueryOptions,
} from "@/lib/query-options";
import {
	type BranchProtectionRuleSettings,
	deleteBranchProtectionRule,
	saveBranchProtectionRule,
} from "@/server/branch-protection-settings";

/** A rule as the form edits it; `isNew` unlocks the pattern, the rule's identity. */
type Draft = BranchProtectionRuleSettings & { isNew: boolean };

const EMPTY_DRAFT: Draft = {
	isNew: true,
	pattern: "",
	requiresPullRequest: true,
	requiredApprovingReviewCount: 1,
	dismissStaleReviews: false,
	requireCodeOwnerReviews: false,
	requireStatusChecks: false,
	strictStatusChecks: false,
	contexts: [],
	enforceAdmins: false,
	allowForcePushes: false,
	allowDeletions: false,
};

/** What a rule requires, as the list shows it. */
function summary(rule: BranchProtectionRuleSettings): string[] {
	const parts: string[] = [];
	if (rule.requiresPullRequest) {
		parts.push(
			rule.requiredApprovingReviewCount === 0
				? "pull request required"
				: `${rule.requiredApprovingReviewCount} approving review${rule.requiredApprovingReviewCount === 1 ? "" : "s"}`,
		);
	}
	if (rule.requireCodeOwnerReviews) parts.push("code owner review");
	if (rule.requireStatusChecks) {
		parts.push(
			rule.contexts.length === 0
				? "status checks required"
				: `checks: ${rule.contexts.join(", ")}`,
		);
	}
	if (rule.enforceAdmins) parts.push("admins included");
	if (rule.allowForcePushes) parts.push("force pushes allowed");
	if (rule.allowDeletions) parts.push("deletions allowed");
	return parts.length > 0 ? parts : ["no requirements"];
}

export function BranchesSection({ repoId }: { repoId: number }) {
	const queryClient = useQueryClient();
	const [draft, setDraft] = useState<Draft | null>(null);
	const [error, setError] = useState("");

	const { data: rules = [], isLoading } = useQuery(
		repoBranchProtectionQueryOptions(repoId),
	);

	const refresh = () =>
		queryClient.invalidateQueries({
			queryKey: queryKeys.repoBranchProtection(repoId),
		});

	const saveMutation = useMutation({
		mutationFn: saveBranchProtectionRule,
		onSuccess: () => {
			setDraft(null);
			setError("");
			refresh();
		},
		onError: (e: Error) => setError(e.message),
	});

	const deleteMutation = useMutation({
		mutationFn: deleteBranchProtectionRule,
		onSuccess: () => {
			setError("");
			refresh();
		},
		onError: (e: Error) => setError(e.message),
	});

	const update = (patch: Partial<Draft>) =>
		setDraft((current) => (current ? { ...current, ...patch } : current));

	const contexts = draft?.contexts.join(", ") ?? "";

	return (
		<Section
			title="Branch protection"
			description="Rules that gate pushes and merges into matching branches. Patterns use * and ?, and the oldest matching rule wins."
		>
			<div className="space-y-4">
				{isLoading ? (
					<div className="h-11 animate-pulse rounded-lg border border-border bg-muted" />
				) : rules.length > 0 ? (
					<ul className="divide-y divide-[var(--border)] rounded-lg border border-border">
						{rules.map((rule) => (
							<li
								key={rule.pattern}
								className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5"
							>
								<div className="min-w-0">
									<code className="text-sm font-medium text-foreground">
										{rule.pattern}
									</code>
									<p className="mt-0.5 text-xs text-muted-foreground">
										{summary(rule).join(" · ")}
									</p>
								</div>
								<div className="flex shrink-0 items-center gap-2">
									<Button
										variant="outline"
										onClick={() => {
											setDraft({ ...rule, isNew: false });
											setError("");
										}}
									>
										Edit
									</Button>
									<Button
										variant="outline"
										disabled={deleteMutation.isPending}
										onClick={() =>
											deleteMutation.mutate({
												data: { repoId, pattern: rule.pattern },
											})
										}
									>
										Delete
									</Button>
								</div>
							</li>
						))}
					</ul>
				) : (
					<p className="text-sm text-muted-foreground">
						No branch is protected yet.
					</p>
				)}

				{draft ? (
					<div className="space-y-4 rounded-lg border border-border p-4">
						<FormField
							label="Branch name or pattern"
							htmlFor="rule-pattern"
							hint="(* and ? are wildcards)"
						>
							<Input
								id="rule-pattern"
								value={draft.pattern}
								disabled={!draft.isNew}
								placeholder="main"
								onChange={(e) => update({ pattern: e.target.value })}
							/>
						</FormField>

						<div className="space-y-2">
							{(
								[
									[
										"requiresPullRequest",
										"Require a pull request before merging",
									],
									["dismissStaleReviews", "Dismiss stale approvals"],
									["requireCodeOwnerReviews", "Require code owner review"],
									["requireStatusChecks", "Require status checks to pass"],
									["strictStatusChecks", "Require branches to be up to date"],
									["enforceAdmins", "Include administrators"],
									["allowForcePushes", "Allow force pushes"],
									["allowDeletions", "Allow deletions"],
								] as const
							).map(([key, label]) => (
								<div
									key={key}
									className="flex items-center justify-between gap-3 text-sm"
								>
									<span id={`rule-${key}`}>{label}</span>
									<Switch
										aria-labelledby={`rule-${key}`}
										checked={draft[key]}
										disabled={
											(key === "strictStatusChecks" &&
												!draft.requireStatusChecks) ||
											(key === "dismissStaleReviews" &&
												!draft.requiresPullRequest) ||
											(key === "requireCodeOwnerReviews" &&
												!draft.requiresPullRequest)
										}
										onCheckedChange={(checked) => update({ [key]: checked })}
									/>
								</div>
							))}
						</div>

						{draft.requiresPullRequest && (
							<FormField
								label="Required approving reviews"
								htmlFor="rule-approvals"
							>
								<Input
									id="rule-approvals"
									type="number"
									min={0}
									max={MAX_REQUIRED_APPROVING_REVIEWS}
									value={draft.requiredApprovingReviewCount}
									onChange={(e) =>
										update({
											requiredApprovingReviewCount: Math.min(
												MAX_REQUIRED_APPROVING_REVIEWS,
												Math.max(0, Number(e.target.value) || 0),
											),
										})
									}
								/>
							</FormField>
						)}

						{draft.requireStatusChecks && (
							<FormField
								label="Required status checks"
								htmlFor="rule-contexts"
								hint="(comma separated)"
							>
								<Input
									id="rule-contexts"
									value={contexts}
									placeholder="ci/test, build"
									onChange={(e) =>
										update({
											contexts: e.target.value
												.split(",")
												.map((context) => context.trim())
												.filter(Boolean),
										})
									}
								/>
							</FormField>
						)}

						<FieldError>{error}</FieldError>
						<div className="flex items-center justify-end gap-2">
							<Button
								variant="outline"
								onClick={() => {
									setDraft(null);
									setError("");
								}}
							>
								Cancel
							</Button>
							<LoadingButton
								isLoading={saveMutation.isPending}
								loadingLabel="Saving…"
								disabled={!draft.pattern.trim()}
								onClick={() => {
									const { isNew: _isNew, ...rule } = draft;
									saveMutation.mutate({
										data: {
											repoId,
											...rule,
											pattern: rule.pattern.trim(),
											strictStatusChecks: rule.requireStatusChecks
												? rule.strictStatusChecks
												: false,
											contexts: rule.requireStatusChecks ? rule.contexts : [],
										},
									});
								}}
							>
								Save rule
							</LoadingButton>
						</div>
					</div>
				) : (
					<div className="flex items-center justify-between gap-3">
						{error ? (
							<FieldError>{error}</FieldError>
						) : (
							<span className="text-xs text-muted-foreground">
								Rules apply to pushes and merges into every matching branch.
							</span>
						)}
						<Button onClick={() => setDraft(EMPTY_DRAFT)}>Add a rule</Button>
					</div>
				)}
			</div>
		</Section>
	);
}
